const { SS, load } = require("./harness.js");
const g = new SS.Game(load(), null); g.boot();
function settle(n = 2000) { for (let i = 0; i < n; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; }
let st = settle(); for (const k of [32, 67]) { g.key(k); st = settle(); }
const m = g.m, c = m.cpu;
// run the ML at 37632 directly with tracing of the first 400 instructions
m.ram[0x20] = 2; m.vtab(2); m.ram[0x24] = 0;
let steps = 0; const log = [];
const origStep = c.step.bind(c);
c.step = function () { steps++; if (steps < 4000000) { const pc = c.pc; if (pc >= 0x9732 && pc < 0x97c4 || pc === 0xBF93 || pc >= 0xFE00 || pc === 0x300 || pc === 0x303) log.push(pc.toString(16)); } return origStep(); };
m.startML(0x9300, 0, 0, 0);
let fin = m.runML(3000000);
console.log("finished", fin, "steps", steps, "KSW", m.ram[0x38].toString(16), m.ram[0x39].toString(16), "CSW", m.ram[0x36].toString(16), m.ram[0x37].toString(16));
console.log(log.slice(0, 60).join(" "), "...", log.slice(-30).join(" "));
