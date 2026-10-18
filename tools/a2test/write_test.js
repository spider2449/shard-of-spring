// Writes a sector through the Disk II write sequence (as the DOS 3.3 RWTS does it), then checks that exactly that
// sector changed and that the image round-trips back to a normal .dsk.
const fs = require("fs");
global.A2 = {};
for (const f of ["cpu65", "disk", "machine"]) require("../../src/a2/" + f + ".js");
const assemble = require("./asm.js");
const fakeRom = require("./fakerom.js");

// Finds the address field of sector $3D, skips to the end of it, then writes the nibble stream at $0A00 (355 bytes).
const prog = assemble(`
start:  LDX #$60
        LDA $C089,X
        LDA $C08E,X
find:   LDA $C08C,X
        BPL find
f1b:    CMP #$D5
        BNE find
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
        LDY #$05
skip:   LDA $C08C,X
        BPL skip
        DEY
        BNE skip
        LDA $C08D,X
        LDA $C08E,X
        BMI prot
        LDA #$FF
        STA $C08F,X
        CMP $C08C,X
        LDY #$00
w1:     LDA $0A00,Y
        STA $C08D,X
        CMP $C08C,X
        NOP
        NOP
        NOP
        INY
        BNE w1
w2:     LDA $0B00,Y
        STA $C08D,X
        CMP $C08C,X
        NOP
        NOP
        NOP
        INY
        CPY #$63
        BNE w2
        LDA $C08E,X
        LDA $C08C,X
        CLC
        RTS
prot:   SEC
        RTS
`, 0x6000);

const disk = new A2.Disk("w.dsk", new Uint8Array(fs.readFileSync(process.argv[2])));
const before = new A2.Disk("w.dsk", new Uint8Array(fs.readFileSync(process.argv[2])));
const m = new A2.Apple2({ rom: fakeRom() });
m.disk.insert(0, disk);
m.mem.set(prog.bytes, 0x6000);

const track = 5, sec = 7;
const data = new Uint8Array(256).map((_, i) => (i * 7 + 3) & 0xFF);
// Build the stream: 5 x FF, then the data field exactly as the nibblizer lays it out, then a trailing FF.
const tmp = new Uint8Array(1000);
const sectors = new Array(16).fill(null).map(() => new Uint8Array(256));
sectors[sec] = data;
const trackBuf = A2.disk.nibblizeTrack(sectors, track, 254);
// locate the data prologue of the wanted sector inside the freshly built track
let idx = -1, seen = 0;
for (let i = 0; i < trackBuf.length - 3; i++) {
  if (trackBuf[i] === 0xD5 && trackBuf[i + 1] === 0xAA && trackBuf[i + 2] === 0xAD) { if (seen++ === sec) { idx = i; break; } }
}
const stream = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, ...trackBuf.subarray(idx, idx + 349), 0xFF];
if (stream.length !== 355) throw new Error("stream length " + stream.length);
m.mem.set(stream.slice(0, 256), 0xA00);
m.mem.set(stream.slice(256), 0xB00);

m.disk.drives[0].half = track * 2;
m.mem[0x3D] = sec;
m.cpu.pc = 0x6000; m.cpu.sp = 0xFD;
const stop = 0x6FF0;
m.mem.set([0x4C, 0xF0, 0x6F], stop);
m.mem[0x1FF] = (stop - 1) >> 8; m.mem[0x1FE] = (stop - 1) & 0xFF;
const start = m.cpu.cycles;
while (m.cpu.pc !== stop && m.cpu.cycles - start < 5e6) m.cpu.step();
let ok = m.cpu.pc === stop && !(m.cpu.p & 1);
console.log("program finished:", ok, "dirty:", disk.dirty);

let bad = 0;
for (let t = 0; t < 35; t++) {
  for (let s = 0; s < 16; s++) {
    const got = disk.readSector(t, s), was = before.readSector(t, s);
    const want = (t === track && s === sec) ? data : was;
    if (!got || Buffer.compare(Buffer.from(got), Buffer.from(want)) !== 0) { bad++; if (bad < 6) console.log("MISMATCH track", t, "sector", s, got ? "differs" : "unreadable"); }
  }
}
const out = disk.toBytes();
console.log("sector mismatches:", bad, "| exported as", out.format, out.bytes.length, "bytes");
process.exit(ok && bad === 0 && out.format === "do" ? 0 : 1);
