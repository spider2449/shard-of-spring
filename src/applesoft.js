// Applesoft BASIC interpreter working on the tokenized program bytes stored on the
// game disks. The program runs as a generator so that GET/INPUT/WAIT and machine
// code that polls the keyboard can pause until a key arrives.
(function (SS) {
  "use strict";

  const TOKEN_NAMES = ("END FOR NEXT DATA INPUT DEL DIM READ GR TEXT PR# IN# CALL PLOT HLIN VLIN HGR2 HGR HCOLOR= HPLOT " +
    "DRAW XDRAW HTAB HOME ROT= SCALE= SHLOAD TRACE NOTRACE NORMAL INVERSE FLASH COLOR= POP VTAB HIMEM: " +
    "LOMEM: ONERR RESUME RECALL STORE SPEED= LET GOTO RUN IF RESTORE & GOSUB RETURN REM STOP ON WAIT " +
    "LOAD SAVE DEF POKE PRINT CONT LIST CLEAR GET NEW TAB( TO FN SPC( THEN AT NOT STEP + - * / ^ AND OR " +
    "> = < SGN INT ABS USR FRE SCRN( PDL POS SQR RND LOG EXP COS SIN TAN ATN PEEK LEN STR$ VAL ASC " +
    "CHR$ LEFT$ RIGHT$ MID$").split(" ");
  const T = {};
  TOKEN_NAMES.forEach((n, i) => { T[n] = 0x80 + i; });

  class BasicError extends Error {
    constructor(msg, code) { super(msg); this.msg = msg; this.code = code; }
  }
  const err = (msg, code) => new BasicError(msg, code);
  const SYNTAX = () => err("SYNTAX ERROR", 16);

  // ------------------------------------------------------------------ parser
  function parseProgram(bytes, load) {
    const prog = { lines: [], index: new Map(), data: [], dataLine: [] };
    let p = 0;
    while (p + 4 <= bytes.length) {
      const next = bytes[p] | (bytes[p + 1] << 8);
      const num = bytes[p + 2] | (bytes[p + 3] << 8);
      if (next === 0) break;
      let q = p + 4;
      while (q < bytes.length && bytes[q] !== 0) q++;
      const line = { num, stmts: [] };
      prog.index.set(num, prog.lines.length);
      prog.lines.push(line);
      parseLine(bytes.subarray(p + 4, q), line, prog);
      p = next - load;
      if (p < 0) break;
    }
    return prog;
  }

  function parseLine(b, line, prog) {
    let i = 0;
    const peek = () => { while (i < b.length && b[i] === 0x20) i++; return i < b.length ? b[i] : -1; };
    const next = () => { const c = peek(); if (c >= 0) i++; return c; };
    const expect = (c) => { if (next() !== c) throw SYNTAX(); };

    // ---- expressions (precedence climbing)
    function parseExpr() { return parseOr(); }
    function parseOr() {
      let l = parseAnd();
      while (peek() === T.OR) { i++; const r = parseAnd(); l = { t: "bin", op: "OR", l, r }; }
      return l;
    }
    function parseAnd() {
      let l = parseNot();
      while (peek() === T.AND) { i++; const r = parseNot(); l = { t: "bin", op: "AND", l, r }; }
      return l;
    }
    function parseNot() {
      if (peek() === T.NOT) { i++; return { t: "un", op: "NOT", e: parseNot() }; }
      return parseRel();
    }
    function parseRel() {
      let l = parseAdd();
      for (;;) {
        let lt = false, gt = false, eq = false, any = false;
        for (;;) {
          const c = peek();
          if (c === T["<"]) { lt = true; any = true; i++; }
          else if (c === T[">"]) { gt = true; any = true; i++; }
          else if (c === T["="]) { eq = true; any = true; i++; }
          else break;
        }
        if (!any) return l;
        const r = parseAdd();
        l = { t: "rel", lt, gt, eq, l, r };
      }
    }
    function parseAdd() {
      let l = parseMul();
      for (;;) {
        const c = peek();
        if (c === T["+"]) { i++; l = { t: "bin", op: "+", l, r: parseMul() }; }
        else if (c === T["-"]) { i++; l = { t: "bin", op: "-", l, r: parseMul() }; }
        else return l;
      }
    }
    function parseMul() {
      let l = parseUnary();
      for (;;) {
        const c = peek();
        if (c === T["*"]) { i++; l = { t: "bin", op: "*", l, r: parseUnary() }; }
        else if (c === T["/"]) { i++; l = { t: "bin", op: "/", l, r: parseUnary() }; }
        else return l;
      }
    }
    function parseUnary() {
      const c = peek();
      if (c === T["-"]) { i++; return { t: "un", op: "-", e: parseUnary() }; }
      if (c === T["+"]) { i++; return parseUnary(); }
      return parsePow();
    }
    function parsePow() {
      let l = parsePrimary();
      while (peek() === T["^"]) { i++; const r = parseUnaryForPow(); l = { t: "bin", op: "^", l, r }; }
      return l;
    }
    function parseUnaryForPow() {
      const c = peek();
      if (c === T["-"]) { i++; return { t: "un", op: "-", e: parseUnaryForPow() }; }
      if (c === T["+"]) { i++; return parseUnaryForPow(); }
      return parsePrimary();
    }
    function parseName() {
      let s = "";
      for (;;) {
        const c = i < b.length ? b[i] : -1;
        if ((c >= 0x41 && c <= 0x5A) || (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7A)) { s += String.fromCharCode(c & 0x5F); i++; }
        else if (c === 0x20) i++;
        else break;
      }
      let suf = "";
      if (i < b.length && (b[i] === 0x24 || b[i] === 0x25)) { suf = String.fromCharCode(b[i]); i++; }
      return s.slice(0, 2) + suf;
    }
    function parseArgs() { // after '(' consumed
      const args = [];
      if (peek() === 0x29) { i++; return args; }
      for (;;) {
        args.push(parseExpr());
        const c = next();
        if (c === 0x2C) continue;
        if (c === 0x29) return args;
        throw SYNTAX();
      }
    }
    function parseNumber() {
      let s = "";
      while (i < b.length) {
        const c = b[i];
        if ((c >= 0x30 && c <= 0x39) || c === 0x2E) { s += String.fromCharCode(c); i++; }
        else if (c === 0x45 && s.length) { // exponent
          s += "E"; i++;
          if (b[i] === T["-"] || b[i] === 0x2D) { s += "-"; i++; }
          else if (b[i] === T["+"] || b[i] === 0x2B) { i++; }
        } else if (c === 0x20) i++;
        else break;
      }
      return { t: "num", v: parseFloat(s) };
    }
    const FUNCS = { SGN: 1, INT: 1, ABS: 1, USR: 1, FRE: 1, PDL: 1, POS: 1, SQR: 1, RND: 1, LOG: 1, EXP: 1, COS: 1, SIN: 1,
      TAN: 1, ATN: 1, PEEK: 1, LEN: 1, "STR$": 1, VAL: 1, ASC: 1, "CHR$": 1, "LEFT$": 1, "RIGHT$": 1, "MID$": 1, "SCRN(": 1 };
    function parsePrimary() {
      const c = peek();
      if (c < 0) throw SYNTAX();
      if ((c >= 0x30 && c <= 0x39) || c === 0x2E) return parseNumber();
      if (c === 0x22) {
        i++; let s = "";
        while (i < b.length && b[i] !== 0x22) s += String.fromCharCode(b[i++]);
        if (i < b.length) i++;
        return { t: "str", v: s };
      }
      if (c === 0x28) { i++; const e = parseExpr(); expect(0x29); return e; }
      if (c >= 0x80) {
        const name = TOKEN_NAMES[c - 0x80];
        if (name === "FN") { i++; const n = parseName(); expect(0x28); return { t: "fn", n, args: parseArgs() }; }
        if (FUNCS[name]) {
          i++;
          if (name !== "SCRN(") expect(0x28);
          return { t: "call", f: name === "SCRN(" ? "SCRN" : name, args: parseArgs() };
        }
        throw SYNTAX();
      }
      if ((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A)) {
        const n = parseName();
        if (peek() === 0x28) { i++; return { t: "idx", n, args: parseArgs() }; }
        return { t: "var", n };
      }
      throw SYNTAX();
    }
    function parseVarRef() {
      const c = peek();
      if (!((c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A))) throw SYNTAX();
      const n = parseName();
      if (peek() === 0x28) { i++; return { t: "idx", n, args: parseArgs() }; }
      return { t: "var", n };
    }
    function parseLineNumber() {
      peek();
      let s = "";
      while (i < b.length && b[i] >= 0x30 && b[i] <= 0x39) s += String.fromCharCode(b[i++]);
      if (!s) throw SYNTAX();
      return parseInt(s, 10);
    }
    function atEnd() { const c = peek(); return c < 0 || c === 0x3A; }

    // ---- statements
    function statement() {
      const c = peek();
      if (c < 0) return;
      if (c === 0x3A) { i++; return; }
      const st = line.stmts;
      if (c < 0x80) { // implicit LET
        const target = parseVarRef();
        if (next() !== T["="]) throw SYNTAX();
        st.push({ op: "let", target, e: parseExpr() });
        return;
      }
      i++;
      const name = TOKEN_NAMES[c - 0x80];
      switch (name) {
        case "REM": i = b.length; return;
        case "DATA": {
          const raw = []; let item = "", inq = false, quoted = false;
          const flush = () => { raw.push({ s: item, q: quoted }); item = ""; quoted = false; };
          while (i < b.length) {
            const ch = b[i];
            if (inq) { if (ch === 0x22) inq = false; else item += String.fromCharCode(ch); i++; continue; }
            if (ch === 0x22) { inq = true; quoted = true; i++; continue; }
            if (ch === 0x3A) break;
            if (ch === 0x2C) { flush(); i++; continue; }
            item += String.fromCharCode(ch); i++;
          }
          flush();
          for (const r of raw) prog.data.push(r);
          st.push({ op: "nop" });
          return;
        }
        case "LET": { const target = parseVarRef(); if (next() !== T["="]) throw SYNTAX(); st.push({ op: "let", target, e: parseExpr() }); return; }
        case "PRINT": {
          const items = [];
          for (;;) {
            const k = peek();
            if (k < 0 || k === 0x3A) break;
            if (k === 0x3B) { i++; items.push({ k: ";" }); continue; }
            if (k === 0x2C) { i++; items.push({ k: "," }); continue; }
            if (k === T["TAB("]) { i++; const e = parseExpr(); expect(0x29); items.push({ k: "tab", e }); continue; }
            if (k === T["SPC("]) { i++; const e = parseExpr(); expect(0x29); items.push({ k: "spc", e }); continue; }
            items.push({ k: "e", e: parseExpr() });
          }
          st.push({ op: "print", items });
          return;
        }
        case "IF": {
          const cond = parseExpr();
          const k = next();
          st.push({ op: "if", cond });
          if (k === T.THEN) {
            const q = peek();
            if (q >= 0x30 && q <= 0x39) st.push({ op: "goto", n: parseLineNumber() });
          } else if (k === T.GOTO) {
            st.push({ op: "goto", n: parseLineNumber() });
          } else throw SYNTAX();
          return;
        }
        case "GOTO": st.push({ op: "goto", n: parseLineNumber() }); return;
        case "GOSUB": st.push({ op: "gosub", n: parseLineNumber() }); return;
        case "RETURN": st.push({ op: "return" }); return;
        case "POP": st.push({ op: "pop" }); return;
        case "END": case "STOP": st.push({ op: "end" }); return;
        case "FOR": {
          const v = parseName(); if (next() !== T["="]) throw SYNTAX();
          const from = parseExpr(); if (next() !== T.TO) throw SYNTAX();
          const to = parseExpr(); let step = null;
          if (peek() === T.STEP) { i++; step = parseExpr(); }
          st.push({ op: "for", v, from, to, step });
          return;
        }
        case "NEXT": {
          const vars = [];
          if (!atEnd()) {
            for (;;) { vars.push(parseName()); if (peek() === 0x2C) { i++; continue; } break; }
          }
          st.push({ op: "next", vars });
          return;
        }
        case "ON": {
          const e = parseExpr(); const k = next();
          if (k === T.ONERR) { throw SYNTAX(); }
          if (k !== T.GOTO && k !== T.GOSUB) throw SYNTAX();
          const targets = [];
          for (;;) { targets.push(parseLineNumber()); if (peek() === 0x2C) { i++; continue; } break; }
          st.push({ op: k === T.GOTO ? "ongoto" : "ongosub", e, targets });
          return;
        }
        case "ONERR": { if (next() !== T.GOTO) throw SYNTAX(); st.push({ op: "onerr", n: parseLineNumber() }); return; }
        case "RESUME": st.push({ op: "resume" }); return;
        case "DIM": {
          const arr = [];
          for (;;) {
            const n = parseName(); expect(0x28);
            arr.push({ n, args: parseArgs() });
            if (peek() === 0x2C) { i++; continue; }
            break;
          }
          st.push({ op: "dim", arr });
          return;
        }
        case "READ": {
          const vars = [];
          for (;;) { vars.push(parseVarRef()); if (peek() === 0x2C) { i++; continue; } break; }
          st.push({ op: "read", vars });
          return;
        }
        case "INPUT": {
          let prompt = null;
          if (peek() === 0x22) {
            const s = parsePrimary(); prompt = s.v; if (peek() === 0x3B) i++;
          }
          const vars = [];
          for (;;) { vars.push(parseVarRef()); if (peek() === 0x2C) { i++; continue; } break; }
          st.push({ op: "input", prompt, vars });
          return;
        }
        case "GET": {
          const vars = [];
          for (;;) { vars.push(parseVarRef()); if (peek() === 0x2C) { i++; continue; } break; }
          st.push({ op: "get", vars });
          return;
        }
        case "RESTORE": st.push({ op: "restore" }); return;
        case "POKE": { const a = parseExpr(); expect(0x2C); st.push({ op: "poke", a, v: parseExpr() }); return; }
        case "CALL": st.push({ op: "call", a: parseExpr() }); return;
        case "WAIT": {
          const a = parseExpr(); expect(0x2C); const m = parseExpr(); let x = null;
          if (peek() === 0x2C) { i++; x = parseExpr(); }
          st.push({ op: "wait", a, m, x });
          return;
        }
        case "HTAB": st.push({ op: "htab", e: parseExpr() }); return;
        case "VTAB": st.push({ op: "vtab", e: parseExpr() }); return;
        case "HOME": st.push({ op: "home" }); return;
        case "TEXT": st.push({ op: "text" }); return;
        case "NORMAL": st.push({ op: "normal" }); return;
        case "INVERSE": st.push({ op: "inverse" }); return;
        case "FLASH": st.push({ op: "flash" }); return;
        case "HGR": st.push({ op: "hgr" }); return;
        case "HGR2": st.push({ op: "hgr2" }); return;
        case "HCOLOR=": st.push({ op: "hcolor", e: parseExpr() }); return;
        case "HPLOT": {
          const pts = []; let first = true; const segs = [];
          if (peek() === T.TO) { i++; segs.push({ to: true, x: parseExpr(), y: (expect(0x2C), parseExpr()) }); }
          else { const x = parseExpr(); expect(0x2C); const y = parseExpr(); segs.push({ to: false, x, y }); }
          while (peek() === T.TO) { i++; const x = parseExpr(); expect(0x2C); const y = parseExpr(); segs.push({ to: true, x, y }); }
          st.push({ op: "hplot", segs });
          return;
        }
        case "PR#": st.push({ op: "pr", e: parseExpr() }); return;
        case "IN#": st.push({ op: "in", e: parseExpr() }); return;
        case "HIMEM:": case "LOMEM:": parseExpr(); st.push({ op: "nop" }); return;
        case "SPEED=": parseExpr(); st.push({ op: "nop" }); return;
        case "CLEAR": st.push({ op: "clear" }); return;
        case "RUN": {
          if (atEnd()) st.push({ op: "run", n: null });
          else st.push({ op: "run", n: parseLineNumber() });
          return;
        }
        case "&": amp(); return;
        case "TRACE": case "NOTRACE": st.push({ op: "nop" }); return;
        default: throw SYNTAX();
      }
    }

    // RDOS ampersand commands: & RECALL "name"[,addr], & RUN "name"[,addr], & STORE name,addr,len, ...
    function amp() {
      const st = line.stmts;
      const c = next();
      const name = c >= 0x80 ? TOKEN_NAMES[c - 0x80] : String.fromCharCode(c);
      switch (name) {
        case "RECALL": case "RUN": {
          const f = parseExpr(); let addr = null;
          if (peek() === 0x2C) { i++; addr = parseExpr(); }
          st.push({ op: "amp", cmd: name, f, addr });
          return;
        }
        case "STORE": { const f = parseExpr(); expect(0x2C); const addr = parseExpr(); expect(0x2C); const len = parseExpr(); st.push({ op: "amp", cmd: "STORE", f, addr, len }); return; }
        case "DEL": case "READ": case "PRINT": { const f = parseExpr(); st.push({ op: "amp", cmd: name, f }); return; }
        case "END": st.push({ op: "amp", cmd: "END" }); return;
        default: // unsupported utility command (disk copier); skip to the end of the statement
          while (!atEnd()) i++;
          st.push({ op: "amp", cmd: "?" + name });
      }
    }

    try {
      while (i < b.length) {
        const before = i;
        statement();
        if (i === before) i++;
        const c = peek();
        if (c === 0x3A) i++;
      }
    } catch (e) {
      if (e instanceof BasicError) line.stmts.push({ op: "syntax" });
      else throw e;
    }
  }

  // ------------------------------------------------------------------ number formatting
  function fmtNum(n) {
    if (n === 0) return "0";
    if (Number.isInteger(n) && Math.abs(n) < 1e9) return String(n);
    const a = Math.abs(n);
    let s;
    if (a >= 1e9 || a < 1e-2) {
      s = n.toExponential(8).replace(/\.?0+e/, "E");
      s = s.replace(/E([+-])(\d)$/, "E$10$2");
      if (!/E[+-]/.test(s)) s = s.replace("E", "E+");
      return s;
    }
    s = parseFloat(n.toPrecision(9)).toString();
    if (s.startsWith("0.")) s = s.slice(1);
    else if (s.startsWith("-0.")) s = "-" + s.slice(2);
    return s;
  }

  function valOf(s) {
    const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)(E[-+]?\d+)?/i.exec(s);
    return m ? parseFloat(m[0]) : 0;
  }

  // ------------------------------------------------------------------ interpreter
  class Interpreter {
    constructor(machine, dos) {
      this.m = machine;
      this.dos = dos;
      this.prog = null;
      this.li = 0; this.si = 0;
      this.stack = [];
      this.vars = new Map();
      this.arrays = new Map();
      this.fns = new Map();
      this.dataPos = 0;
      this.errTrap = null;
      this.hcolor = 0;
      this.hx = 0; this.hy = 0;
      this.seed = 1;
      this.halted = false;
      this.pending = null;
      this.recent = "";   // recent PRINT output for prompt detection
      this.onHalt = null;
    }

    loadProgram(prog, line) {
      this.prog = prog;
      this.vars = new Map(); this.arrays = new Map(); this.fns = new Map();
      this.stack = []; this.dataPos = 0; this.errTrap = null;
      this.li = 0; this.si = 0;
      if (line != null) this.jump(line);
    }

    jump(n) {
      const li = this.prog.index.get(n);
      if (li === undefined) throw err("UNDEF'D STATEMENT ERROR", 90);
      this.li = li; this.si = 0;
    }

    // ---- variables
    getVar(n) {
      const v = this.vars.get(n);
      if (v !== undefined) return v;
      return n.endsWith("$") ? "" : 0;
    }
    setVar(n, v) {
      if (n.endsWith("$")) { if (typeof v !== "string") throw err("TYPE MISMATCH ERROR", 163); }
      else {
        if (typeof v === "string") throw err("TYPE MISMATCH ERROR", 163);
        if (n.endsWith("%")) { v = Math.floor(v); if (v > 32767 || v < -32768) throw err("ILLEGAL QUANTITY ERROR", 53); }
      }
      this.vars.set(n, v);
    }
    arrKey(n) { return n; }
    getArray(n, nd) {
      let a = this.arrays.get(n);
      if (!a) {
        a = this.makeArray(n, new Array(nd).fill(10));
        this.arrays.set(n, a);
      }
      return a;
    }
    makeArray(n, dims) {
      let size = 1;
      for (const d of dims) size *= (d + 1);
      const init = n.endsWith("$") ? "" : 0;
      return { dims, data: new Array(size).fill(init) };
    }
    arrIndex(a, idx) {
      if (idx.length !== a.dims.length) throw err("BAD SUBSCRIPT ERROR", 107);
      let k = 0;
      for (let d = 0; d < idx.length; d++) {
        const v = Math.floor(idx[d]);
        if (v < 0 || v > a.dims[d]) throw err("BAD SUBSCRIPT ERROR", 107);
        k = k * (a.dims[d] + 1) + v;
      }
      return k;
    }

    // ---- expression evaluation
    ev(e) {
      switch (e.t) {
        case "num": return e.v;
        case "str": return e.v;
        case "var": return this.getVar(e.n);
        case "idx": {
          const a = this.getArray(e.n, e.args.length);
          return a.data[this.arrIndex(a, e.args.map(x => this.num(this.ev(x))))];
        }
        case "un": {
          const v = this.ev(e.e);
          if (e.op === "-") return -this.num(v);
          return this.num(v) ? 0 : 1;
        }
        case "rel": {
          const l = this.ev(e.l), r = this.ev(e.r);
          if (typeof l !== typeof r) throw err("TYPE MISMATCH ERROR", 163);
          const lt = l < r, gt = l > r, eq = l === r;
          return ((e.lt && lt) || (e.gt && gt) || (e.eq && eq)) ? 1 : 0;
        }
        case "bin": return this.bin(e);
        case "call": return this.callFn(e);
        case "fn": {
          const f = this.fns.get(e.n);
          if (!f) throw err("UNDEF'D FUNCTION ERROR", 254);
          const save = this.vars.get(f.p);
          this.vars.set(f.p, this.ev(e.args[0]));
          const r = this.ev(f.e);
          if (save === undefined) this.vars.delete(f.p); else this.vars.set(f.p, save);
          return r;
        }
        default: throw SYNTAX();
      }
    }
    num(v) { if (typeof v === "string") throw err("TYPE MISMATCH ERROR", 163); return v; }
    str(v) { if (typeof v !== "string") throw err("TYPE MISMATCH ERROR", 163); return v; }
    bin(e) {
      const l = this.ev(e.l);
      if (e.op === "OR") { return (this.num(l) || this.num(this.ev(e.r))) ? 1 : 0; }
      if (e.op === "AND") { return (this.num(l) && this.num(this.ev(e.r))) ? 1 : 0; }
      const r = this.ev(e.r);
      if (e.op === "+") {
        if (typeof l === "string") { return l + this.str(r); }
        return this.num(l) + this.num(r);
      }
      this.num(l); this.num(r);
      switch (e.op) {
        case "-": return l - r;
        case "*": return l * r;
        case "/": if (r === 0) throw err("DIVISION BY ZERO ERROR", 133); return l / r;
        case "^": return Math.pow(l, r);
        default: throw SYNTAX();
      }
    }
    callFn(e) {
      const a = e.args.map(x => this.ev(x));
      switch (e.f) {
        case "SGN": return Math.sign(this.num(a[0]));
        case "INT": return Math.floor(this.num(a[0]));
        case "ABS": return Math.abs(this.num(a[0]));
        case "SQR": return Math.sqrt(this.num(a[0]));
        case "LOG": return Math.log(this.num(a[0]));
        case "EXP": return Math.exp(this.num(a[0]));
        case "COS": return Math.cos(this.num(a[0]));
        case "SIN": return Math.sin(this.num(a[0]));
        case "TAN": return Math.tan(this.num(a[0]));
        case "ATN": return Math.atan(this.num(a[0]));
        case "RND": return Math.random();
        case "FRE": return 20000;
        case "POS": return this.m.ram[0x24];
        case "PDL": return 255;
        case "USR": return 0;
        case "SCRN": return 0;
        case "PEEK": { let ad = Math.floor(this.num(a[0])); if (ad < 0) ad += 65536; return this.m.peek(ad); }
        case "LEN": return this.str(a[0]).length;
        case "STR$": return fmtNum(this.num(a[0]));
        case "VAL": return valOf(this.str(a[0]));
        case "ASC": { const s = this.str(a[0]); if (!s.length) throw err("ILLEGAL QUANTITY ERROR", 53); return s.charCodeAt(0); }
        case "CHR$": { const n = Math.floor(this.num(a[0])); if (n < 0 || n > 255) throw err("ILLEGAL QUANTITY ERROR", 53); return String.fromCharCode(n); }
        case "LEFT$": return this.str(a[0]).slice(0, Math.max(0, Math.floor(this.num(a[1]))));
        case "RIGHT$": { const s = this.str(a[0]), n = Math.max(0, Math.floor(this.num(a[1]))); return n === 0 ? "" : s.slice(-n); }
        case "MID$": {
          const s = this.str(a[0]), st = Math.floor(this.num(a[1]));
          if (st < 1) throw err("ILLEGAL QUANTITY ERROR", 53);
          if (a.length > 2) return s.substr(st - 1, Math.max(0, Math.floor(this.num(a[2]))));
          return s.slice(st - 1);
        }
        default: throw SYNTAX();
      }
    }

    // ---- screen output
    outChar(c) { // c = ASCII code without high bit
      if (this.dos.writing) { this.dos.writeByte(c & 0x7F); return; }
      this.m.cout((c & 0xFF) | 0x80);
    }
    outStr(s) {
      for (let k = 0; k < s.length; k++) this.outChar(s.charCodeAt(k));
      this.recent = (this.recent + s).slice(-160);
    }

    // ---- error handling
    reportError(e) {
      this.halted = true;
      const ln = this.prog && this.prog.lines[this.li] ? this.prog.lines[this.li].num : 0;
      this.errorText = "?" + (e.msg || String(e)) + " IN " + ln;
      if (this.onHalt) this.onHalt(this.errorText);
    }

    // ---- keyboard for GET / INPUT (honours the KSW input hook)
    *rdkey(x = 0) {
      const r = this.m.ram;
      for (;;) {
        const ksw = r[0x38] | (r[0x39] << 8);
        if (ksw === 0xFD1B) {
          const k = this.m.takeKey();
          if (k >= 0) return k | 0x80;
          yield "key";
        } else {
          const cur = (r[0x29] << 8) + r[0x28] + r[0x24];
          const under = r[cur];
          r[cur] = (under & 0x3F) | 0x40;
          const mm = this.m;
          mm.startML(ksw, under, x, r[0x24]);
          for (;;) {
            if (mm.runML()) break;
            yield "key";
          }
          return mm.cpu.a;
        }
      }
    }

    *getln() {
      const r = this.m.ram;
      let buf = "";
      for (;;) {
        const k = yield* this.rdkey(buf.length);
        if (k === 0x8D) {
          this.m.clrEol();
          this.m.cout(0x8D);
          return buf;
        }
        if (k === 0x88 || k === 0xFF) {
          if (buf.length) { buf = buf.slice(0, -1); this.m.cout(0x88); }
          continue;
        }
        if (k === 0x98 || k === 0x9B) { buf = ""; this.m.cout(0x8D); return ""; }
        // Like the monitor's GETLN, any other byte (including the unflagged lowercase text that
        // the game's own input hook delivers) is stored and echoed.
        if (buf.length < 239) { buf += String.fromCharCode(k & 0x7F); this.m.cout(k); }
      }
    }

    // ---- statement execution
    *run() {
      let count = 0;
      while (!this.halted) {
        try {
          while (!this.halted) {
            const prog = this.prog;
            if (this.li >= prog.lines.length) { this.halted = true; return; }
            const line = prog.lines[this.li];
            if (this.si >= line.stmts.length) { this.li++; this.si = 0; continue; }
            const s = line.stmts[this.si++];
            if (this.trace) { this.trace.push(line.num + ":" + s.op); if (this.trace.length > 80) this.trace.shift(); }
            if (++count > 40000) { count = 0; yield "tick"; }
            if (this.m.wantYield) { this.m.wantYield = false; yield "key"; }
            if (this.pendingDelay) { const d = this.pendingDelay; this.pendingDelay = 0; yield { delay: d }; }
            switch (s.op) {
              case "get": case "input": case "wait": case "call":
                yield* this.execBlocking(s); break;
              default: {
                const r = this.exec(s);
                if (r === "reset") return "reset";
              }
            }
          }
        } catch (e) {
          if (!(e instanceof BasicError)) throw e;
          if (this.errTrap == null) { this.reportError(e); return; }
          const ln = this.prog.lines[this.li] ? this.prog.lines[this.li].num : 0;
          if (this.trace) this.lastTrace = this.trace.slice();
          (this.errors = this.errors || []).push(e.msg + " @" + (this.prog.lines[this.li - 0] ? ln : "?") + " stmt " + (this.si - 1));
          this.m.ram[0xDE] = e.code & 0xFF;
          this.m.ram[0xDA] = ln & 0xFF; this.m.ram[0xDB] = ln >> 8;
          this.errPos = { li: this.li, si: this.si };
          try { this.jump(this.errTrap); } catch (e2) { this.reportError(e2); return; }
        }
      }
    }

    *execBlocking(s) {
      const m = this.m;
      switch (s.op) {
        case "call": {
          let ad = Math.floor(this.num(this.ev(s.a)));
          if (ad < 0) ad += 65536;
          if (this.nativeCall(ad)) return;
          m.startML(ad, 0, 0, 0);
          for (;;) {
            if (m.runML()) break;
            yield "key";
          }
          return;
        }
        case "wait": {
          let ad = Math.floor(this.num(this.ev(s.a))); if (ad < 0) ad += 65536;
          const mask = this.num(this.ev(s.m)), xr = s.x ? this.num(this.ev(s.x)) : 0;
          for (;;) {
            const v = m.peek(ad);
            if (((v ^ xr) & mask) !== 0) return;
            yield "key";
          }
        }
        case "get": {
          for (const v of s.vars) {
            const k = yield* this.rdkey(0);
            this.dos.notePrompt(this.recent); this.recent = "";
            this.assign(v, String.fromCharCode(k & 0x7F));
          }
          return;
        }
        case "input": {
          let prompted = false;
          if (this.dos.reading) {
            for (const v of s.vars) {
              const f = this.dos.nextField();
              this.assign(v, v.n.endsWith("$") ? f : valOf(f));
            }
            return;
          }
          if (s.prompt != null) { this.outStr(s.prompt); prompted = true; }
          let fields = [], idx = 0;
          let promptCh = prompted ? null : "?";
          for (const v of s.vars) {
            while (idx >= fields.length) {
              if (promptCh) { this.m.cout(promptCh.charCodeAt(0) | 0x80); promptCh = "??"; if (fields.length) { this.m.cout(0xBF); } }
              const line = yield* this.getln();
              fields = fields.concat(splitInput(line));
              if (!fields.length) fields = [""];
              promptCh = "?";
            }
            let val = fields[idx++];
            if (v.n.endsWith("$")) this.assign(v, val);
            else this.assign(v, valOf(val));
          }
          return;
        }
      }
    }

    nativeCall(ad) {
      const r = this.m.ram;
      const reset = r[0x3F2] | (r[0x3F3] << 8);
      if (ad === reset) { this.resetRequested = true; this.halted = true; return true; }
      if (ad === 0xFC66 || ad === 65536 - 922) { this.m.lineFeed(); return true; }
      if (this.nativeHooks && this.nativeHooks[ad]) { this.nativeHooks[ad](); return true; }
      return false;
    }

    assign(target, v) {
      if (target.t === "var") this.setVar(target.n, v);
      else {
        const a = this.getArray(target.n, target.args.length);
        if (target.n.endsWith("$")) { if (typeof v !== "string") throw err("TYPE MISMATCH ERROR", 163); }
        else if (typeof v === "string") throw err("TYPE MISMATCH ERROR", 163);
        const k = this.arrIndex(a, target.args.map(x => this.num(this.ev(x))));
        a.data[k] = target.n.endsWith("%") ? Math.floor(v) : v;
      }
    }

    exec(s) {
      const m = this.m;
      switch (s.op) {
        case "nop": return;
        case "syntax": throw SYNTAX();
        case "let": this.assign(s.target, this.ev(s.e)); return;
        case "print": {
          const items = s.items;
          let trailing = false;
          for (let k = 0; k < items.length; k++) {
            const it = items[k];
            trailing = false;
            if (it.k === ";") { trailing = true; continue; }
            if (it.k === ",") {
              trailing = true;
              const ch = m.ram[0x24];
              let target = (Math.floor(ch / 16) + 1) * 16;
              if (target >= m.ram[0x21]) { m.cout(0x8D); continue; }
              while (m.ram[0x24] < target) this.outChar(0x20);
              continue;
            }
            if (it.k === "tab") { const n = Math.floor(this.num(this.ev(it.e))); while (m.ram[0x24] < n - 1) this.outChar(0x20); continue; }
            if (it.k === "spc") { const n = Math.floor(this.num(this.ev(it.e))); for (let q = 0; q < n; q++) this.outChar(0x20); continue; }
            const v = this.ev(it.e);
            this.outStr(typeof v === "string" ? v : fmtNum(v));
          }
          if (!trailing) this.outChar(0x0D);
          return;
        }
        case "if": if (!this.num(this.ev(s.cond))) { this.si = this.prog.lines[this.li].stmts.length; } return;
        case "goto": this.jump(s.n); return;
        case "gosub": this.stack.push({ k: "gosub", li: this.li, si: this.si }); this.jump(s.n); return;
        case "return": {
          for (;;) {
            const f = this.stack.pop();
            if (!f) throw err("RETURN WITHOUT GOSUB ERROR", 22);
            if (f.k === "gosub") { this.li = f.li; this.si = f.si; return; }
          }
        }
        case "pop": {
          for (;;) {
            const f = this.stack.pop();
            if (!f) throw err("RETURN WITHOUT GOSUB ERROR", 22);
            if (f.k === "gosub") return;
          }
        }
        case "end": this.halted = true; return;
        case "for": {
          const from = this.num(this.ev(s.from)), to = this.num(this.ev(s.to));
          const step = s.step ? this.num(this.ev(s.step)) : 1;
          this.setVar(s.v, from);
          // drop an existing frame for the same variable
          // Like Applesoft, only the FOR frames on top of the stack (above any GOSUB) are searched.
          for (let k = this.stack.length - 1; k >= 0 && this.stack[k].k === "for"; k--) if (this.stack[k].v === s.v) { this.stack.length = k; break; }
          this.stack.push({ k: "for", v: s.v, from, to, step, li: this.li, si: this.si });
          return;
        }
        case "next": {
          const names = s.vars.length ? s.vars : [null];
          for (const nm of names) {
            let k = this.stack.length - 1;
            for (; k >= 0 && this.stack[k].k === "for"; k--) { const f = this.stack[k]; if (nm === null || f.v === nm) break; }
            if (k >= 0 && this.stack[k].k !== "for") k = -1;
            if (k < 0) throw err("NEXT WITHOUT FOR ERROR", 0);
            this.stack.length = k + 1;
            const f = this.stack[k];
            let val = this.num(this.getVar(f.v)) + f.step;
            if (f.li === this.li && f.si === this.si - 1 && f.step !== 0) {
              // empty body: jump straight to the last iteration
              const left = Math.floor((f.to - val) / f.step);
              if (left > 0) val += left * f.step;
            }
            this.vars.set(f.v, f.v.endsWith("%") ? Math.floor(val) : val);
            const cont = f.step >= 0 ? val <= f.to : val >= f.to;
            if (cont) { this.li = f.li; this.si = f.si; return; }
            // An empty FOR...NEXT is a timing delay: finish it at once, then wait about as long as an
            // Apple II would (roughly half a millisecond per Applesoft loop iteration).
            if (f.li === this.li && f.si === this.si - 1) {
              const n = Math.max(0, Math.floor((f.to - f.from) / f.step) + 1);
              this.pendingDelay = (this.pendingDelay || 0) + n * 0.45;
            }
            this.stack.pop();
          }
          return;
        }
        case "ongoto": case "ongosub": {
          const n = Math.floor(this.num(this.ev(s.e)));
          if (n < 0 || n > 255) throw err("ILLEGAL QUANTITY ERROR", 53);
          if (n >= 1 && n <= s.targets.length) {
            if (s.op === "ongosub") this.stack.push({ k: "gosub", li: this.li, si: this.si });
            this.jump(s.targets[n - 1]);
          }
          return;
        }
        case "onerr": this.errTrap = s.n; return;
        case "resume": if (this.errPos) { this.li = this.errPos.li; this.si = this.errPos.si - 1; } return;
        case "dim": {
          for (const d of s.arr) {
            if (this.arrays.has(d.n)) throw err("REDIM'D ARRAY ERROR", 120);
            this.arrays.set(d.n, this.makeArray(d.n, d.args.map(x => Math.floor(this.num(this.ev(x))))));
          }
          return;
        }
        case "read": {
          for (const v of s.vars) {
            if (this.dataPos >= this.prog.data.length) throw err("OUT OF DATA ERROR", 42);
            const it = this.prog.data[this.dataPos++];
            const raw = it.q ? it.s : it.s.replace(/^ +/, "");
            if (v.n.endsWith("$")) this.assign(v, raw);
            else {
              if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)(E[-+]?\d+)?\s*$/i.test(raw) && raw.trim() !== "") throw SYNTAX();
              this.assign(v, valOf(raw));
            }
          }
          return;
        }
        case "restore": this.dataPos = 0; return;
        case "poke": {
          let a = Math.floor(this.num(this.ev(s.a))); if (a < 0) a += 65536;
          const v = Math.floor(this.num(this.ev(s.v)));
          if (v < 0 || v > 255 || a < 0 || a > 65535) throw err("ILLEGAL QUANTITY ERROR", 53);
          m.poke(a, v);
          return;
        }
        case "htab": {
          const n = Math.floor(this.num(this.ev(s.e)));
          if (n < 1 || n > 255) throw err("ILLEGAL QUANTITY ERROR", 53);
          const w = m.ram[0x21];
          m.ram[0x24] = (n - 1) % w;
          return;
        }
        case "vtab": {
          const n = Math.floor(this.num(this.ev(s.e)));
          if (n < 1 || n > 24) throw err("ILLEGAL QUANTITY ERROR", 53);
          m.vtab(n - 1);
          return;
        }
        case "home": m.home(); return;
        case "text": {
          const r = m.ram; m.graphics = false;
          r[0x20] = 0; r[0x21] = 40; r[0x22] = 0; r[0x23] = 24; m.vtab(23); return;
        }
        case "normal": m.ram[0x32] = 0xFF; return;
        case "inverse": m.ram[0x32] = 0x3F; return;
        case "flash": m.ram[0x32] = 0x7F; return;
        case "pr": {
          const n = Math.floor(this.num(this.ev(s.e)));
          if (n === 0) { m.ram[0x36] = 0xF0; m.ram[0x37] = 0xFD; }
          else { m.ram[0x36] = 0; m.ram[0x37] = 0xC0 + n; }
          return;
        }
        case "in": {
          const n = Math.floor(this.num(this.ev(s.e)));
          if (n === 0) { m.ram[0x38] = 0x1B; m.ram[0x39] = 0xFD; }
          return;
        }
        case "hgr": SS.Hires.hgr(m, 1); return;
        case "hgr2": SS.Hires.hgr(m, 2); return;
        case "hcolor": this.hcolor = Math.floor(this.num(this.ev(s.e))) & 7; return;
        case "hplot": {
          for (const g of s.segs) {
            const x = Math.floor(this.num(this.ev(g.x))), y = Math.floor(this.num(this.ev(g.y)));
            if (x < 0 || x > 279 || y < 0 || y > 191) throw err("ILLEGAL QUANTITY ERROR", 53);
            if (g.to) SS.Hires.line(m, this.hx, this.hy, x, y, this.hcolor);
            else SS.Hires.plot(m, x, y, this.hcolor);
            this.hx = x; this.hy = y;
          }
          return;
        }
        case "clear": this.vars = new Map(); this.arrays = new Map(); this.stack = []; this.dataPos = 0; return;
        case "run": {
          this.vars = new Map(); this.arrays = new Map(); this.fns = new Map(); this.stack = []; this.dataPos = 0; this.errTrap = null;
          if (s.n == null) { this.li = 0; this.si = 0; } else this.jump(s.n);
          return;
        }
        case "amp": return this.dos.command(this, s);
        default: throw err("UNSUPPORTED STATEMENT " + s.op, 16);
      }
    }
  }

  // INPUT field splitting: commas separate fields, quotes protect commas, leading blanks skipped.
  function splitInput(line) {
    const out = []; let i = 0;
    while (i <= line.length) {
      while (line[i] === " ") i++;
      let item = "";
      if (line[i] === '"') {
        i++;
        while (i < line.length && line[i] !== '"') item += line[i++];
        if (line[i] === '"') i++;
        while (i < line.length && line[i] !== ",") i++;
      } else {
        while (i < line.length && line[i] !== ",") item += line[i++];
      }
      out.push(item);
      if (line[i] !== ",") break;
      i++;
    }
    return out;
  }

  SS.Interpreter = Interpreter;
  SS.parseProgram = parseProgram;
  SS.BasicError = BasicError;
  SS.fmtNum = fmtNum;
  SS.splitInput = splitInput;
})(typeof SS !== "undefined" ? SS : (globalThis.SS = globalThis.SS || {}));
