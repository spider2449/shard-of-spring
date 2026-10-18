const { SS, load, shot } = require("./harness.js");
const store = {}; const storage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
function run(keys, label) {
  const g = new SS.Game(load(), storage); g.boot();
  const settle = () => { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; };
  let st = settle();
  for (const k of keys) { g.key(k); st = settle(); }
  console.log(label, st, g.errorText || "", "XX", g.interp.vars.get("XX"), "YY", g.interp.vars.get("YY"), "mem3347", g.m.ram[3347], g.m.ram[3348], "gold", g.m.ram[3338] + g.m.ram[3339] * 256);
  return g;
}
const A = (s) => [...s].map((c) => c.charCodeAt(0));
let g = run([32, 76, 53, 13, 13, 13, 21, 13, 13, 83], "run1");
shot(g, process.argv[2]);
console.log("overlay keys:", Object.keys(JSON.parse(store["shardOfSpring.overlay"] || "[{},{}]")[1]));
g = run([32, 76, 53], "run2");
