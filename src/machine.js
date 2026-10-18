// Apple II machine model: 64K RAM, 16K language card, soft switches, keyboard,
// text/hi-res video state, and native replacements for the monitor ROM routines
// that the game's machine code calls.
(function (SS) {
  "use strict";

  const RET_SENTINEL = 0xFFF9;

  class Machine {
    constructor() {
      this.ram = new Uint8Array(65536);
      this.lcBank1 = new Uint8Array(4096);
      this.lcBank2 = new Uint8Array(4096);
      this.lcUpper = new Uint8Array(8192);
      this.lcRead = false; this.lcWrite = false; this.lcBank2On = true; this.lcPre = false;
      this.keys = [];           // queued key codes (0-127)
      this.keyLatch = 0; this.keyStrobe = false;
      this.keyPolls = 0; this.wantYield = false;
      this.graphics = false; this.hires = false; this.mixed = false; this.page2 = false;
      this.speaker = [];        // CPU cycle stamps of $C030 toggles
      this.cpu = new SS.CPU(this);
      this.finished = false;
      this.onBell = null;
      this.reset();
    }

    reset() {
      this.ram.fill(0);
      this.ram.fill(0xA0, 0x400, 0x800);
      const r = this.ram;
      r[0x20] = 0; r[0x21] = 40; r[0x22] = 0; r[0x23] = 24; r[0x24] = 0; r[0x25] = 0;
      r[0x32] = 0xFF;
      r[0x36] = 0xF0; r[0x37] = 0xFD; r[0x38] = 0x1B; r[0x39] = 0xFD;
      // Reset vector high byte >= 157 means "cold start" for the game's START program.
      r[0x3F2] = 0x00; r[0x3F3] = 0xBE;
      this.vtab(0);
    }

    // ------------------------------------------------------------ memory
    read(a) {
      if (a < 0xC000) return this.ram[a];
      if (a < 0xC100) return this.ioRead(a);
      if (a < 0xD000) return 0;
      if (!this.lcRead) return 0;
      if (a < 0xE000) return (this.lcBank2On ? this.lcBank2 : this.lcBank1)[a - 0xD000];
      return this.lcUpper[a - 0xE000];
    }

    write(a, v) {
      if (a < 0xC000) { this.ram[a] = v; if ((a >= 0x2000 && a < 0x6000) || (a >= 0x400 && a < 0x800)) this.videoDirty = true; return; }
      if (a < 0xC100) { this.videoDirty = true; this.ioWrite(a, v); return; }
      if (a < 0xD000 || !this.lcWrite) return;
      if (a < 0xE000) (this.lcBank2On ? this.lcBank2 : this.lcBank1)[a - 0xD000] = v;
      else this.lcUpper[a - 0xE000] = v;
    }

    // Raw access that ignores soft switches (used by the interpreter's PEEK of RAM)
    peek(a) {
      a &= 0xFFFF;
      if (a >= 0xC000 && a < 0xC100) return this.ioRead(a);
      return this.read(a);
    }
    poke(a, v) { this.write(a & 0xFFFF, v & 0xFF); }

    ioRead(a) {
      switch (a) {
        case 0xC000: {
          if (!this.keyStrobe && this.keys.length) { this.keyLatch = this.keys.shift(); this.keyStrobe = true; }
          if (!this.keyStrobe) { if (++this.keyPolls > 40) this.wantYield = true; }
          else this.keyPolls = 0;
          return this.keyLatch | (this.keyStrobe ? 0x80 : 0);
        }
        case 0xC010: { const s = this.keyStrobe; this.keyStrobe = false; return this.keyLatch | (s ? 0x80 : 0); }
        case 0xC030: this.speaker.push(this.cpu.cycles); return 0;
        case 0xC050: this.graphics = true; this.videoDirty = true; return 0;
        case 0xC051: this.graphics = false; return 0;
        case 0xC052: this.mixed = false; return 0;
        case 0xC053: this.mixed = true; return 0;
        case 0xC054: this.page2 = false; return 0;
        case 0xC055: this.page2 = true; return 0;
        case 0xC056: this.hires = false; return 0;
        case 0xC057: this.hires = true; return 0;
        default: break;
      }
      if (a >= 0xC080 && a <= 0xC08F) { this.lcSwitch(a); return 0; }
      return 0;
    }

    ioWrite(a, v) {
      if (a === 0xC010) { this.keyStrobe = false; return; }
      this.ioRead(a);
    }

    lcSwitch(a) {
      const x = a & 3;
      this.lcBank2On = (a & 8) === 0;
      this.lcRead = (x === 0 || x === 3);
      if (a & 1) { if (this.lcPre) this.lcWrite = true; this.lcPre = true; }
      else { this.lcWrite = false; this.lcPre = false; }
    }

    pushKey(code) { this.keys.push(code & 0x7F); this.keyPolls = 0; }
    hasKey() { return this.keyStrobe || this.keys.length > 0; }
    takeKey() {
      if (!this.keyStrobe && this.keys.length) { this.keyLatch = this.keys.shift(); this.keyStrobe = true; }
      if (!this.keyStrobe) return -1;
      this.keyStrobe = false;
      return this.keyLatch;
    }

    // ------------------------------------------------------------ ML calls
    startML(addr, a = 0, x = 0, y = 0, keepSp = false) {
      const c = this.cpu;
      c.a = a & 0xFF; c.x = x & 0xFF; c.y = y & 0xFF; c.p = 0x24;
      if (!keepSp) c.sp = 0xFF;
      const ret = RET_SENTINEL - 1;
      c.push(ret >> 8); c.push(ret & 0xFF);
      c.pc = addr & 0xFFFF;
      this.finished = false;
    }

    // Run until the routine returns (true) or has to wait for a key (false).
    runML(maxSteps = 5000000) {
      const c = this.cpu;
      this.wantYield = false;
      this.runDepth = (this.runDepth || 0) + 1;
      try {
        for (let i = 0; i < maxSteps; i++) {
          c.step();
          if (this.finished) return true;
          if (this.wantYield) { this.wantYield = false; return false; }
        }
        return false;
      } finally { this.runDepth--; }
    }

    // Synchronous, re-entrant call used for hooks (CSW output, RDOS stubs): the CPU state of any
    // routine that is already running is saved and restored around the call.
    callML(addr, a, x, y) {
      const c = this.cpu;
      const save = { a: c.a, x: c.x, y: c.y, sp: c.sp, p: c.p, pc: c.pc, finished: this.finished, want: this.wantYield };
      const nested = this.runDepth > 0;
      this.startML(addr, a, x, y, nested);
      let guard = 0;
      while (!this.runML()) { if (++guard > 20) throw new Error("ML routine at $" + addr.toString(16) + " did not return"); }
      c.a = save.a; c.x = save.x; c.y = save.y; c.sp = save.sp; c.p = save.p; c.pc = save.pc;
      this.finished = save.finished; this.wantYield = save.want;
      return true;
    }

    // Called by the CPU before each instruction. Handles ROM entry points.
    trap(c) {
      const pc = c.pc;
      if (pc === RET_SENTINEL) { this.finished = true; return true; }
      if (pc >= 0xB000 && pc < 0xC000 && this.hooks && this.hooks[pc]) return this.hooks[pc].call(this, c);
      if (pc < 0xC000) return false;
      if (pc >= 0xD000 && this.lcRead) return false;
      if (pc >= 0xC000 && pc < 0xD000) { return this.rts(c); }
      const f = ROM[pc];
      if (!f) {
        if (this.onUnknownRom) this.onUnknownRom(pc);
        return this.rts(c);
      }
      return f.call(this, c);
    }

    rts(c) {
      let a = c.pull(); a |= c.pull() << 8; c.pc = (a + 1) & 0xFFFF;
      return true;
    }

    // ------------------------------------------------------------ text screen
    rowBase(row) { return 0x400 + (row & 7) * 0x80 + (row >> 3) * 0x28; }

    vtab(row) {
      const r = this.ram;
      r[0x25] = row;
      const base = this.rowBase(row) + r[0x20];
      r[0x28] = base & 0xFF; r[0x29] = base >> 8;
    }

    scroll() {
      const r = this.ram, top = r[0x22], bot = r[0x23], left = r[0x20], w = r[0x21];
      for (let row = top; row < bot - 1; row++) {
        const d = this.rowBase(row) + left, s = this.rowBase(row + 1) + left;
        for (let i = 0; i < w; i++) r[d + i] = r[s + i];
      }
      const last = this.rowBase(bot - 1) + left;
      for (let i = 0; i < w; i++) r[last + i] = 0xA0;
    }

    lineFeed() {
      const r = this.ram;
      r[0x25]++;
      if (r[0x25] >= r[0x23]) { r[0x25]--; this.scroll(); }
      this.vtab(r[0x25]);
    }

    carriageReturn() { this.ram[0x24] = 0; this.lineFeed(); }

    cout1(ch) {
      const r = this.ram;
      if (ch < 0xA0) {
        switch (ch) {
          case 0x8D: this.carriageReturn(); break;
          case 0x8A: this.lineFeed(); break;
          case 0x88: if (r[0x24] > 0) r[0x24]--; else { r[0x24] = r[0x21] - 1; if (r[0x25] > r[0x22]) { r[0x25]--; this.vtab(r[0x25]); } } break;
          case 0x87: if (this.onBell) this.onBell(); break;
          default: break;
        }
        return;
      }
      const code = ch & r[0x32];
      const taddr = (r[0x29] << 8) + r[0x28] + r[0x24];
      r[taddr] = code;
      this.noteTextCell(taddr);
      r[0x24]++;
      if (r[0x24] >= r[0x21]) this.carriageReturn();
    }

    // The game draws its text into the hi-res bitmap through a machine-code hook. Remember what each
    // character cell looked like right after it was drawn, so the renderer can show text cells as
    // clean white glyphs instead of colour-fringed bitmap pixels.
    noteTextCell(taddr) {
      if (taddr < 0x400 || taddr >= 0x800) return;
      const off = taddr - 0x400;
      const base = 0x2000 + off;
      if (!this.textCells) this.textCells = new Map();
      const bytes = new Uint8Array(8);
      for (let k = 0; k < 8; k++) bytes[k] = this.ram[base + k * 0x400];
      // Solid colour fills (alternating-pixel patterns) are decoration, not text: keep their colour.
      let alt = 0;
      for (let k = 0; k < 8; k++) { const v = bytes[k] & 0x7F; if (v === 0x2A || v === 0x55) alt++; }
      if (alt >= 7) this.textCells.delete(base); else this.textCells.set(base, bytes);
    }

    home() {
      const r = this.ram, top = r[0x22], bot = r[0x23], left = r[0x20], w = r[0x21];
      for (let row = top; row < bot; row++) {
        const b = this.rowBase(row) + left;
        for (let i = 0; i < w; i++) r[b + i] = 0xA0;
      }
      r[0x24] = 0; r[0x25] = top; this.vtab(top);
    }

    clrEol() {
      const r = this.ram, row = r[0x25], left = r[0x20], w = r[0x21];
      const b = this.rowBase(row) + left;
      for (let i = r[0x24]; i < w; i++) r[b + i] = 0xA0;
    }

    clrEop() {
      const r = this.ram, bot = r[0x23], left = r[0x20], w = r[0x21];
      this.clrEol();
      for (let row = r[0x25] + 1; row < bot; row++) {
        const b = this.rowBase(row) + left;
        for (let i = 0; i < w; i++) r[b + i] = 0xA0;
      }
    }

    // Character output routed through the CSW hook, as the monitor's COUT does.
    cout(ch) {
      const csw = this.ram[0x36] | (this.ram[0x37] << 8);
      if (csw === 0xFDF0) this.cout1(ch);
      else this.callML(csw, ch);
    }
  }

  // ROM entry points emulated natively. Each returns true when it consumed the instruction.
  const ROM = {
    0xFDF0(c) { this.cout1(c.a); return this.rts(c); },
    0xFDED(c) { // COUT: jump through the CSW vector
      const csw = this.ram[0x36] | (this.ram[0x37] << 8);
      if (csw === 0xFDF0) { this.cout1(c.a); return this.rts(c); }
      c.pc = csw; return true;
    },
    0xFC58(c) { this.home(); return this.rts(c); },
    0xFC9C(c) { this.clrEol(); return this.rts(c); },
    0xFC42(c) { this.clrEop(); return this.rts(c); },
    0xFC62(c) { this.carriageReturn(); return this.rts(c); },
    0xFD8E(c) { this.cout(0x8D); return this.rts(c); },
    0xFC66(c) { this.lineFeed(); return this.rts(c); },
    0xFC70(c) { this.scroll(); return this.rts(c); },
    0xFC22(c) { this.vtab(this.ram[0x25]); return this.rts(c); },
    0xFC24(c) { this.vtab(c.a); return this.rts(c); },
    0xFBC1(c) { // BASCALC
      const b = this.rowBase(c.a); this.ram[0x28] = b & 0xFF; this.ram[0x29] = b >> 8; return this.rts(c);
    },
    0xFB39(c) { this.graphics = false; return this.rts(c); }, // SETTXT
    0xFB40(c) { this.graphics = true; this.hires = false; return this.rts(c); }, // SETGR
    0xFB2F(c) { // INIT
      const r = this.ram;
      this.graphics = false; this.page2 = false; this.hires = false;
      r[0x20] = 0; r[0x21] = 40; r[0x22] = 0; r[0x23] = 24; r[0x32] = 0xFF;
      this.vtab(23); return this.rts(c);
    },
    0xFE89(c) { this.ram[0x38] = 0x1B; this.ram[0x39] = 0xFD; return this.rts(c); }, // SETKBD
    0xFE93(c) { this.ram[0x36] = 0xF0; this.ram[0x37] = 0xFD; return this.rts(c); }, // SETVID
    0xFE84(c) { this.ram[0x32] = 0xFF; return this.rts(c); }, // SETNORM
    0xFE80(c) { this.ram[0x32] = 0x3F; return this.rts(c); }, // SETINV
    0xFD0C(c) { // RDKEY
      const csw = this.ram[0x38] | (this.ram[0x39] << 8);
      if (csw !== 0xFD1B) { c.pc = csw; return true; }
      return this.keyin(c);
    },
    0xFD1B(c) { return this.keyin(c); },
    0xFCA8(c) { return this.rts(c); }, // WAIT (timing is irrelevant here)
    0xFF3A(c) { if (this.onBell) this.onBell(); return this.rts(c); }, // BELL
    0xFBDD(c) { if (this.onBell) this.onBell(); return this.rts(c); }, // BELL1
    0xFDDA(c) { // PRBYTE
      const h = "0123456789ABCDEF";
      this.cout(h.charCodeAt(c.a >> 4) | 0x80); this.cout(h.charCodeAt(c.a & 15) | 0x80); return this.rts(c);
    },
    0xFDE3(c) { const h = "0123456789ABCDEF"; this.cout(h.charCodeAt(c.a & 15) | 0x80); return this.rts(c); }, // PRHEX
  };

  // RDKEY in the default state: take a key, or stall (re-execute) until one arrives.
  Machine.prototype.keyin = function (c) {
    const k = this.takeKey();
    if (k < 0) { this.wantYield = true; return true; }
    c.a = k | 0x80;
    return this.rts(c);
  };

  SS.Machine = Machine;
  SS.RET_SENTINEL = RET_SENTINEL;
})(typeof SS !== "undefined" ? SS : (globalThis.SS = globalThis.SS || {}));
