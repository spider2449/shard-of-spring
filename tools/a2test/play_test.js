// Scripted session on a real ROM: node tools/a2test/play_test.js system.rom out.png step...
// steps: wait:<sec>  key:<chars, \r = Return>  disk:<drive>:<file>  shot (writes out.png at the end)
const fs = require("fs");
global.A2 = {};
for (const f of ["cpu65", "disk", "machine", "video"]) require("../../src/a2/" + f + ".js");
const png = require("../png.js");
const [romFile, out, ...steps] = process.argv.slice(2);
const m = new A2.Apple2({ rom: new Uint8Array(fs.readFileSync(romFile)) });
const load = (f) => new A2.Disk(f, new Uint8Array(fs.readFileSync(f)));
for (const st of steps) {
  const [cmd, a, b] = st.split("|");
  if (cmd === "wait") m.run(1022727 * +a);
  else if (cmd === "key") for (const ch of a.replace(/\r/g, "\r")) { m.pressKey(ch.charCodeAt(0)); m.run(60000); }
  else if (cmd === "disk") m.disk.insert(+a, load(b));
  else if (cmd === "reset") m.reset();
}
const rows = [];
for (let r = 0; r < 24; r++) {
  const base = 0x400 + (r & 7) * 0x80 + (r >> 3) * 0x28;
  let line = "";
  for (let c = 0; c < 40; c++) { const v = m.mem[base + c] & 0x7F; line += String.fromCharCode(v < 0x20 ? v + 0x40 : v); }
  rows.push(line.trimEnd());
}
console.log(rows.join("\n"));
console.log("PC=$" + m.cpu.pc.toString(16), "text", m.text, "hires", m.hires, "mixed", m.mixed, "track", m.disk.track());
const buf = new Uint32Array(A2.SCREEN_W * A2.SCREEN_H);
new A2.Renderer().render(m, buf, false);
fs.writeFileSync(out, png(new Uint8Array(buf.buffer), A2.SCREEN_W, A2.SCREEN_H, 1));
