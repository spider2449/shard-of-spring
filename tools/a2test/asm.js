// Tiny two-pass 6502 assembler for the tests (documented NMOS opcodes, labels, .byte).
module.exports = function assemble(src, org) {
  global.A2 = global.A2 || {};
  if (!global.A2.CPU) require("../../src/a2/cpu65.js");
  const { NMOS, MODES } = global.A2.CPU;
  const ops = {};
  for (const [name, e] of Object.entries(NMOS)) for (let i = 1; i < e.length; i++) { (ops[name] = ops[name] || {})[e[i][1]] = e[i][0]; }
  const lines = src.split("\n").map((l) => l.replace(/;.*$/, "").trim()).filter(Boolean);
  const parsed = [];
  const labels = {};
  let pc = org;
  const num = (t) => (t[0] === "$" ? parseInt(t.slice(1), 16) : /^\d+$/.test(t) ? parseInt(t, 10) : null);
  for (const line of lines) {
    const m = /^([A-Za-z_]\w*):\s*(.*)$/.exec(line);
    let text = line;
    if (m) { labels[m[1]] = pc; text = m[2]; if (!text) continue; }
    const [mn, ...rest] = text.split(/\s+/);
    const arg = rest.join("");
    const name = mn.toUpperCase();
    if (name === ".BYTE") { const b = arg.split(",").map((x) => num(x)); parsed.push({ pc, bytes: b }); pc += b.length; continue; }
    let mode, val = null, label = null;
    if (!arg) mode = ops[name] && ops[name][MODES.IMP] !== undefined ? MODES.IMP : MODES.ACC;
    else if (arg === "A") mode = MODES.ACC;
    else if (arg[0] === "#") { mode = MODES.IMM; val = num(arg.slice(1)); }
    else if (/^\(\$[0-9A-Fa-f]{2}\),Y$/i.test(arg)) { mode = MODES.IZY; val = num(arg.slice(1, 4)); }
    else if (/^\(\$[0-9A-Fa-f]{2},X\)$/i.test(arg)) { mode = MODES.IZX; val = num(arg.slice(1, 4)); }
    else if (/^\(\$[0-9A-Fa-f]{4}\)$/i.test(arg)) { mode = MODES.IND; val = num(arg.slice(1, 6)); }
    else {
      const idx = /,([XY])$/i.exec(arg);
      const base = arg.replace(/,[XY]$/i, "");
      val = num(base);
      if (val === null) label = base;
      const zp = val !== null && val < 256 && base.length <= 3;
      if (["BPL", "BMI", "BVC", "BVS", "BCC", "BCS", "BNE", "BEQ"].includes(name)) mode = MODES.REL;
      else if (idx) mode = idx[1].toUpperCase() === "X" ? (zp ? MODES.ZPX : MODES.ABX) : (zp ? MODES.ZPY : MODES.ABY);
      else mode = zp && ops[name] && ops[name][MODES.ZP] !== undefined ? MODES.ZP : MODES.ABS;
    }
    if (!ops[name] || ops[name][mode] === undefined) throw new Error("bad instruction: " + line);
    const len = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 2, 2][mode];
    parsed.push({ pc, op: ops[name][mode], mode, val, label, len });
    pc += len;
  }
  const out = [];
  for (const q of parsed) {
    if (q.bytes) { out.push(...q.bytes); continue; }
    let v = q.val;
    if (q.label) { if (!(q.label in labels)) throw new Error("undefined label " + q.label); v = labels[q.label]; }
    out.push(q.op);
    if (q.mode === MODES.REL) { const d = v - (q.pc + 2); if (d < -128 || d > 127) throw new Error("branch out of range to " + q.label); out.push(d & 0xFF); }
    else if (q.len === 2) out.push(v & 0xFF);
    else if (q.len === 3) out.push(v & 0xFF, v >> 8);
  }
  return { bytes: Uint8Array.from(out), labels };
};
