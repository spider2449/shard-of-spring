// Round-trips disk images through the nibblizer and back.
const fs = require("fs"), path = require("path");
global.A2 = {};
require("../../src/a2/disk.js");
let bad = 0;
for (const f of process.argv.slice(2)) {
  const data = new Uint8Array(fs.readFileSync(f));
  const d = new A2.Disk(path.basename(f), data);
  const { bytes, format } = d.toBytes();
  const same = format === d.format && bytes.length === data.length && Buffer.compare(Buffer.from(bytes), Buffer.from(data)) === 0;
  console.log(path.basename(f), "format", d.format, "roundtrip", same ? "OK" : "MISMATCH");
  if (!same) bad++;
}
process.exit(bad ? 1 : 0);
