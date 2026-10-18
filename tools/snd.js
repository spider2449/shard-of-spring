const { SS, load } = require("./harness.js");
const g = new SS.Game(load(), null); g.boot();
function settle() { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; }
settle(); for (const k of [32, 76, 53]) { g.key(k); settle(); }
const m = g.m; m.speaker.length = 0;
m.ram[0] = 98; m.ram[1] = 30; m.callML(3593, 0, 0, 0);
const sp = m.speaker; console.log("toggles", sp.length, "duration ms", (sp[sp.length - 1] - sp[0]) / 1020.484, "first intervals", sp.slice(1, 6).map((v, i) => v - sp[i]));
