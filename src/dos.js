// SSI RDOS 3.3 file system emulation: reads the two game disk images, serves
// the "&" commands (RECALL, RUN, STORE, DEL, READ, PRINT, END) and keeps saved
// changes in an overlay that is persisted through a storage object.
(function (SS) {
  "use strict";

  // File sector n of a track lives at this sector of the .dsk image.
  const SKEW = [0, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 15];

  function sector(img, lin) {
    const t = lin >> 4, s = lin & 15;
    const p = (t * 16 + SKEW[s]) * 256;
    return img.subarray(p, p + 256);
  }

  function parseCatalog(img) {
    const files = new Map();
    for (let lin = 16; lin < 28; lin++) {
      const sec = sector(img, lin);
      for (let i = 0; i < 256; i += 32) {
        if (lin === 16 && i === 0) continue;
        const e = sec.subarray(i, i + 32);
        if (e[0] === 0 || e[0] === 0x80) continue;
        let name = "";
        for (let k = 0; k < 24; k++) name += String.fromCharCode(e[k] & 0x7F);
        name = name.replace(/\s+$/, "");
        const type = String.fromCharCode(e[24] & 0x7F);
        const nsec = e[25];
        const load = e[26] | (e[27] << 8);
        const length = e[28] | (e[29] << 8);
        const start = e[30] | (e[31] << 8);
        files.set(name, { name, type, nsec, load, length, start });
      }
    }
    return files;
  }

  function readFileBytes(img, ent) {
    const out = new Uint8Array(ent.nsec * 256);
    for (let n = 0; n < ent.nsec; n++) out.set(sector(img, ent.start + n), n * 256);
    return out;
  }

  class Dos {
    constructor(machine, images, storage) {
      this.m = machine;
      this.images = images;
      this.catalogs = images.map(parseCatalog);
      this.overlay = [new Map(), new Map()]; // name -> {type, load, data} | null (deleted)
      this.storage = storage || null;
      this.cur = 0;
      this.reading = null;
      this.writing = null;
      this.programCache = new Map();
      this.log = [];
      this.loadOverlay();
      this.installHooks();
    }

    // RDOS routines that the game's machine code calls directly.
    installHooks() {
      const dos = this;
      this.m.hooks = {
        // $BF93: print the catalog of the current disk, one line per file
        0xBF93(c) {
          for (const line of dos.catalogLines()) {
            for (let k = 0; k < line.length; k++) this.cout(line.charCodeAt(k) | 0x80);
            this.cout(0x8D);
          }
          return this.rts(c);
        },
      };
    }

    catalogLines() {
      const d = this.cur, out = [];
      const names = new Set();
      for (const [name, e] of this.catalogs[d]) {
        if (this.overlay[d].has(name) && !this.overlay[d].get(name)) continue;
        names.add(name); out.push({ name, type: e.type, nsec: e.nsec });
      }
      for (const [name, f] of this.overlay[d]) {
        if (!f || names.has(name)) continue;
        out.push({ name, type: f.type, nsec: Math.ceil(f.data.length / 256) });
      }
      return out.map(e => e.type + " " + String(e.nsec).padStart(3, "0") + " " + e.name);
    }

    // ---------------------------------------------------------- persistence
    loadOverlay() {
      if (!this.storage) return;
      try {
        const raw = this.storage.getItem("shardOfSpring.overlay");
        if (!raw) return;
        const obj = JSON.parse(raw);
        for (let d = 0; d < 2; d++) {
          for (const [name, f] of Object.entries(obj[d] || {})) {
            if (f === null) this.overlay[d].set(name, null);
            else this.overlay[d].set(name, { type: f.type, load: f.load, data: b64ToBytes(f.data) });
          }
        }
      } catch (e) { /* ignore corrupt storage */ }
    }
    saveOverlay() {
      if (!this.storage) return;
      const obj = [{}, {}];
      for (let d = 0; d < 2; d++) {
        for (const [name, f] of this.overlay[d]) obj[d][name] = f === null ? null : { type: f.type, load: f.load, data: bytesToB64(f.data) };
      }
      try { this.storage.setItem("shardOfSpring.overlay", JSON.stringify(obj)); } catch (e) { /* quota */ }
    }
    resetSaves() {
      this.overlay = [new Map(), new Map()];
      this.saveOverlay();
    }

    // ---------------------------------------------------------- lookup
    lookupOn(d, name) {
      if (this.overlay[d].has(name)) {
        const f = this.overlay[d].get(name);
        return f ? { disk: d, ...f } : null;
      }
      const ent = this.catalogs[d].get(name);
      if (!ent) return null;
      const bytes = readFileBytes(this.images[d], ent);
      const len = ent.type === "B" && ent.length > 0 && ent.length <= bytes.length ? ent.length : bytes.length;
      return { disk: d, type: ent.type, load: ent.load, data: bytes.subarray(0, len), raw: bytes, length: ent.length };
    }

    find(name) {
      let f = this.lookupOn(this.cur, name);
      if (f) return f;
      const other = 1 - this.cur;
      f = this.lookupOn(other, name);
      if (f) { this.cur = other; this.log.push("disk -> " + (other + 1)); return f; }
      return null;
    }

    // The game tells the player which disk to insert; follow its prompts.
    notePrompt(text) {
      let starter = -1, game = -1, m;
      const rs = /insert\s+(the\s+)?(starter|master)/gi, rg = /insert\s+(the\s+)?game/gi;
      while ((m = rs.exec(text))) starter = m.index;
      while ((m = rg.exec(text))) game = m.index;
      if (starter > game) this.cur = 0; else if (game > starter) this.cur = 1;
    }

    fileError(msg, code) { return new SS.BasicError(msg, code); }

    getProgram(name) {
      const f = this.find(name);
      if (!f) throw this.fileError("FILE NOT FOUND", 6);
      if (f.type !== "A") throw this.fileError("FILE TYPE ERROR", 13);
      const key = f.disk + ":" + name + ":" + f.data.length;
      let p = this.programCache.get(key);
      if (!p) { p = SS.parseProgram(f.raw || f.data, f.load); if (name === "START") patchStart(p);
        patchTypingEcho(p); this.programCache.set(key, p); }
      return p;
    }

    // ---------------------------------------------------------- & commands
    command(interp, s) {
      const m = this.m;
      const strArg = (e) => { const v = interp.ev(e); if (typeof v !== "string") throw this.fileError("TYPE MISMATCH ERROR", 163); return v; };
      const numArg = (e) => { let v = Math.floor(interp.num(interp.ev(e))); if (v < 0) v += 65536; return v; };
      switch (s.cmd) {
        case "RECALL": {
          const name = strArg(s.f);
          const f = this.find(name);
          if (!f) throw this.fileError("FILE NOT FOUND", 6);
          if (f.type === "A") throw this.fileError("FILE TYPE ERROR", 13);
          const addr = s.addr ? numArg(s.addr) : f.load;
          let d = f.data;
          // The disk-serial check cannot be satisfied by a raw disk image; report a valid game disk.
          if (name === "SOS ID") d = Uint8Array.of(0xFF);
          for (let k = 0; k < d.length; k++) m.write((addr + k) & 0xFFFF, d[k]);
          return;
        }
        case "RUN": {
          const name = strArg(s.f);
          const prog = this.getProgram(name);
          interp.loadProgram(prog);
          this.reading = null;
          return;
        }
        case "STORE": {
          const name = strArg(s.f), addr = numArg(s.addr), len = numArg(s.len);
          const data = new Uint8Array(len);
          for (let k = 0; k < len; k++) data[k] = m.peek((addr + k) & 0xFFFF);
          this.putFile(1, name, "B", addr, data);
          return;
        }
        case "DEL": {
          const name = strArg(s.f);
          for (const d of [this.cur, 1 - this.cur]) {
            if (this.lookupOn(d, name)) { this.overlay[d].set(name, null); this.saveOverlay(); return; }
          }
          throw this.fileError("FILE NOT FOUND", 6);
        }
        case "READ": {
          const name = strArg(s.f);
          const f = this.find(name);
          if (!f) throw this.fileError("FILE NOT FOUND", 6);
          this.reading = { data: f.raw || f.data, pos: 0, fields: [], fi: 0 };
          return;
        }
        case "PRINT": {
          const name = strArg(s.f);
          this.writing = { name, bytes: [] };
          return;
        }
        case "END": {
          if (this.writing) {
            this.putFile(1, this.writing.name, "T", 0x0D00, Uint8Array.from(this.writing.bytes));
            this.writing = null;
          }
          this.reading = null;
          return;
        }
        default:
          throw this.fileError("DOS SYNTAX ERROR", 2);
      }
    }

    putFile(d, name, type, load, data) {
      this.overlay[d].set(name, { type, load, data });
      this.saveOverlay();
    }

    writeByte(c) { if (this.writing) this.writing.bytes.push(c); }

    // INPUT from a text file: one comma separated field per variable.
    nextField() {
      const r = this.reading;
      for (;;) {
        if (r.fi < r.fields.length) return r.fields[r.fi++];
        if (r.pos >= r.data.length || r.data[r.pos] === 0) throw this.fileError("OUT OF DATA ERROR", 42);
        let line = "";
        while (r.pos < r.data.length) {
          const c = r.data[r.pos++] & 0x7F;
          if (c === 0x0D || r.data[r.pos - 1] === 0) { break; }
          line += String.fromCharCode(c);
        }
        r.fields = SS.splitInput(line); r.fi = 0;
      }
    }
  }

  // The "Make game disk" utility formats and copies real floppies. Saves are automatic here,
  // so replace that screen with a short note and return to the menu.
  function patchStart(prog) {
    const line = (n) => prog.lines[prog.index.get(n)];
    const l1500 = line(1500), l1520 = line(1520);
    if (l1500) {
      const texts = { "Create game disk": "Game disks are not", "Insert starter": "needed here: your", "disk and hit a": "progress is kept in", "key (or ESC to": "this browser.", "exit)": "(hit any key)" };
      for (const s of l1500.stmts) {
        if (s.op === "print") for (const it of s.items) if (it.k === "e" && it.e.t === "str" && texts[it.e.v]) it.e.v = texts[it.e.v];
      }
    }
    if (l1520) l1520.stmts = [{ op: "get", vars: [{ t: "var", n: "A$" }] }, { op: "goto", n: 200 }];
  }

  // The game stores typed names in capitals and shows every letter after the first in lower case.
  // Make the characters echoed while typing follow the same rule, so a name looks right as it is typed.
  function patchTypingEcho(prog) {
    const num = (v) => ({ t: "num", v });
    for (const line of prog.lines) {
      for (const s of line.stmts) {
        if (s.op !== "print") continue;
        for (const it of s.items) {
          const e = it.e;
          if (it.k !== "e" || !e || e.t !== "call" || e.f !== "CHR$" || e.args.length !== 1) continue;
          const a = e.args[0];
          if (a.t !== "var" || (a.n !== "I" && a.n !== "II")) continue;
          const letter = { t: "bin", op: "AND",
            l: { t: "rel", lt: false, gt: true, eq: false, l: a, r: num(64) },
            r: { t: "bin", op: "AND", l: { t: "rel", lt: true, gt: false, eq: false, l: a, r: num(91) },
                 r: { t: "rel", lt: false, gt: true, eq: false, l: { t: "call", f: "LEN", args: [{ t: "var", n: "A$" }] }, r: num(1) } } };
          e.args[0] = { t: "bin", op: "+", l: a, r: { t: "bin", op: "*", l: num(32), r: letter } };
        }
      }
    }
  }

  function bytesToB64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return typeof btoa === "function" ? btoa(s) : Buffer.from(u8).toString("base64");
  }
  function b64ToBytes(b64) {
    if (typeof atob === "function") { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
    return new Uint8Array(Buffer.from(b64, "base64"));
  }

  SS.Dos = Dos;
  SS.b64ToBytes = b64ToBytes;
  SS.bytesToB64 = bytesToB64;
})(typeof SS !== "undefined" ? SS : (globalThis.SS = globalThis.SS || {}));
