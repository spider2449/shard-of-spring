// Builds dist/index.html: one self-contained page with the engine and both game disks embedded.
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p));
const files = ["cpu6502", "machine", "applesoft", "hires", "dos", "game", "main"];
let js = "var SS = {};\n";
js += "SS.DISKS = [\n  \"" + read("playable/shard_of_spring_disk1_original_protected.dsk").toString("base64") + "\",\n  \"" +
  read("playable/shard_of_spring_disk2.dsk").toString("base64") + "\"\n];\n";
for (const f of files) js += "\n" + read("src/" + f + ".js").toString("utf8");
const html = read("tools/template.html").toString("utf8").replace("__SCRIPT__", () => js);
fs.mkdirSync(path.join(root, "dist"), { recursive: true });
fs.writeFileSync(path.join(root, "dist/index.html"), html);
console.log("dist/index.html", Math.round(html.length / 1024) + " KB");
