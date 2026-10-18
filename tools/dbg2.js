const { SS, load } = require("./harness.js");
const g = new SS.Game(load(), null); g.interp.trace = [];
g.boot();
function settle(n = 2000) { for (let i = 0; i < n; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; }
let st = settle(); for (const k of [32, 67]) { g.key(k); st = settle(); }
// now at char utilities; press L
g.key(76);
const m = g.m, c = m.cpu;
let steps = 0, last = [];
const origStep = c.step.bind(c);
c.step = function () { steps++; last.push(c.pc.toString(16)); if (last.length > 40) last.shift(); return origStep(); };
st = settle(300);
console.log("status", st, "steps", steps, "last pcs", last.join(" "), "KSW", m.ram[0x38].toString(16), m.ram[0x39].toString(16));
console.log("interp line", g.interp.prog.lines[g.interp.li].num, "trace tail", g.interp.trace.slice(-8).join(" "));
