const { SS, load } = require("./harness.js");
const g = new SS.Game(load(), null); g.boot();
function settle() { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; }
let st = settle(); for (const k of [32, 76, 53]) { g.key(k); st = settle(); }
const c0 = g.m.cpu.cycles, t0 = Date.now();
for (let i = 0; i < 200; i++) { g.key(i % 7 === 0 ? 21 : 13); settle(); }
console.log("200 keys:", Date.now() - t0, "ms; cpu cycles", g.m.cpu.cycles - c0, "=> per key ms", (Date.now() - t0) / 200);
