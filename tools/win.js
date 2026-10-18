const { SS, load, shot } = require("./harness.js");
const g = new SS.Game(load(), null); g.interp.trace = []; g.boot();
function settle() { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; }
let st = settle(); for (const k of [32, 76, 53]) { g.key(k); st = settle(); }
g.interp.stack.length = 0; g.interp.jump(5600); g.key(32); st = settle();
shot(g, process.argv[2] + "_0.png");
for (let i = 0; i < 12 && st === "waiting"; i++) { g.key(32); st = settle(); }
shot(g, process.argv[2] + "_1.png");
console.log(st, g.errorText || "", (g.interp.errors || []).join("|"));
console.log(g.interp.trace.filter((t) => /^(56|14)\d\d/.test(t)).slice(0, 60).join(" "));
