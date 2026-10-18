const { SS, load, shot } = require("./harness.js");
const g = new SS.Game(load(), null); g.realTime = true; g.boot();
function settle() { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; }
let st = settle();
for (const k of [32, 76, 49]) { g.key(k); st = settle(); console.log("key", k, st, g.delayMs); }
shot(g, process.argv[2]);
