const H = require("./harness.js"); const SS2 = H.SS;
const g = new SS2.Game(H.load(), null); g.boot(); for (let i = 0; i < 200; i++) { if (g.pump(1) !== "running") break; }
const rowAddr = (y) => 0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
const y = 120, a = rowAddr(y);
console.log(Array.from(g.m.ram.subarray(a + 6, a + 30)).map(v => v.toString(16)).join(" "));
const out = new Uint8Array(560 * 192 * 4); SS2.renderScreen(g.m, out, null, false);
for (let b = 8; b < 14; b++) { const j = b * 14 + 4; console.log("byte", b, g.m.ram[a + b].toString(16), [0, 1, 2, 3].map(d => { const o = (y * 560 + j + d) * 4; return out[o] + "," + out[o + 1] + "," + out[o + 2]; }).join(" | ")); }
