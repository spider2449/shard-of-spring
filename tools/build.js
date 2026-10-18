// Builds a self-contained Apple II emulator page for any game: dist/<game_name>.html
//
//   node tools/build.js <game.zip | disk.dsk | folder> [more disks...] [--rom system.rom] [--disk-rom p5a.rom]
//                       [--name "Game Name"] [--out dist]
//   node tools/build.js [--rom system.rom]        -> dist/apple2.html, a generic emulator that loads disks in the page
//
// The game images (.dsk .do .po .nib .2mg, optionally inside .zip files) are embedded in the page. The Apple II
// system ROM (12 KB II/II+ or 16 KB IIe/enhanced IIe) is embedded when --rom (or $APPLE2_ROM) is given; otherwise
// the page asks for it on first load and remembers it in the browser.
const fs = require("fs"), path = require("path");
const { readZip } = require("./lib/zip.js");

const root = path.join(__dirname, "..");
const DISK_EXT = /\.(dsk|do|po|nib|2mg)$/i;

function usage(msg) {
  if (msg) console.error("error: " + msg + "\n");
  console.error("usage: node tools/build.js [game.zip|disk.dsk|folder] [more...] [--rom system.rom] [--disk-rom p5a.rom] [--name \"Game Name\"] [--out dir]");
  process.exit(msg ? 1 : 0);
}

function parseArgs(argv) {
  const o = { inputs: [], out: path.join(root, "dist") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) usage(a + " needs a value"); return argv[++i]; };
    if (a === "--rom") o.rom = val();
    else if (a === "--disk-rom") o.diskRom = val();
    else if (a === "--name") o.name = val();
    else if (a === "--out") o.out = path.resolve(val());
    else if (a === "-h" || a === "--help") usage();
    else if (a.startsWith("--")) usage("unknown option " + a);
    else o.inputs.push(a);
  }
  if (!o.rom && process.env.APPLE2_ROM) o.rom = process.env.APPLE2_ROM;
  return o;
}

function collectDisks(inputs) {
  const disks = [];
  const addFile = (name, data) => { if (DISK_EXT.test(name)) disks.push({ name: path.basename(name), data }); };
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) { for (const f of fs.readdirSync(p).sort()) walk(path.join(p, f)); return; }
    if (/\.zip$/i.test(p)) {
      for (const e of readZip(fs.readFileSync(p))) if (!/(^|\/)(__MACOSX|\.)/.test(e.name)) addFile(e.name, e.data());
    } else addFile(p, fs.readFileSync(p));
  };
  for (const p of inputs) { if (!fs.existsSync(p)) usage("no such file: " + p); walk(p); }
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  disks.sort((a, b) => collator.compare(a.name, b.name));
  return disks;
}

// "Shard of Spring, The (1986)(SSI)(Disk 1 of 2).dsk" -> "The Shard of Spring"
function gameName(first) {
  let n = path.basename(first).replace(/\.(zip|dsk|do|po|nib|2mg)$/i, "");
  n = n.replace(/\s*[(\[].*$/, "").replace(/[_]+/g, " ").trim();
  n = n.replace(/\s*[-,]?\s*(side|disk|disc)\s*[a-z0-9]+(\s+of\s+\d+)?$/i, "").trim();
  const m = /^(.*),\s*(The|A|An)$/i.exec(n);
  if (m) n = m[2] + " " + m[1];
  return n || "Apple II Game";
}

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "game";

function main() {
  const o = parseArgs(process.argv.slice(2));
  global.A2 = {};
  for (const f of ["cpu65", "disk", "machine"]) require(path.join(root, "src/a2", f + ".js"));
  const A2 = global.A2;

  const disks = collectDisks(o.inputs);
  if (o.inputs.length && !disks.length) usage("no disk images (.dsk .do .po .nib .2mg) found in the input");
  for (const d of disks) {
    try { new A2.Disk(d.name, new Uint8Array(d.data)); } catch (e) { usage(e.message); }
  }

  let rom = null, diskRom = null;
  if (o.rom) {
    rom = fs.readFileSync(o.rom);
    try { A2.identifyRom(new Uint8Array(rom)); } catch (e) { usage(e.message); }
  }
  if (o.diskRom) {
    diskRom = fs.readFileSync(o.diskRom);
    if (diskRom.length !== 256) usage("--disk-rom must be the 256 byte Disk II boot ROM");
  }

  const title = o.name || (o.inputs.length ? gameName(o.inputs[0]) : "Apple II Emulator");
  const cfg = {
    id: slug(title).toLowerCase(),
    title,
    rom: rom ? rom.toString("base64") : null,
    diskRom: diskRom ? diskRom.toString("base64") : null,
    disks: disks.map((d) => ({ name: d.name, data: d.data.toString("base64") })),
  };
  let js = "var A2 = {};\nvar A2CFG = " + JSON.stringify(cfg) + ";\n";
  for (const f of ["cpu65", "disk", "machine", "video", "ui"]) js += "\n" + fs.readFileSync(path.join(root, "src/a2", f + ".js"), "utf8");
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = fs.readFileSync(path.join(root, "tools/template_a2.html"), "utf8")
    .replace("__TITLE__", () => esc(title))
    .replace("__SCRIPT__", () => js.replace(/<\/script/gi, "<\/script"));
  fs.mkdirSync(o.out, { recursive: true });
  const file = path.join(o.out, (o.inputs.length ? slug(title) : "apple2") + ".html");
  fs.writeFileSync(file, html);
  console.log(path.relative(process.cwd(), file) || file, Math.round(html.length / 1024) + " KB");
  console.log("  game:  " + title);
  console.log("  disks: " + (disks.length ? disks.map((d) => d.name).join(", ") : "none embedded - load them in the page"));
  console.log("  ROM:   " + (rom ? o.rom + " (" + rom.length + " bytes, embedded)" : "not embedded - the page will ask for it"));
}

main();
