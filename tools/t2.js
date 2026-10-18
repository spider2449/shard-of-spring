// drive the game with scripted keys and screenshot after each step
const { SS, load, shot } = require("./harness.js");
const out = process.argv[2];
const g = new SS.Game(load(), null);
g.m.onUnknownRom = (pc) => console.log("unknown ROM call $" + pc.toString(16));
g.boot();
const script = process.argv.slice(3);
let n = 0;
function settle() { for (let i = 0; i < 200; i++) { const s = g.pump(1); if (s !== "running") return s; } return "running"; }
console.log("start", settle(), g.errorText || "");
shot(g, `${out}_${n++}.png`);
for (const k of script) {
  const code = k === "CR" ? 13 : k === "ESC" ? 27 : k === "LEFT" ? 8 : k === "RIGHT" ? 21 : k.charCodeAt(0);
  g.key(code);
  console.log("key", k, settle(), g.errorText || "", "disk", g.dos.cur + 1);
  shot(g, `${out}_${n++}.png`);
}
