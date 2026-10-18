// MOS 6502 / WDC 65C02 core with per-instruction cycle counts (including page-crossing and
// branch penalties). Memory goes through the machine object: m.read(addr) / m.write(addr, val).
(function (A2) {
  "use strict";

  const FN = 0x80, FV = 0x40, FB = 0x10, FD = 0x08, FI = 0x04, FZ = 0x02, FC = 0x01;

  // Operation ids.
  const OPS = ("ADC AND ASL BCC BCS BEQ BIT BMI BNE BPL BRK BVC BVS CLC CLD CLI CLV CMP CPX CPY DEC DEX DEY EOR INC INX INY " +
    "JMP JSR LDA LDX LDY LSR NOP ORA PHA PHP PLA PLP ROL ROR RTI RTS SBC SEC SED SEI STA STX STY TAX TAY TSX TXA TXS TYA " +
    "BRA PHX PHY PLX PLY STZ TRB TSB").split(" ");
  const O = {};
  OPS.forEach((n, i) => { O[n] = i; });
  const { ADC, AND, ASL, BCC, BCS, BEQ, BIT, BMI, BNE, BPL, BRK, BVC, BVS, CLC, CLD, CLI, CLV, CMP, CPX, CPY, DEC, DEX, DEY,
    EOR, INC, INX, INY, JMP, JSR, LDA, LDX, LDY, LSR, NOP, ORA, PHA, PHP, PLA, PLP, ROL, ROR, RTI, RTS, SBC, SEC, SED, SEI,
    STA, STX, STY, TAX, TAY, TSX, TXA, TXS, TYA, BRA, PHX, PHY, PLX, PLY, STZ, TRB, TSB } = O;

  // Addressing modes.
  const IMP = 0, ACC = 1, IMM = 2, ZP = 3, ZPX = 4, ZPY = 5, REL = 6, ABS = 7, ABX = 8, ABY = 9, IND = 10, IZX = 11, IZY = 12,
    IZP = 13, IAX = 14;

  // [mnemonic, base cycles, [opcode, mode] ...]; NMOS table first, CMOS additions separately.
  const NMOS = {
    ADC: [2, [0x69, IMM], [0x65, ZP, 3], [0x75, ZPX, 4], [0x6D, ABS, 4], [0x7D, ABX, 4], [0x79, ABY, 4], [0x61, IZX, 6], [0x71, IZY, 5]],
    AND: [2, [0x29, IMM], [0x25, ZP, 3], [0x35, ZPX, 4], [0x2D, ABS, 4], [0x3D, ABX, 4], [0x39, ABY, 4], [0x21, IZX, 6], [0x31, IZY, 5]],
    ASL: [0, [0x0A, ACC, 2], [0x06, ZP, 5], [0x16, ZPX, 6], [0x0E, ABS, 6], [0x1E, ABX, 7]],
    BCC: [0, [0x90, REL, 2]], BCS: [0, [0xB0, REL, 2]], BEQ: [0, [0xF0, REL, 2]], BMI: [0, [0x30, REL, 2]],
    BNE: [0, [0xD0, REL, 2]], BPL: [0, [0x10, REL, 2]], BVC: [0, [0x50, REL, 2]], BVS: [0, [0x70, REL, 2]],
    BIT: [0, [0x24, ZP, 3], [0x2C, ABS, 4]], BRK: [0, [0x00, IMP, 7]],
    CLC: [0, [0x18, IMP, 2]], CLD: [0, [0xD8, IMP, 2]], CLI: [0, [0x58, IMP, 2]], CLV: [0, [0xB8, IMP, 2]],
    CMP: [2, [0xC9, IMM], [0xC5, ZP, 3], [0xD5, ZPX, 4], [0xCD, ABS, 4], [0xDD, ABX, 4], [0xD9, ABY, 4], [0xC1, IZX, 6], [0xD1, IZY, 5]],
    CPX: [0, [0xE0, IMM, 2], [0xE4, ZP, 3], [0xEC, ABS, 4]], CPY: [0, [0xC0, IMM, 2], [0xC4, ZP, 3], [0xCC, ABS, 4]],
    DEC: [0, [0xC6, ZP, 5], [0xD6, ZPX, 6], [0xCE, ABS, 6], [0xDE, ABX, 7]], DEX: [0, [0xCA, IMP, 2]], DEY: [0, [0x88, IMP, 2]],
    EOR: [2, [0x49, IMM], [0x45, ZP, 3], [0x55, ZPX, 4], [0x4D, ABS, 4], [0x5D, ABX, 4], [0x59, ABY, 4], [0x41, IZX, 6], [0x51, IZY, 5]],
    INC: [0, [0xE6, ZP, 5], [0xF6, ZPX, 6], [0xEE, ABS, 6], [0xFE, ABX, 7]], INX: [0, [0xE8, IMP, 2]], INY: [0, [0xC8, IMP, 2]],
    JMP: [0, [0x4C, ABS, 3], [0x6C, IND, 5]], JSR: [0, [0x20, ABS, 6]],
    LDA: [2, [0xA9, IMM], [0xA5, ZP, 3], [0xB5, ZPX, 4], [0xAD, ABS, 4], [0xBD, ABX, 4], [0xB9, ABY, 4], [0xA1, IZX, 6], [0xB1, IZY, 5]],
    LDX: [2, [0xA2, IMM], [0xA6, ZP, 3], [0xB6, ZPY, 4], [0xAE, ABS, 4], [0xBE, ABY, 4]],
    LDY: [2, [0xA0, IMM], [0xA4, ZP, 3], [0xB4, ZPX, 4], [0xAC, ABS, 4], [0xBC, ABX, 4]],
    LSR: [0, [0x4A, ACC, 2], [0x46, ZP, 5], [0x56, ZPX, 6], [0x4E, ABS, 6], [0x5E, ABX, 7]], NOP: [0, [0xEA, IMP, 2]],
    ORA: [2, [0x09, IMM], [0x05, ZP, 3], [0x15, ZPX, 4], [0x0D, ABS, 4], [0x1D, ABX, 4], [0x19, ABY, 4], [0x01, IZX, 6], [0x11, IZY, 5]],
    PHA: [0, [0x48, IMP, 3]], PHP: [0, [0x08, IMP, 3]], PLA: [0, [0x68, IMP, 4]], PLP: [0, [0x28, IMP, 4]],
    ROL: [0, [0x2A, ACC, 2], [0x26, ZP, 5], [0x36, ZPX, 6], [0x2E, ABS, 6], [0x3E, ABX, 7]],
    ROR: [0, [0x6A, ACC, 2], [0x66, ZP, 5], [0x76, ZPX, 6], [0x6E, ABS, 6], [0x7E, ABX, 7]],
    RTI: [0, [0x40, IMP, 6]], RTS: [0, [0x60, IMP, 6]],
    SBC: [2, [0xE9, IMM], [0xE5, ZP, 3], [0xF5, ZPX, 4], [0xED, ABS, 4], [0xFD, ABX, 4], [0xF9, ABY, 4], [0xE1, IZX, 6], [0xF1, IZY, 5]],
    SEC: [0, [0x38, IMP, 2]], SED: [0, [0xF8, IMP, 2]], SEI: [0, [0x78, IMP, 2]],
    STA: [0, [0x85, ZP, 3], [0x95, ZPX, 4], [0x8D, ABS, 4], [0x9D, ABX, 5], [0x99, ABY, 5], [0x81, IZX, 6], [0x91, IZY, 6]],
    STX: [0, [0x86, ZP, 3], [0x96, ZPY, 4], [0x8E, ABS, 4]], STY: [0, [0x84, ZP, 3], [0x94, ZPX, 4], [0x8C, ABS, 4]],
    TAX: [0, [0xAA, IMP, 2]], TAY: [0, [0xA8, IMP, 2]], TSX: [0, [0xBA, IMP, 2]], TXA: [0, [0x8A, IMP, 2]],
    TXS: [0, [0x9A, IMP, 2]], TYA: [0, [0x98, IMP, 2]],
  };
  // 65C02 additions and replacements. Entries marked read (2 in the first slot) take the page-cross penalty.
  const CMOS = {
    ADC: [2, [0x72, IZP, 5]], AND: [2, [0x32, IZP, 5]], CMP: [2, [0xD2, IZP, 5]], EOR: [2, [0x52, IZP, 5]],
    LDA: [2, [0xB2, IZP, 5]], ORA: [2, [0x12, IZP, 5]], SBC: [2, [0xF2, IZP, 5]], STA: [0, [0x92, IZP, 5]],
    BIT: [0, [0x89, IMM, 2], [0x34, ZPX, 4], [0x3C, ABX, 4]],
    DEC: [0, [0x3A, ACC, 2]], INC: [0, [0x1A, ACC, 2]],
    JMP: [0, [0x7C, IAX, 6]],
    BRA: [0, [0x80, REL, 3]],
    NOP: [0, [0x02, IMM, 2], [0x22, IMM, 2], [0x42, IMM, 2], [0x62, IMM, 2], [0x82, IMM, 2], [0xC2, IMM, 2], [0xE2, IMM, 2],
      [0x44, ZP, 3], [0x54, ZPX, 4], [0xD4, ZPX, 4], [0xF4, ZPX, 4], [0x5C, ABS, 8], [0xDC, ABS, 4], [0xFC, ABS, 4]],
    PHX: [0, [0xDA, IMP, 3]], PHY: [0, [0x5A, IMP, 3]], PLX: [0, [0xFA, IMP, 4]], PLY: [0, [0x7A, IMP, 4]],
    STZ: [0, [0x64, ZP, 3], [0x74, ZPX, 4], [0x9C, ABS, 4], [0x9E, ABX, 5]],
    TRB: [0, [0x14, ZP, 5], [0x1C, ABS, 6]], TSB: [0, [0x04, ZP, 5], [0x0C, ABS, 6]],
  };

  function buildTables(cmos) {
    const op = new Uint8Array(256).fill(NOP), mode = new Uint8Array(256).fill(IMP), cyc = new Uint8Array(256).fill(2);
    const pen = new Uint8Array(256), valid = new Uint8Array(256);
    const add = (tbl) => {
      for (const name of Object.keys(tbl)) {
        const e = tbl[name];
        const read = e[0] === 2;
        for (let i = 1; i < e.length; i++) {
          const [code, m, c] = e[i];
          op[code] = O[name]; mode[code] = m; cyc[code] = c === undefined ? 2 : c; valid[code] = 1;
          pen[code] = (read && (m === ABX || m === ABY || m === IZY)) ? 1 : 0;
        }
      }
    };
    add(NMOS);
    if (cmos) {
      add(CMOS);
      // 65C02 cycle fix-ups: RMW abs,X is 6 cycles, penalties apply to the read forms only.
      for (const c of [0x1E, 0x3E, 0x5E, 0x7E]) { cyc[c] = 6; pen[c] = 1; }
    }
    return { op, mode, cyc, pen, valid };
  }
  const T_NMOS = buildTables(false), T_CMOS = buildTables(true);

  class CPU {
    constructor(mem, cmos) {
      this.mem = mem;
      this.cmos = !!cmos;
      this.t = this.cmos ? T_CMOS : T_NMOS;
      this.a = 0; this.x = 0; this.y = 0; this.sp = 0xFF; this.pc = 0; this.p = 0x34;
      this.cycles = 0;
      this.irq = false; this.nmi = false; this.nmiPending = false;
      this.hooks = null; // { page: fn(cpu) -> true when the hook replaced the instruction }
      this.halted = false;
    }

    reset() {
      this.sp = (this.sp - 3) & 0xFF; this.p |= FI; if (this.cmos) this.p &= ~FD;
      this.pc = this.mem.read(0xFFFC) | (this.mem.read(0xFFFD) << 8);
      this.cycles += 7;
    }

    setCmos(c) { this.cmos = !!c; this.t = this.cmos ? T_CMOS : T_NMOS; }

    push(v) { this.mem.write(0x100 + this.sp, v); this.sp = (this.sp - 1) & 0xFF; }
    pull() { this.sp = (this.sp + 1) & 0xFF; return this.mem.read(0x100 + this.sp); }

    interrupt(vec, brk) {
      this.push(this.pc >> 8); this.push(this.pc & 0xFF);
      this.push((this.p & ~FB) | 0x20 | (brk ? FB : 0));
      this.p |= FI; if (this.cmos) this.p &= ~FD;
      this.pc = this.mem.read(vec) | (this.mem.read(vec + 1) << 8);
      this.cycles += 7;
    }

    adc(v) {
      const a = this.a, c = this.p & FC;
      if (this.p & FD) {
        let lo = (a & 0x0F) + (v & 0x0F) + c;
        if (this.cmos) {
          if (lo > 9) lo += 6;
          let r = (a & 0xF0) + (v & 0xF0) + (lo > 0x0F ? 0x10 : 0) + (lo & 0x0F);
          let carry = 0;
          const bin = a + v + c;
          this.p = (this.p & ~FV) | ((~(a ^ v) & (a ^ bin) & 0x80) ? FV : 0);
          if (r > 0x9F) { r += 0x60; }
          carry = r > 0xFF ? 1 : 0;
          this.a = r & 0xFF;
          this.p = (this.p & ~FC) | carry;
          this.setNZ(this.a);
          this.cycles++;
        } else {
          const bin = a + v + c;
          this.p = (this.p & ~FZ) | ((bin & 0xFF) === 0 ? FZ : 0);
          let hi = (a & 0xF0) + (v & 0xF0);
          if (lo > 9) { lo += 6; }
          hi += lo > 0x0F ? 0x10 : 0;
          this.p = (this.p & ~(FN | FV)) | (hi & 0x80) | ((~(a ^ v) & (a ^ hi) & 0x80) ? FV : 0);
          if (hi > 0x90) hi += 0x60;
          this.p = (this.p & ~FC) | (hi > 0xFF ? FC : 0);
          this.a = ((hi & 0xF0) | (lo & 0x0F)) & 0xFF;
        }
      } else {
        const r = a + v + c;
        this.p = (this.p & ~(FC | FV)) | (r > 0xFF ? FC : 0) | ((~(a ^ v) & (a ^ r) & 0x80) ? FV : 0);
        this.a = r & 0xFF;
        this.setNZ(this.a);
      }
    }

    sbc(v) {
      if (this.p & FD) {
        const a = this.a, c = (this.p & FC) ? 0 : 1;
        const bin = a - v - c;
        let lo = (a & 0x0F) - (v & 0x0F) - c;
        let hi = (a >> 4) - (v >> 4);
        if (lo < 0) { lo -= 6; hi -= 1; }
        if (hi < 0) hi -= 6;
        const r = ((hi << 4) | (lo & 0x0F)) & 0xFF;
        this.p = (this.p & ~(FC | FV)) | (bin >= 0 ? FC : 0) | (((a ^ v) & (a ^ bin) & 0x80) ? FV : 0);
        if (this.cmos) { this.a = r; this.setNZ(r); this.cycles++; } else { this.setNZ(bin & 0xFF); this.a = r; }
      } else {
        this.adc(v ^ 0xFF);
      }
    }

    setNZ(v) { this.p = (this.p & ~(FN | FZ)) | (v & 0x80) | (v === 0 ? FZ : 0); return v; }

    cmp(r, v) {
      const t = r - v;
      this.p = (this.p & ~(FC | FN | FZ)) | (t >= 0 ? FC : 0) | (t & 0x80) | ((t & 0xFF) === 0 ? FZ : 0);
    }

    // Execute one instruction (or take a pending interrupt).
    step() {
      const m = this.mem;
      if (this.nmiPending) { this.nmiPending = false; this.interrupt(0xFFFA, false); return; }
      if (this.irq && !(this.p & FI)) { this.interrupt(0xFFFE, false); return; }
      if (this.hooks !== null) {
        const h = this.hooks[this.pc >> 8];
        if (h !== undefined && h(this)) return;
      }
      const t = this.t;
      const opc = m.read(this.pc);
      this.pc = (this.pc + 1) & 0xFFFF;
      if (this.cmos && (opc & 0x0F) === 0x07 || this.cmos && (opc & 0x0F) === 0x0F) { this.bitOp(opc); return; }
      this.cycles += t.cyc[opc];
      let ea = 0, v = 0;
      // ---- effective address
      switch (t.mode[opc]) {
        case IMP: case ACC: break;
        case IMM: ea = this.pc; this.pc = (this.pc + 1) & 0xFFFF; break;
        case ZP: ea = m.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF; break;
        case ZPX: ea = (m.read(this.pc) + this.x) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF; break;
        case ZPY: ea = (m.read(this.pc) + this.y) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF; break;
        case REL: ea = m.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF; break;
        case ABS: ea = m.read(this.pc) | (m.read((this.pc + 1) & 0xFFFF) << 8); this.pc = (this.pc + 2) & 0xFFFF; break;
        case ABX: {
          const b = m.read(this.pc) | (m.read((this.pc + 1) & 0xFFFF) << 8); this.pc = (this.pc + 2) & 0xFFFF;
          ea = (b + this.x) & 0xFFFF; if (t.pen[opc] && ((b ^ ea) & 0xFF00)) this.cycles++;
          break;
        }
        case ABY: {
          const b = m.read(this.pc) | (m.read((this.pc + 1) & 0xFFFF) << 8); this.pc = (this.pc + 2) & 0xFFFF;
          ea = (b + this.y) & 0xFFFF; if (t.pen[opc] && ((b ^ ea) & 0xFF00)) this.cycles++;
          break;
        }
        case IND: {
          const p = m.read(this.pc) | (m.read((this.pc + 1) & 0xFFFF) << 8); this.pc = (this.pc + 2) & 0xFFFF;
          const hiAddr = this.cmos ? (p + 1) & 0xFFFF : (p & 0xFF00) | ((p + 1) & 0xFF);
          ea = m.read(p) | (m.read(hiAddr) << 8);
          break;
        }
        case IAX: {
          const p = ((m.read(this.pc) | (m.read((this.pc + 1) & 0xFFFF) << 8)) + this.x) & 0xFFFF; this.pc = (this.pc + 2) & 0xFFFF;
          ea = m.read(p) | (m.read((p + 1) & 0xFFFF) << 8);
          break;
        }
        case IZX: {
          const z = (m.read(this.pc) + this.x) & 0xFF; this.pc = (this.pc + 1) & 0xFFFF;
          ea = m.read(z) | (m.read((z + 1) & 0xFF) << 8);
          break;
        }
        case IZY: {
          const z = m.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF;
          const b = m.read(z) | (m.read((z + 1) & 0xFF) << 8);
          ea = (b + this.y) & 0xFFFF; if (t.pen[opc] && ((b ^ ea) & 0xFF00)) this.cycles++;
          break;
        }
        case IZP: {
          const z = m.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF;
          ea = m.read(z) | (m.read((z + 1) & 0xFF) << 8);
          break;
        }
      }
      const mode = t.mode[opc];
      // ---- operation
      switch (t.op[opc]) {
        case LDA: this.a = this.setNZ(m.read(ea)); break;
        case LDX: this.x = this.setNZ(m.read(ea)); break;
        case LDY: this.y = this.setNZ(m.read(ea)); break;
        case STA: m.write(ea, this.a); break;
        case STX: m.write(ea, this.x); break;
        case STY: m.write(ea, this.y); break;
        case STZ: m.write(ea, 0); break;
        case AND: this.a = this.setNZ(this.a & m.read(ea)); break;
        case ORA: this.a = this.setNZ(this.a | m.read(ea)); break;
        case EOR: this.a = this.setNZ(this.a ^ m.read(ea)); break;
        case ADC: this.adc(m.read(ea)); break;
        case SBC: this.sbc(m.read(ea)); break;
        case CMP: this.cmp(this.a, m.read(ea)); break;
        case CPX: this.cmp(this.x, m.read(ea)); break;
        case CPY: this.cmp(this.y, m.read(ea)); break;
        case BIT:
          v = m.read(ea);
          if (mode === IMM) this.p = (this.p & ~FZ) | ((v & this.a) === 0 ? FZ : 0);
          else this.p = (this.p & ~(FN | FV | FZ)) | (v & (FN | FV)) | ((v & this.a) === 0 ? FZ : 0);
          break;
        case ASL:
          if (mode === ACC) { this.p = (this.p & ~FC) | (this.a >> 7); this.a = this.setNZ((this.a << 1) & 0xFF); }
          else { v = m.read(ea); this.p = (this.p & ~FC) | (v >> 7); m.write(ea, this.setNZ((v << 1) & 0xFF)); }
          break;
        case LSR:
          if (mode === ACC) { this.p = (this.p & ~FC) | (this.a & 1); this.a = this.setNZ(this.a >> 1); }
          else { v = m.read(ea); this.p = (this.p & ~FC) | (v & 1); m.write(ea, this.setNZ(v >> 1)); }
          break;
        case ROL:
          if (mode === ACC) { v = this.a; this.a = this.setNZ(((v << 1) | (this.p & FC)) & 0xFF); this.p = (this.p & ~FC) | (v >> 7); }
          else { v = m.read(ea); m.write(ea, this.setNZ(((v << 1) | (this.p & FC)) & 0xFF)); this.p = (this.p & ~FC) | (v >> 7); }
          break;
        case ROR:
          if (mode === ACC) { v = this.a; this.a = this.setNZ((v >> 1) | ((this.p & FC) << 7)); this.p = (this.p & ~FC) | (v & 1); }
          else { v = m.read(ea); m.write(ea, this.setNZ((v >> 1) | ((this.p & FC) << 7))); this.p = (this.p & ~FC) | (v & 1); }
          break;
        case INC:
          if (mode === ACC) this.a = this.setNZ((this.a + 1) & 0xFF);
          else m.write(ea, this.setNZ((m.read(ea) + 1) & 0xFF));
          break;
        case DEC:
          if (mode === ACC) this.a = this.setNZ((this.a - 1) & 0xFF);
          else m.write(ea, this.setNZ((m.read(ea) - 1) & 0xFF));
          break;
        case INX: this.x = this.setNZ((this.x + 1) & 0xFF); break;
        case INY: this.y = this.setNZ((this.y + 1) & 0xFF); break;
        case DEX: this.x = this.setNZ((this.x - 1) & 0xFF); break;
        case DEY: this.y = this.setNZ((this.y - 1) & 0xFF); break;
        case TRB: v = m.read(ea); this.p = (this.p & ~FZ) | ((v & this.a) === 0 ? FZ : 0); m.write(ea, v & ~this.a); break;
        case TSB: v = m.read(ea); this.p = (this.p & ~FZ) | ((v & this.a) === 0 ? FZ : 0); m.write(ea, v | this.a); break;
        case BPL: this.branch(!(this.p & FN), ea); break;
        case BMI: this.branch(this.p & FN, ea); break;
        case BVC: this.branch(!(this.p & FV), ea); break;
        case BVS: this.branch(this.p & FV, ea); break;
        case BCC: this.branch(!(this.p & FC), ea); break;
        case BCS: this.branch(this.p & FC, ea); break;
        case BNE: this.branch(!(this.p & FZ), ea); break;
        case BEQ: this.branch(this.p & FZ, ea); break;
        case BRA: this.branch(true, ea); break;
        case JMP: this.pc = ea; break;
        case JSR: {
          const ret = (this.pc - 1) & 0xFFFF;
          this.push(ret >> 8); this.push(ret & 0xFF); this.pc = ea;
          break;
        }
        case RTS: v = this.pull(); v |= this.pull() << 8; this.pc = (v + 1) & 0xFFFF; break;
        case RTI: this.p = (this.pull() & ~FB) | 0x20; v = this.pull(); v |= this.pull() << 8; this.pc = v; break;
        case BRK:
          this.pc = (this.pc + 1) & 0xFFFF;
          this.cycles -= 7; this.interrupt(0xFFFE, true);
          break;
        case PHA: this.push(this.a); break;
        case PHP: this.push(this.p | FB | 0x20); break;
        case PHX: this.push(this.x); break;
        case PHY: this.push(this.y); break;
        case PLA: this.a = this.setNZ(this.pull()); break;
        case PLP: this.p = (this.pull() & ~FB) | 0x20; break;
        case PLX: this.x = this.setNZ(this.pull()); break;
        case PLY: this.y = this.setNZ(this.pull()); break;
        case CLC: this.p &= ~FC; break;
        case SEC: this.p |= FC; break;
        case CLD: this.p &= ~FD; break;
        case SED: this.p |= FD; break;
        case CLI: this.p &= ~FI; break;
        case SEI: this.p |= FI; break;
        case CLV: this.p &= ~FV; break;
        case TAX: this.x = this.setNZ(this.a); break;
        case TAY: this.y = this.setNZ(this.a); break;
        case TXA: this.a = this.setNZ(this.x); break;
        case TYA: this.a = this.setNZ(this.y); break;
        case TSX: this.x = this.setNZ(this.sp); break;
        case TXS: this.sp = this.x; break;
        default: break; // NOP and undefined opcodes
      }
    }

    // Rockwell/WDC bit instructions: RMBn, SMBn (x7) and BBRn, BBSn (xF).
    bitOp(opc) {
      const m = this.mem, bit = (opc >> 4) & 7, set = opc & 0x80;
      const zp = m.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF;
      if ((opc & 0x0F) === 0x07) {
        const v = m.read(zp);
        m.write(zp, set ? (v | (1 << bit)) : (v & ~(1 << bit)));
        this.cycles += 5;
      } else {
        const off = m.read(this.pc); this.pc = (this.pc + 1) & 0xFFFF;
        this.cycles += 5;
        if (!!(m.read(zp) & (1 << bit)) === !!set) this.branch(true, off);
      }
    }

    branch(cond, off) {
      if (!cond) return;
      const from = this.pc;
      this.pc = (this.pc + (off > 127 ? off - 256 : off)) & 0xFFFF;
      this.cycles += ((from ^ this.pc) & 0xFF00) ? 2 : 1;
    }
  }

  CPU.NMOS = NMOS; // opcode tables, used by the test assembler
  CPU.MODES = { IMP, ACC, IMM, ZP, ZPX, ZPY, REL, ABS, ABX, ABY, IND, IZX, IZY };
  A2.CPU = CPU;
})(typeof A2 !== "undefined" ? A2 : (globalThis.A2 = globalThis.A2 || {}));
