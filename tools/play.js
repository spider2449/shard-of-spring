// usage: node tools/play.js out.png "key key key ..." [shotEvery]
// keys: CR ESC LEFT RIGHT UP DOWN SPACE or single chars; prefix "n*" repeats e.g. 10*CR
const { SS, load, shot } = require("./harness.js");
const out = process.argv[2], seq = process.argv[3].split(/\s+/).filter(Boolean);
const every = +process.argv[4] || 0;
const g = new SS.Game(load(), null);
const unk = new Set();
g.m.onUnknownRom = (pc) => unk.add("$" + pc.toString(16));
g.boot();
function settle() { for (let i = 0; i < 500; i++) { const s = g.pump(1); if (s !== "running") return s; } return "running"; }
let st = settle(), n = 0;
const codes = { CR: 13, ESC: 27, LEFT: 8, RIGHT: 21, UP: 11, DOWN: 10, SPACE: 32 };
const keys = [];
for (const t of seq) { const m = /^(\d+)\*(.+)$/.exec(t); const k = m ? m[2] : t; const c = m ? +m[1] : 1; for (let i = 0; i < c; i++) keys.push(k); }
for (const k of keys) {
  if (st !== "waiting") break;
  g.key(codes[k] !== undefined ? codes[k] : k.charCodeAt(0));
  st = settle(); n++;
  if (every && n % every === 0) shot(g, out.replace(".png", `_${n}.png`));
}
console.log("status", st, g.errorText || "", "keys", n, "disk", g.dos.cur + 1, "unknownROM", [...unk].join(","));
shot(g, out);
const r = g.m.ram;
console.log("pos", r[3347], r[3348], "dir", r[3350], "map", r[3349], "time", r[3343], r[3344], r[3345], r[3346], "prog line", g.interp.prog && g.interp.prog.lines[g.interp.li] && g.interp.prog.lines[g.interp.li].num);
