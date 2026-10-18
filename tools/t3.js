const { SS, load, shot } = require("./harness.js");
const g = new SS.Game(load(), null); g.interp.trace = [];
const cmds = []; const oc = g.dos.command.bind(g.dos);
g.dos.command = (it, s) => { try { cmds.push(s.cmd + " " + (s.f ? it.ev(s.f) : "")); } catch (e) {} return oc(it, s); };
g.boot();
function settle() { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; }
let st = settle();
const keys = process.argv.slice(3);
for (const k of keys) { const code = k === "CR" ? 13 : k === "ESC" ? 27 : k === "SPACE" ? 32 : k.charCodeAt(0); cmds.length = 0; g.key(code); st = settle(); console.log("key", k, st, "disk", g.dos.cur + 1, "cmds:", cmds.join("; "), "trace:", g.interp.trace.slice(-6).join(" ")); }
shot(g, process.argv[2]);
console.log("A$ =", JSON.stringify(g.interp.vars.get("A$")), "KSW", g.m.ram[0x38].toString(16), g.m.ram[0x39].toString(16), "CSW", g.m.ram[0x36].toString(16), g.m.ram[0x37].toString(16));
const S = g.interp.arrays.get("S$"); if (S) console.log("S$ dims", S.dims, JSON.stringify(S.data.slice(0, 40)));
const SL = g.interp.arrays.get("SL%"); if (SL) console.log("SLC%", SL.dims, JSON.stringify(SL.data.slice(0, 20)));
