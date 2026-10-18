// Renders a few synthetic screens (text, lo-res, hi-res) to PNG files for eyeballing.
const fs = require("fs"), path = require("path");
global.A2 = {};
for (const f of ["cpu65", "disk", "machine", "video"]) require("../../src/a2/" + f + ".js");
const png = require("../png.js");
const fakeRom = require("./fakerom.js");
const out = process.argv[2] || ".";
const m = new A2.Apple2({ rom: fakeRom() });
const r = new A2.Renderer();
function shot(name, flash) {
  const buf = new Uint32Array(A2.SCREEN_W * A2.SCREEN_H);
  r.render(m, buf, flash);
  const rgba = new Uint8Array(buf.buffer);
  fs.writeFileSync(path.join(out, name + ".png"), png(rgba, A2.SCREEN_W, A2.SCREEN_H, 1));
}
// text: rows of every code
for (let i = 0; i < 960; i++) {
  const r2 = (i / 40) | 0, c = i % 40;
  m.mem[0x400 + (r2 & 7) * 0x80 + (r2 >> 3) * 0x28 + c] = (i * 1) & 0xFF;
}
shot("text", false);
// lo-res
m.text = false; m.mixed = true;
for (let i = 0; i < 960; i++) { const r2 = (i / 40) | 0, c = i % 40; m.mem[0x400 + (r2 & 7) * 0x80 + (r2 >> 3) * 0x28 + c] = ((c & 15) << 4) | (r2 & 15); }
shot("lores", false);
// hi-res: coloured bars and a diagonal line
m.hires = true; m.mixed = false;
for (let y = 0; y < 192; y++) {
  const a = 0x2000 + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
  for (let b = 0; b < 40; b++) m.mem[a + b] = [0x2A, 0x55, 0xAA, 0xD5, 0x7F, 0xFF, 0x00, 0x03][(b >> 2) & 7];
}
shot("hires", false);
