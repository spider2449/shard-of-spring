// random-walk smoke test: node tools/walk.js steps seed
const { SS, load, shot } = require("./harness.js");
const steps = +process.argv[2] || 300; let seed = +process.argv[3] || 1;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const g = new SS.Game(load(), null);
const unk = new Set(); g.m.onUnknownRom = (pc) => unk.add("$" + pc.toString(16));
const runs = [];
const origCmd = g.dos.command.bind(g.dos);
g.dos.command = (it, s) => { if (s.cmd === "RUN") runs.push(it.ev(s.f)); return origCmd(it, s); };
g.interp.trace = [];
g.boot();
function settle() { for (let i = 0; i < 500; i++) { const s = g.pump(1); if (s !== "running") return s; } return "running"; }
let st = settle();
for (const k of [32, 76, 53]) { g.key(k); st = settle(); }
for (let i = 0; i < steps && st === "waiting"; i++) {
  const t = rnd(); const k = t < 0.7 ? 13 : t < 0.85 ? 8 : 21;
  g.key(k); st = settle();
  const vars = g.interp.vars;
  if (i % 50 === 0) console.log(i, "XX", vars.get("XX"), "YY", vars.get("YY"), "prog", g.interp.prog.lines[0].num, runs.join(","));
}
if (g.interp.lastTrace) console.log("TRACE", g.interp.lastTrace.join(" "));
console.log("errors", (g.interp.errors||[]).join(" | "));
console.log("status", st, g.errorText || "", "runs", runs.join(","), "unk", [...unk].join(","));
shot(g, process.argv[4] || "walk.png");
