// Node test harness: boots the game headless and writes screenshots.
const fs = require("fs"), path = require("path");
global.SS = {};
for (const f of ["cpu6502", "machine", "applesoft", "hires", "dos", "game"]) require("../src/" + f + ".js");
const SS = global.SS;
const root = path.join(__dirname, "..");
function load() {
  const d1 = new Uint8Array(fs.readFileSync(path.join(root, "playable/shard_of_spring_disk1_original_protected.dsk")));
  const d2 = new Uint8Array(fs.readFileSync(path.join(root, "playable/shard_of_spring_disk2.dsk")));
  return [d1, d2];
}
const png = require("./png.js");
// font: ASCII.SET from disk 1
function fontFrom(g) { const f = g.dos.find("ASCII.SET"); g.dos.cur = 0; return f ? f.data : null; }
function shot(g, file) {
  const rgba = new Uint8Array(SS.SCREEN_W * SS.SCREEN_H * 4);
  SS.renderScreen(g.m, rgba, fontFrom(g), false);
  fs.writeFileSync(file, png(rgba, SS.SCREEN_W, SS.SCREEN_H, 1));
}
module.exports = { SS, load, shot };
