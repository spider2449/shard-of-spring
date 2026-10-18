// A stub "monitor": every routine is an RTS, reset jumps to the slot 6 boot ROM. Only for exercising the
// emulator without real Apple II firmware; contains no Apple code.
module.exports = function fakeRom() {
  const rom = new Uint8Array(12288).fill(0x60);
  const at = (a) => a - 0xD000;
  rom.set([0x4C, 0x00, 0xC6], at(0xFA62)); // JMP $C600
  rom[at(0xFFFC)] = 0x62; rom[at(0xFFFD)] = 0xFA;
  rom[at(0xFFFE)] = 0x60; rom[at(0xFFFF)] = 0xFA;
  return rom;
};
