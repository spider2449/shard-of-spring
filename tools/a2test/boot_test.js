// Boots a disk image on the stub ROM and prints the text page plus CPU state.
const fs = require("fs");
global.A2 = {};
for (const f of ["cpu65", "disk", "machine"]) require("../../src/a2/" + f + ".js");
const fakeRom = require("./fakerom.js");
const [file, secs = "3"] = process.argv.slice(2);
const m = new A2.Apple2({ rom: fakeRom() });
m.disk.insert(0, new A2.Disk(file, new Uint8Array(fs.readFileSync(file))));
m.run(1020000 * +secs);
const rows = [];
for (let r = 0; r < 24; r++) {
  const base = 0x400 + (r & 7) * 0x80 + (r >> 3) * 0x28;
  let s = "";
  for (let c = 0; c < 40; c++) { const v = m.mem[base + c] & 0x7F; s += String.fromCharCode(v < 0x20 ? v + 0x40 : v); }
  rows.push(s.trimEnd());
}
console.log(rows.join("\n"));
console.log("PC=$" + m.cpu.pc.toString(16), "cycles", m.cpu.cycles, "track", m.disk.track(), "motor", m.disk.motor);
