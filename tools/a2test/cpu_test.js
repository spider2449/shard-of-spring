// Runs Klaus Dormann's 6502 / 65C02 functional tests against src/a2/cpu65.js.
// Usage: node tools/a2test/cpu_test.js <test.bin> <nmos|cmos> <success_pc_hex>
const fs = require("fs");
global.A2 = {};
require("../../src/a2/cpu65.js");
const [file, kind, okpc] = process.argv.slice(2);
const mem = new Uint8Array(fs.readFileSync(file));
const m = { read: (a) => mem[a], write: (a, v) => { mem[a] = v; } };
const cpu = new A2.CPU(m, kind === "cmos");
cpu.pc = 0x400;
let last = -1, n = 0;
for (;;) {
  const pc = cpu.pc;
  cpu.step();
  n++;
  if (cpu.pc === pc) {
    console.log("trap at $" + pc.toString(16), "after", n, "instructions", pc === parseInt(okpc, 16) ? "SUCCESS" : "FAILURE");
    process.exit(pc === parseInt(okpc, 16) ? 0 : 1);
  }
  if (n > 200e6) { console.log("timeout at $" + cpu.pc.toString(16)); process.exit(2); }
}
