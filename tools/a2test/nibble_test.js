// Reads sectors of a disk image with 6502 code that follows the classic boot-PROM algorithm (polling the
// Disk II latch, 6&2 decode via an EOR chain) and compares the result with the image. This exercises the
// cycle-timed nibble stream, the head position logic and the 6&2 encoding end to end.
const fs = require("fs");
global.A2 = {};
for (const f of ["cpu65", "disk", "machine"]) require("../../src/a2/" + f + ".js");
const assemble = require("./asm.js");
const fakeRom = require("./fakerom.js");

const prog = assemble(`
        ; in: $3D = wanted sector; head must already be on the track. out: $0800.. data, carry set on error
start:  LDX #$60
        LDA $C089,X        ; motor on
        LDA $C08E,X        ; read mode
        LDY #$00
        STY $26
        LDA #$08
        STA $27
find:   LDX #$60
f1:     LDA $C08C,X
        BPL f1
f1b:    CMP #$D5
        BNE f1
f2:     LDA $C08C,X
        BPL f2
        CMP #$AA
        BNE f1b
f3:     LDA $C08C,X
        BPL f3
        CMP #$96
        BNE f1b
        LDY #$03
a1:     STA $3C
a2:     LDA $C08C,X
        BPL a2
        ROL A
        STA $3C
a3:     LDA $C08C,X
        BPL a3
        AND $3C
        DEY
        BNE a1
        CMP $3D
        BNE find
a4:     LDA $C08C,X
        BPL a4
a5:     LDA $C08C,X
        BPL a5
d1:     LDA $C08C,X
        BPL d1
d1b:    CMP #$D5
        BNE d1
d2:     LDA $C08C,X
        BPL d2
        CMP #$AA
        BNE d1b
d3:     LDA $C08C,X
        BPL d3
        CMP #$AD
        BNE d1b
        LDY #$56
        LDA #$00
r1:     STY $3C
r1b:    LDY $C08C,X
        BPL r1b
        EOR $0900,Y
        LDY $3C
        DEY
        STA $0300,Y
        BNE r1
r2:     STY $3C
r2b:    LDY $C08C,X
        BPL r2b
        EOR $0900,Y
        LDY $3C
        STA ($26),Y
        INY
        BNE r2
r3:     LDY $C08C,X
        BPL r3
        EOR $0900,Y
        CMP #$00
        BNE bad
        LDY #$00
dloop:  LDX #$56
d4:     DEX
        BMI dloop
        LDA ($26),Y
        LSR $0300,X
        ROL A
        LSR $0300,X
        ROL A
        STA ($26),Y
        INY
        BNE d4
        CLC
        RTS
bad:    SEC
        RTS
`, 0x6000);

const XLATE = [0x96, 0x97, 0x9A, 0x9B, 0x9D, 0x9E, 0x9F, 0xA6, 0xA7, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7,
  0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xCB, 0xCD, 0xCE, 0xCF, 0xD3, 0xD6, 0xD7, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xE5,
  0xE6, 0xE7, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE, 0xEF, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF];

function run(file) {
  const img = new Uint8Array(fs.readFileSync(file));
  const disk = new A2.Disk(file, img);
  const m = new A2.Apple2({ rom: fakeRom() });
  m.disk.insert(0, disk);
  m.mem.set(prog.bytes, 0x6000);
  XLATE.forEach((v, i) => { m.mem[0x900 + v] = i; });
  const stop = 0x6FF0;
  m.mem.set([0x4C, 0xF0, 0x6F], stop); // JMP *
  let bad = 0, count = 0, maxCycles = 0;
  for (const track of [0, 1, 17, 34]) {
    m.disk.drives[0].half = track * 2;
    for (let sec = 0; sec < 16; sec++) {
      m.mem[0x3D] = sec;
      m.cpu.pc = 0x6000; m.cpu.sp = 0xFD;
      m.mem[0x1FF] = (stop - 1) >> 8; m.mem[0x1FE] = (stop - 1) & 0xFF;
      const start = m.cpu.cycles;
      while (m.cpu.pc !== stop && m.cpu.cycles - start < 3e6) m.cpu.step();
      maxCycles = Math.max(maxCycles, m.cpu.cycles - start);
      const ok = m.cpu.pc === stop && !(m.cpu.p & 1);
      const want = disk.readSector(track, sec);
      const got = m.mem.subarray(0x800, 0x900);
      const same = ok && want && Buffer.compare(Buffer.from(got), Buffer.from(want)) === 0;
      count++;
      if (!same) { bad++; console.log("FAIL track", track, "sector", sec, "ok", ok, "pc", m.cpu.pc.toString(16)); }
    }
  }
  console.log(file, count - bad, "/", count, "sectors read through the controller model (slowest read " + maxCycles + " cycles)");
  return bad;
}
let bad = 0;
for (const f of process.argv.slice(2)) bad += run(f);
process.exit(bad ? 1 : 0);
