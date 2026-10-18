// Checks the memory map and soft switches: language card banking, IIe auxiliary memory, 80STORE, model detection.
global.A2 = {};
for (const f of ["cpu65", "disk", "machine"]) require("../../src/a2/" + f + ".js");
const fakeRom = require("./fakerom.js");

let failures = 0;
const eq = (name, got, want) => { if (got !== want) { failures++; console.log("FAIL", name, "got", got, "want", want); } };

// ---- Apple ][+ with language card
{
  const rom = fakeRom(); rom[0] = 0xAB; // $D000 marker
  const m = new A2.Apple2({ rom });
  eq("model", m.model, "plus");
  eq("rom visible", m.read(0xD000), 0xAB);
  m.write(0xD000, 0x11); eq("rom write ignored", m.read(0xD000), 0xAB);
  m.read(0xC083); m.read(0xC083);            // bank 2 RAM, read+write
  m.write(0xD000, 0x22); m.write(0xE000, 0x33);
  eq("lc bank2 rw", m.read(0xD000), 0x22); eq("lc E000", m.read(0xE000), 0x33);
  m.read(0xC08B); m.read(0xC08B);            // bank 1 RAM
  eq("bank1 empty", m.read(0xD000), 0x00);
  m.write(0xD000, 0x44); eq("bank1 rw", m.read(0xD000), 0x44);
  m.read(0xC083); eq("back to bank2", m.read(0xD000), 0x22);
  m.read(0xC082);                             // ROM read, write protect
  eq("rom again", m.read(0xD000), 0xAB);
  m.read(0xC080);                             // RAM read, write protected
  eq("ram read ro", m.read(0xD000), 0x22);
  m.write(0xD000, 0x99); eq("write protected", m.read(0xD000), 0x22);
  // a single access to an odd register must not enable writes
  m.read(0xC081); m.read(0xC080); m.write(0xD000, 0x55); m.read(0xC080);
  eq("single odd access", m.read(0xD000), 0x22);
  // boot ROM signature
  eq("slot6 sig", [m.read(0xC601), m.read(0xC603), m.read(0xC605), m.read(0xC607)].join(), "32,0,3,60");
}

// ---- enhanced IIe
{
  const rom = new Uint8Array(16384).fill(0x60);
  rom[0x3BC0] = 0xE0; // $FBC0 = enhanced IIe marker
  rom[0x3FFC] = 0x00; rom[0x3FFD] = 0xC3;
  rom[0x0100] = 0xC5; // $C100 internal ROM
  rom[0x0300] = 0xC3; // $C300 internal 80-column firmware
  const m = new A2.Apple2({ rom });
  eq("model", m.model, "enhanced");
  eq("cmos", m.cpu.cmos, true);
  eq("slot rom visible", m.read(0xC100), 0x00);
  m.write(0xC007, 0); eq("INTCXROM", m.read(0xC100), 0xC5);
  m.write(0xC006, 0); eq("slot rom again", m.read(0xC100), 0x00);
  eq("c3 internal by default", m.read(0xC300), 0xC3);
  m.write(0xC00B, 0); eq("SLOTC3ROM", m.read(0xC300), 0x00);
  m.write(0xC005, 0); m.write(0x0300, 0x77); m.write(0xC004, 0);
  eq("RAMWRT goes to aux", m.read(0x0300), 0x00);
  m.write(0xC003, 0); eq("RAMRD reads aux", m.read(0x0300), 0x77); m.write(0xC002, 0);
  m.write(0xC009, 0); m.write(0x0010, 0x66); eq("ALTZP", m.read(0x0010), 0x66); m.write(0xC008, 0); eq("main zp untouched", m.read(0x0010), 0x00);
  // 80STORE + PAGE2 steers text page writes to aux without RAMWRT
  m.write(0xC001, 0); m.read(0xC055); m.write(0x0400, 0x5A); m.read(0xC054);
  eq("80STORE page2 -> aux", m.mem[A2.MEM.AUX + 0x400], 0x5A); eq("main page1 clean", m.read(0x0400), 0x00);
  m.write(0xC000, 0);
  // status reads
  eq("RDTEXT", m.read(0xC01A) & 0x80, 0x80);
  m.read(0xC050); eq("graphics", m.read(0xC01A) & 0x80, 0);
  m.read(0xC057); eq("HIRES", m.read(0xC01D) & 0x80, 0x80);
  // language card on the IIe
  m.read(0xC083); m.read(0xC083); m.write(0xD000, 0x31);
  eq("IIe LC", m.read(0xD000), 0x31); eq("LCRAM status", m.read(0xC012) & 0x80, 0x80); eq("bank2 status", m.read(0xC011) & 0x80, 0x80);
}

// ---- keyboard
{
  const m = new A2.Apple2({ rom: fakeRom() });
  m.pressKey(0x41); m.pressKey(0x42);
  eq("key1", m.read(0xC000), 0xC1);
  m.read(0xC010); eq("key2 after strobe", m.read(0xC000), 0xC2);
  m.read(0xC010); eq("no key", m.read(0xC000) & 0x80, 0);
}

console.log(failures ? failures + " failure(s)" : "memory map OK");
process.exit(failures ? 1 : 0);
