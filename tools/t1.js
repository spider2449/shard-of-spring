const { SS, load, shot } = require("./harness.js");
const g = new SS.Game(load(), null);
g.m.onUnknownRom = (pc) => console.log("unknown ROM call $" + pc.toString(16));
g.boot();
for (let i = 0; i < 5; i++) { const s = g.pump(1); console.log(i, s, g.errorText || ""); if (s !== "running") break; }
shot(g, process.argv[2]);
