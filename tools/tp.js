// teleport test: node tools/tp.js out.png map x y dir "keys..."   (dir 1=N 2=E 3=S 4=W)
const { SS, load, shot } = require("./harness.js");
const [out, map, x, y, dir, keys] = process.argv.slice(2);
const g = new SS.Game(load(), null);
const unk = new Set(); g.m.onUnknownRom = (pc) => unk.add("$" + pc.toString(16));
g.interp.trace = []; g.boot();
function settle() { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "running-long"; }
let st = settle();
for (const k of [32, 76, 53]) { g.key(k); st = settle(); }
const r = g.m.ram;
r[3347] = +x; r[3348] = +y; r[3349] = +map; r[3350] = (+dir) - 1; r[3367] = 0;
g.interp.stack.length = 0; g.interp.jump(20); g.interp.si = 0;
st = settle();
const codes = { CR: 13, ESC: 27, LEFT: 8, RIGHT: 21, UP: 11, DOWN: 10, SPACE: 32 };
for (const t of (keys || "").split(/\s+/).filter(Boolean)) {
  const m = /^(\d+)\*(.+)$/.exec(t); const k = m ? m[2] : t; const c = m ? +m[1] : 1;
  for (let i = 0; i < c; i++) { if (st !== "waiting") break; g.key(codes[k] !== undefined ? codes[k] : k.charCodeAt(0)); st = settle(); }
}
console.log("XX", g.interp.vars.get("XX"), "YY", g.interp.vars.get("YY"), "map", r[3349], "line", g.interp.prog.lines[g.interp.li] && g.interp.prog.lines[g.interp.li].num);
console.log("status", st, g.errorText || "", "errors", (g.interp.errors || []).join(" | "), "unk", [...unk].join(","));
shot(g, out);
