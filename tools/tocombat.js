// walk until a combat starts, then run provided keys: node tools/tocombat.js out.png seed "keys"
const { SS, load, shot } = require("./harness.js");
let seed = +process.argv[3] || 1; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const g = new SS.Game(load(), null); g.interp.trace = [];
let combat = false; const oc = g.dos.command.bind(g.dos);
g.dos.command = (it, s) => { if (s.cmd === "RUN" && it.ev(s.f) === "COMBAT2") combat = true; return oc(it, s); };
g.boot();
function settle() { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; }
let st = settle(); for (const k of [32, 76, 53]) { g.key(k); st = settle(); }
for (let i = 0; i < 3000 && !combat; i++) { g.key(rnd() < 0.8 ? 13 : (rnd() < 0.5 ? 8 : 21)); st = settle(); }
console.log("combat started:", combat);
for (let i = 0; i < 20; i++) { st = settle(); }
shot(g, process.argv[2].replace(".png", "_0.png"));
const codes = { CR: 13, ESC: 27, LEFT: 8, RIGHT: 21, UP: 11, DOWN: 10, SPACE: 32 };
let n = 1;
for (const t of (process.argv[4] || "").split(/\s+/).filter(Boolean)) {
  const m = /^(\d+)\*(.+)$/.exec(t); const k = m ? m[2] : t; const c = m ? +m[1] : 1;
  for (let i = 0; i < c; i++) { if (st !== "waiting") break; g.key(codes[k] !== undefined ? codes[k] : k.charCodeAt(0)); st = settle(); }
  shot(g, process.argv[2].replace(".png", `_${n++}.png`));
}
console.log("status", st, g.errorText || "", "errors", (g.interp.errors || []).join(" | "));
