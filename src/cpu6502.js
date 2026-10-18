// 6502 CPU core (NMOS, documented opcodes). Memory access goes through the
// machine object (read/write callbacks) so soft switches can be intercepted.
(function (SS) {
  "use strict";

  const N = 0x80, V = 0x40, B = 0x10, D = 0x08, I = 0x04, Z = 0x02, C = 0x01;

  // Base cycle counts per opcode (page-crossing penalties ignored); used for sound timing.
  const CYC = new Uint8Array(256).fill(2);
  const CYC_TABLE = {
    0x00: 7, 0x01: 6, 0x05: 3, 0x06: 5, 0x08: 3, 0x0D: 4, 0x0E: 6, 0x11: 5, 0x15: 4, 0x16: 6, 0x19: 4, 0x1D: 4, 0x1E: 7,
    0x20: 6, 0x21: 6, 0x24: 3, 0x25: 3, 0x26: 5, 0x28: 4, 0x2C: 4, 0x2D: 4, 0x2E: 6, 0x31: 5, 0x35: 4, 0x36: 6, 0x39: 4, 0x3D: 4, 0x3E: 7,
    0x40: 6, 0x41: 6, 0x45: 3, 0x46: 5, 0x48: 3, 0x4C: 3, 0x4D: 4, 0x4E: 6, 0x51: 5, 0x55: 4, 0x56: 6, 0x59: 4, 0x5D: 4, 0x5E: 7,
    0x60: 6, 0x61: 6, 0x65: 3, 0x66: 5, 0x68: 4, 0x6C: 5, 0x6D: 4, 0x6E: 6, 0x71: 5, 0x75: 4, 0x76: 6, 0x79: 4, 0x7D: 4, 0x7E: 7,
    0x81: 6, 0x84: 3, 0x85: 3, 0x86: 3, 0x8C: 4, 0x8D: 4, 0x8E: 4, 0x91: 6, 0x94: 4, 0x95: 4, 0x96: 4, 0x99: 5, 0x9D: 5,
    0xA1: 6, 0xA4: 3, 0xA5: 3, 0xA6: 3, 0xAC: 4, 0xAD: 4, 0xAE: 4, 0xB1: 5, 0xB4: 4, 0xB5: 4, 0xB6: 4, 0xB9: 4, 0xBC: 4, 0xBD: 4, 0xBE: 4,
    0xC1: 6, 0xC4: 3, 0xC5: 3, 0xC6: 5, 0xCC: 4, 0xCD: 4, 0xCE: 6, 0xD1: 5, 0xD5: 4, 0xD6: 6, 0xD9: 4, 0xDD: 4, 0xDE: 7,
    0xE1: 6, 0xE4: 3, 0xE5: 3, 0xE6: 5, 0xEC: 4, 0xED: 4, 0xEE: 6, 0xF1: 5, 0xF5: 4, 0xF6: 6, 0xF9: 4, 0xFD: 4, 0xFE: 7,
  };
  for (const k of Object.keys(CYC_TABLE)) CYC[k] = CYC_TABLE[k];

  class CPU {
    constructor(mem) {
      this.mem = mem; // { read(addr), write(addr, val), trap(cpu) }
      this.a = 0; this.x = 0; this.y = 0; this.sp = 0xFF; this.pc = 0; this.p = 0x24;
      this.cycles = 0;
    }

    push(v) { this.mem.write(0x100 + this.sp, v & 0xFF); this.sp = (this.sp - 1) & 0xFF; }
    pull() { this.sp = (this.sp + 1) & 0xFF; return this.mem.read(0x100 + this.sp); }
    rd(a) { return this.mem.read(a & 0xFFFF); }
    wr(a, v) { this.mem.write(a & 0xFFFF, v & 0xFF); }
    rd16(a) { return this.rd(a) | (this.rd(a + 1) << 8); }

    setNZ(v) { this.p = (this.p & ~(N | Z)) | (v & 0x80) | (v === 0 ? Z : 0); return v; }

    adc(v) {
      const a = this.a, c = this.p & C;
      if (this.p & D) {
        let lo = (a & 0x0F) + (v & 0x0F) + c;
        let hi = (a >> 4) + (v >> 4);
        const bin = a + v + c;
        this.p = (this.p & ~Z) | ((bin & 0xFF) === 0 ? Z : 0);
        if (lo > 9) { lo += 6; hi += 1; }
        this.p = (this.p & ~(N | V)) | ((hi << 4) & 0x80) | ((~(a ^ v) & (a ^ (hi << 4)) & 0x80) ? V : 0);
        if (hi > 9) hi += 6;
        this.p = (this.p & ~C) | (hi > 15 ? C : 0);
        this.a = ((hi << 4) | (lo & 0x0F)) & 0xFF;
      } else {
        const r = a + v + c;
        this.p = (this.p & ~(C | V)) | (r > 0xFF ? C : 0) | ((~(a ^ v) & (a ^ r) & 0x80) ? V : 0);
        this.a = r & 0xFF;
        this.setNZ(this.a);
      }
    }

    sbc(v) {
      if (this.p & D) {
        const a = this.a, c = (this.p & C) ? 0 : 1;
        const bin = a - v - c;
        let lo = (a & 0x0F) - (v & 0x0F) - c;
        let hi = (a >> 4) - (v >> 4);
        if (lo < 0) { lo -= 6; hi -= 1; }
        if (hi < 0) hi -= 6;
        this.p = (this.p & ~(C | V)) | (bin >= 0 ? C : 0) | (((a ^ v) & (a ^ bin) & 0x80) ? V : 0);
        this.setNZ(bin & 0xFF);
        this.a = ((hi << 4) | (lo & 0x0F)) & 0xFF;
      } else {
        this.adc(v ^ 0xFF);
      }
    }

    cmp(r, v) {
      const t = r - v;
      this.p = (this.p & ~C) | (t >= 0 ? C : 0);
      this.setNZ(t & 0xFF);
    }

    branch(cond) {
      const off = this.rd(this.pc++);
      if (cond) { this.pc = (this.pc + (off > 127 ? off - 256 : off)) & 0xFFFF; this.cycles++; }
    }

    // Addressing mode helpers return effective addresses
    zp() { return this.rd(this.pc++); }
    zpx() { return (this.rd(this.pc++) + this.x) & 0xFF; }
    zpy() { return (this.rd(this.pc++) + this.y) & 0xFF; }
    abs() { const a = this.rd16(this.pc); this.pc += 2; return a; }
    absx() { const a = this.rd16(this.pc); this.pc += 2; return (a + this.x) & 0xFFFF; }
    absy() { const a = this.rd16(this.pc); this.pc += 2; return (a + this.y) & 0xFFFF; }
    indx() { const z = (this.rd(this.pc++) + this.x) & 0xFF; return this.rd(z) | (this.rd((z + 1) & 0xFF) << 8); }
    indy() { const z = this.rd(this.pc++); return ((this.rd(z) | (this.rd((z + 1) & 0xFF) << 8)) + this.y) & 0xFFFF; }

    // Execute one instruction.
    step() {
      if (this.mem.trap && this.mem.trap(this)) return;
      const op = this.rd(this.pc++);
      this.cycles += CYC[op];
      let a, v;
      switch (op) {
        case 0x00: this.pc++; this.push(this.pc >> 8); this.push(this.pc); this.push(this.p | B | 0x20);
          this.p |= I; this.pc = this.rd16(0xFFFE); break;
        // ORA
        case 0x09: this.a |= this.rd(this.pc++); this.setNZ(this.a); break;
        case 0x05: this.a |= this.rd(this.zp()); this.setNZ(this.a); break;
        case 0x15: this.a |= this.rd(this.zpx()); this.setNZ(this.a); break;
        case 0x0D: this.a |= this.rd(this.abs()); this.setNZ(this.a); break;
        case 0x1D: this.a |= this.rd(this.absx()); this.setNZ(this.a); break;
        case 0x19: this.a |= this.rd(this.absy()); this.setNZ(this.a); break;
        case 0x01: this.a |= this.rd(this.indx()); this.setNZ(this.a); break;
        case 0x11: this.a |= this.rd(this.indy()); this.setNZ(this.a); break;
        // AND
        case 0x29: this.a &= this.rd(this.pc++); this.setNZ(this.a); break;
        case 0x25: this.a &= this.rd(this.zp()); this.setNZ(this.a); break;
        case 0x35: this.a &= this.rd(this.zpx()); this.setNZ(this.a); break;
        case 0x2D: this.a &= this.rd(this.abs()); this.setNZ(this.a); break;
        case 0x3D: this.a &= this.rd(this.absx()); this.setNZ(this.a); break;
        case 0x39: this.a &= this.rd(this.absy()); this.setNZ(this.a); break;
        case 0x21: this.a &= this.rd(this.indx()); this.setNZ(this.a); break;
        case 0x31: this.a &= this.rd(this.indy()); this.setNZ(this.a); break;
        // EOR
        case 0x49: this.a ^= this.rd(this.pc++); this.setNZ(this.a); break;
        case 0x45: this.a ^= this.rd(this.zp()); this.setNZ(this.a); break;
        case 0x55: this.a ^= this.rd(this.zpx()); this.setNZ(this.a); break;
        case 0x4D: this.a ^= this.rd(this.abs()); this.setNZ(this.a); break;
        case 0x5D: this.a ^= this.rd(this.absx()); this.setNZ(this.a); break;
        case 0x59: this.a ^= this.rd(this.absy()); this.setNZ(this.a); break;
        case 0x41: this.a ^= this.rd(this.indx()); this.setNZ(this.a); break;
        case 0x51: this.a ^= this.rd(this.indy()); this.setNZ(this.a); break;
        // ADC
        case 0x69: this.adc(this.rd(this.pc++)); break;
        case 0x65: this.adc(this.rd(this.zp())); break;
        case 0x75: this.adc(this.rd(this.zpx())); break;
        case 0x6D: this.adc(this.rd(this.abs())); break;
        case 0x7D: this.adc(this.rd(this.absx())); break;
        case 0x79: this.adc(this.rd(this.absy())); break;
        case 0x61: this.adc(this.rd(this.indx())); break;
        case 0x71: this.adc(this.rd(this.indy())); break;
        // SBC
        case 0xE9: this.sbc(this.rd(this.pc++)); break;
        case 0xE5: this.sbc(this.rd(this.zp())); break;
        case 0xF5: this.sbc(this.rd(this.zpx())); break;
        case 0xED: this.sbc(this.rd(this.abs())); break;
        case 0xFD: this.sbc(this.rd(this.absx())); break;
        case 0xF9: this.sbc(this.rd(this.absy())); break;
        case 0xE1: this.sbc(this.rd(this.indx())); break;
        case 0xF1: this.sbc(this.rd(this.indy())); break;
        // CMP
        case 0xC9: this.cmp(this.a, this.rd(this.pc++)); break;
        case 0xC5: this.cmp(this.a, this.rd(this.zp())); break;
        case 0xD5: this.cmp(this.a, this.rd(this.zpx())); break;
        case 0xCD: this.cmp(this.a, this.rd(this.abs())); break;
        case 0xDD: this.cmp(this.a, this.rd(this.absx())); break;
        case 0xD9: this.cmp(this.a, this.rd(this.absy())); break;
        case 0xC1: this.cmp(this.a, this.rd(this.indx())); break;
        case 0xD1: this.cmp(this.a, this.rd(this.indy())); break;
        // CPX / CPY
        case 0xE0: this.cmp(this.x, this.rd(this.pc++)); break;
        case 0xE4: this.cmp(this.x, this.rd(this.zp())); break;
        case 0xEC: this.cmp(this.x, this.rd(this.abs())); break;
        case 0xC0: this.cmp(this.y, this.rd(this.pc++)); break;
        case 0xC4: this.cmp(this.y, this.rd(this.zp())); break;
        case 0xCC: this.cmp(this.y, this.rd(this.abs())); break;
        // LDA
        case 0xA9: this.a = this.setNZ(this.rd(this.pc++)); break;
        case 0xA5: this.a = this.setNZ(this.rd(this.zp())); break;
        case 0xB5: this.a = this.setNZ(this.rd(this.zpx())); break;
        case 0xAD: this.a = this.setNZ(this.rd(this.abs())); break;
        case 0xBD: this.a = this.setNZ(this.rd(this.absx())); break;
        case 0xB9: this.a = this.setNZ(this.rd(this.absy())); break;
        case 0xA1: this.a = this.setNZ(this.rd(this.indx())); break;
        case 0xB1: this.a = this.setNZ(this.rd(this.indy())); break;
        // LDX
        case 0xA2: this.x = this.setNZ(this.rd(this.pc++)); break;
        case 0xA6: this.x = this.setNZ(this.rd(this.zp())); break;
        case 0xB6: this.x = this.setNZ(this.rd(this.zpy())); break;
        case 0xAE: this.x = this.setNZ(this.rd(this.abs())); break;
        case 0xBE: this.x = this.setNZ(this.rd(this.absy())); break;
        // LDY
        case 0xA0: this.y = this.setNZ(this.rd(this.pc++)); break;
        case 0xA4: this.y = this.setNZ(this.rd(this.zp())); break;
        case 0xB4: this.y = this.setNZ(this.rd(this.zpx())); break;
        case 0xAC: this.y = this.setNZ(this.rd(this.abs())); break;
        case 0xBC: this.y = this.setNZ(this.rd(this.absx())); break;
        // STA
        case 0x85: this.wr(this.zp(), this.a); break;
        case 0x95: this.wr(this.zpx(), this.a); break;
        case 0x8D: this.wr(this.abs(), this.a); break;
        case 0x9D: this.wr(this.absx(), this.a); break;
        case 0x99: this.wr(this.absy(), this.a); break;
        case 0x81: this.wr(this.indx(), this.a); break;
        case 0x91: this.wr(this.indy(), this.a); break;
        // STX / STY
        case 0x86: this.wr(this.zp(), this.x); break;
        case 0x96: this.wr(this.zpy(), this.x); break;
        case 0x8E: this.wr(this.abs(), this.x); break;
        case 0x84: this.wr(this.zp(), this.y); break;
        case 0x94: this.wr(this.zpx(), this.y); break;
        case 0x8C: this.wr(this.abs(), this.y); break;
        // ASL
        case 0x0A: this.p = (this.p & ~C) | (this.a >> 7); this.a = this.setNZ((this.a << 1) & 0xFF); break;
        case 0x06: a = this.zp(); v = this.rd(a); this.p = (this.p & ~C) | (v >> 7); this.wr(a, this.setNZ((v << 1) & 0xFF)); break;
        case 0x16: a = this.zpx(); v = this.rd(a); this.p = (this.p & ~C) | (v >> 7); this.wr(a, this.setNZ((v << 1) & 0xFF)); break;
        case 0x0E: a = this.abs(); v = this.rd(a); this.p = (this.p & ~C) | (v >> 7); this.wr(a, this.setNZ((v << 1) & 0xFF)); break;
        case 0x1E: a = this.absx(); v = this.rd(a); this.p = (this.p & ~C) | (v >> 7); this.wr(a, this.setNZ((v << 1) & 0xFF)); break;
        // LSR
        case 0x4A: this.p = (this.p & ~C) | (this.a & 1); this.a = this.setNZ(this.a >> 1); break;
        case 0x46: a = this.zp(); v = this.rd(a); this.p = (this.p & ~C) | (v & 1); this.wr(a, this.setNZ(v >> 1)); break;
        case 0x56: a = this.zpx(); v = this.rd(a); this.p = (this.p & ~C) | (v & 1); this.wr(a, this.setNZ(v >> 1)); break;
        case 0x4E: a = this.abs(); v = this.rd(a); this.p = (this.p & ~C) | (v & 1); this.wr(a, this.setNZ(v >> 1)); break;
        case 0x5E: a = this.absx(); v = this.rd(a); this.p = (this.p & ~C) | (v & 1); this.wr(a, this.setNZ(v >> 1)); break;
        // ROL
        case 0x2A: v = this.a; this.a = this.setNZ(((v << 1) | (this.p & C)) & 0xFF); this.p = (this.p & ~C) | (v >> 7); break;
        case 0x26: a = this.zp(); v = this.rd(a); this.wr(a, this.setNZ(((v << 1) | (this.p & C)) & 0xFF)); this.p = (this.p & ~C) | (v >> 7); break;
        case 0x36: a = this.zpx(); v = this.rd(a); this.wr(a, this.setNZ(((v << 1) | (this.p & C)) & 0xFF)); this.p = (this.p & ~C) | (v >> 7); break;
        case 0x2E: a = this.abs(); v = this.rd(a); this.wr(a, this.setNZ(((v << 1) | (this.p & C)) & 0xFF)); this.p = (this.p & ~C) | (v >> 7); break;
        case 0x3E: a = this.absx(); v = this.rd(a); this.wr(a, this.setNZ(((v << 1) | (this.p & C)) & 0xFF)); this.p = (this.p & ~C) | (v >> 7); break;
        // ROR
        case 0x6A: v = this.a; this.a = this.setNZ((v >> 1) | ((this.p & C) << 7)); this.p = (this.p & ~C) | (v & 1); break;
        case 0x66: a = this.zp(); v = this.rd(a); this.wr(a, this.setNZ((v >> 1) | ((this.p & C) << 7))); this.p = (this.p & ~C) | (v & 1); break;
        case 0x76: a = this.zpx(); v = this.rd(a); this.wr(a, this.setNZ((v >> 1) | ((this.p & C) << 7))); this.p = (this.p & ~C) | (v & 1); break;
        case 0x6E: a = this.abs(); v = this.rd(a); this.wr(a, this.setNZ((v >> 1) | ((this.p & C) << 7))); this.p = (this.p & ~C) | (v & 1); break;
        case 0x7E: a = this.absx(); v = this.rd(a); this.wr(a, this.setNZ((v >> 1) | ((this.p & C) << 7))); this.p = (this.p & ~C) | (v & 1); break;
        // INC / DEC
        case 0xE6: a = this.zp(); this.wr(a, this.setNZ((this.rd(a) + 1) & 0xFF)); break;
        case 0xF6: a = this.zpx(); this.wr(a, this.setNZ((this.rd(a) + 1) & 0xFF)); break;
        case 0xEE: a = this.abs(); this.wr(a, this.setNZ((this.rd(a) + 1) & 0xFF)); break;
        case 0xFE: a = this.absx(); this.wr(a, this.setNZ((this.rd(a) + 1) & 0xFF)); break;
        case 0xC6: a = this.zp(); this.wr(a, this.setNZ((this.rd(a) - 1) & 0xFF)); break;
        case 0xD6: a = this.zpx(); this.wr(a, this.setNZ((this.rd(a) - 1) & 0xFF)); break;
        case 0xCE: a = this.abs(); this.wr(a, this.setNZ((this.rd(a) - 1) & 0xFF)); break;
        case 0xDE: a = this.absx(); this.wr(a, this.setNZ((this.rd(a) - 1) & 0xFF)); break;
        case 0xE8: this.x = this.setNZ((this.x + 1) & 0xFF); break;
        case 0xC8: this.y = this.setNZ((this.y + 1) & 0xFF); break;
        case 0xCA: this.x = this.setNZ((this.x - 1) & 0xFF); break;
        case 0x88: this.y = this.setNZ((this.y - 1) & 0xFF); break;
        // BIT
        case 0x24: v = this.rd(this.zp()); this.p = (this.p & ~(N | V | Z)) | (v & (N | V)) | ((v & this.a) === 0 ? Z : 0); break;
        case 0x2C: v = this.rd(this.abs()); this.p = (this.p & ~(N | V | Z)) | (v & (N | V)) | ((v & this.a) === 0 ? Z : 0); break;
        // Branches
        case 0x10: this.branch(!(this.p & N)); break;
        case 0x30: this.branch(this.p & N); break;
        case 0x50: this.branch(!(this.p & V)); break;
        case 0x70: this.branch(this.p & V); break;
        case 0x90: this.branch(!(this.p & C)); break;
        case 0xB0: this.branch(this.p & C); break;
        case 0xD0: this.branch(!(this.p & Z)); break;
        case 0xF0: this.branch(this.p & Z); break;
        // Jumps
        case 0x4C: this.pc = this.rd16(this.pc); break;
        case 0x6C: a = this.rd16(this.pc); this.pc = this.rd(a) | (this.rd((a & 0xFF00) | ((a + 1) & 0xFF)) << 8); break;
        case 0x20: a = this.rd16(this.pc); this.pc += 1; this.push(this.pc >> 8); this.push(this.pc & 0xFF); this.pc = a; break;
        case 0x60: a = this.pull(); a |= this.pull() << 8; this.pc = (a + 1) & 0xFFFF; break;
        case 0x40: this.p = (this.pull() & ~B) | 0x20; a = this.pull(); a |= this.pull() << 8; this.pc = a; break;
        // Stack
        case 0x48: this.push(this.a); break;
        case 0x68: this.a = this.setNZ(this.pull()); break;
        case 0x08: this.push(this.p | B | 0x20); break;
        case 0x28: this.p = (this.pull() & ~B) | 0x20; break;
        // Flags
        case 0x18: this.p &= ~C; break;
        case 0x38: this.p |= C; break;
        case 0x58: this.p &= ~I; break;
        case 0x78: this.p |= I; break;
        case 0xB8: this.p &= ~V; break;
        case 0xD8: this.p &= ~D; break;
        case 0xF8: this.p |= D; break;
        // Transfers
        case 0xAA: this.x = this.setNZ(this.a); break;
        case 0xA8: this.y = this.setNZ(this.a); break;
        case 0x8A: this.a = this.setNZ(this.x); break;
        case 0x98: this.a = this.setNZ(this.y); break;
        case 0xBA: this.x = this.setNZ(this.sp); break;
        case 0x9A: this.sp = this.x; break;
        case 0xEA: break;
        default:
          throw new Error("Illegal 6502 opcode $" + op.toString(16) + " at $" + ((this.pc - 1) & 0xFFFF).toString(16));
      }
    }
  }

  SS.CPU = CPU;
})(typeof SS !== "undefined" ? SS : (globalThis.SS = globalThis.SS || {}));
