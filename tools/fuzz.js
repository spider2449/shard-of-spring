// fuzz: node tools/fuzz.js steps seed [shotPrefix]; random keys, reports interpreter errors
const { SS, load, shot } = require("./harness.js");
const steps = +process.argv[2] || 2000; let seed = +process.argv[3] || 1;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const g = new SS.Game(load(), null);
const unk = new Set(); g.m.onUnknownRom = (pc) => unk.add("$" + pc.toString(16));
const progs = []; const oc = g.dos.command.bind(g.dos);
g.dos.command = (it, s) => { if (s.cmd === "RUN") progs.push(it.ev(s.f)); return oc(it, s); };
g.interp.trace = [];
g.boot();
function settle() { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "running-long"; }
let st = settle();
for (const k of [32, 76, 53]) { g.key(k); st = settle(); }
if (process.env.TP) { const [map, x, y, dir] = process.env.TP.split(",").map(Number); const r = g.m.ram;
  r[3347] = x; r[3348] = y; r[3349] = map; r[3350] = dir - 1; r[3367] = 0; g.interp.stack.length = 0; g.interp.jump(20); st = settle(); }
const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", digits = "123456789";
let errCount = 0;
for (let i = 0; i < steps; i++) {
  if (st !== "waiting") { console.log("STOP at", i, st, g.errorText); break; }
  const t = rnd(); let k;
  if (t < 0.38) k = 13; else if (t < 0.5) k = 8; else if (t < 0.6) k = 21; else if (t < 0.7) k = digits.charCodeAt((rnd() * 9) | 0);
  else if (t < 0.8) k = letters.charCodeAt((rnd() * 26) | 0); else if (t < 0.9) k = 27; else if (t < 0.95) k = 32; else k = [11, 10, 47, 73, 74, 75, 77][(rnd() * 7) | 0];
  g.key(k); st = settle();
  const e = g.interp.errors || [];
  if (e.length > errCount) { for (let q = errCount; q < e.length; q++) console.log("ERR", e[q], "| trace:", (g.interp.lastTrace || []).slice(-12).join(" ")); errCount = e.length; }
}
console.log("status", st, g.errorText || "", "progs", [...new Set(progs)].join(","), "unk", [...unk].join(","), "errs", errCount);
if (process.argv[4]) shot(g, process.argv[4]);
