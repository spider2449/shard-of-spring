// Boots a disk on a real system ROM: node tools/a2test/realrom_test.js system.rom disk.dsk [seconds] [disk2.rom]
// Prints the text screen after the given emulated time (default 20 s) and writes a PNG when a 4th argument... see shot below.
const fs = require("fs"), path = require("path");
global.A2 = {};
for (const f of ["cpu65", "disk", "machine", "video"]) require("../../src/a2/" + f + ".js");
const png = require("../png.js");
const [romFile, diskFile, secs = "20", diskRom, out] = process.argv.slice(2);
const m = new A2.Apple2({ rom: new Uint8Array(fs.readFileSync(romFile)), diskRom: diskRom && diskRom !== "-" ? new Uint8Array(fs.readFileSync(diskRom)) : null });
m.disk.insert(0, new A2.Disk(diskFile, new Uint8Array(fs.readFileSync(diskFile))));
console.log("model", m.model, "hle disk rom", m.hleDisk);
const keys = (process.env.KEYS || "").split(",").filter(Boolean);
let t = 0;
for (let s = 0; s < +secs; s++) {
  m.run(1022727);
  if (keys[s]) for (const ch of keys[s].replace(/\r/g, "\r")) m.pressKey(ch.charCodeAt(0));
}
const A = A2.MEM.AUX;
const rows = [];
for (let r = 0; r < 24; r++) {
  const base = 0x400 + (r & 7) * 0x80 + (r >> 3) * 0x28;
  let line = "";
  for (let c = 0; c < 40; c++) { const v = m.mem[base + c] & 0x7F; line += String.fromCharCode(v < 0x20 ? v + 0x40 : v); }
  rows.push(line.trimEnd());
}
console.log(rows.join("\n"));
console.log("PC=$" + m.cpu.pc.toString(16), "text", m.text, "hires", m.hires, "mixed", m.mixed, "track", m.disk.track());
if (out) {
  const buf = new Uint32Array(A2.SCREEN_W * A2.SCREEN_H);
  new A2.Renderer().render(m, buf, false);
  fs.writeFileSync(out, png(new Uint8Array(buf.buffer), A2.SCREEN_W, A2.SCREEN_H, 1));
}
