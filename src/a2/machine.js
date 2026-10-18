// Apple II / II+ / IIe / enhanced IIe: memory map, soft switches, keyboard, speaker, game I/O and slot 6 (Disk II).
(function (A2) {
  "use strict";

  const MAIN = 0, AUX = 0x10000, LC2_MAIN = 0x20000, LC2_AUX = 0x21000, ROMBASE = 0x22000, MEM_SIZE = ROMBASE + 0x4000;
  const CYCLES_PER_FRAME = 17030, VBL_START = 12480;
  const IO = -1;

  // Identify the machine from the size and content of a system ROM image. Bigger dumps carry extra banks; the
  // firmware is the part that ends at $FFFF (the last 16 KB for a //e, the last 12 KB for a ][ / ][+).
  function identifyRom(rom) {
    const isIIe = (r) => r[0x3BB3] === 0x06; // $FBB3 holds the machine ID byte: $06 on the //e
    const model16 = (r) => ({ rom: r, model: r[0x3BC0] === 0xE0 ? "enhanced" : "iie" }); // $FBC0: $E0 = 65C02 ROM
    const n = rom.length;
    if (n === 12288) return { rom, model: "plus" };
    if (n === 16384) return model16(rom);
    if (n > 12288 && n % 4096 === 0) {
      if (n >= 16384) {
        const tail = rom.subarray(n - 16384);
        if (isIIe(tail)) return model16(tail);
        const head = rom.subarray(0, 16384);
        if (isIIe(head)) return model16(head);
      }
      return { rom: rom.subarray(n - 12288), model: "plus" };
    }
    throw new Error("Unrecognised Apple II ROM size: " + n + " bytes (expected 12288 for II/II+, 16384 for IIe)");
  }

  class Apple2 {
    // opts: { rom: Uint8Array, diskRom?: Uint8Array (256 bytes, optional real Disk II P5A ROM) }
    constructor(opts) {
      const id = identifyRom(opts.rom);
      this.model = id.model;
      this.iie = id.model !== "plus";
      this.mem = new Uint8Array(MEM_SIZE);
      if (this.iie) this.mem.set(id.rom, ROMBASE);
      else this.mem.set(id.rom, ROMBASE + 0x4000 - id.rom.length);
      this.cpu = new A2.CPU(this, id.model === "enhanced");
      this.disk = new A2.DiskII(this);
      this.diskRom = new Uint8Array(256);
      this.hleDisk = !(opts.diskRom && opts.diskRom.length === 256);
      if (this.hleDisk) this.buildDiskRom(); else this.diskRom.set(opts.diskRom);
      this.rdOff = new Int32Array(256);
      this.wrOff = new Int32Array(256);
      this.spk = [];
      this.spkEnabled = true;
      this.keyQueue = [];
      this.buttons = [false, false, false];
      this.paddles = [128, 128, 128, 128];
      this.paddleTrig = 0;
      this.joystickX = null; // optional override for paddle values while a key joystick is active
      this.cpu.hooks = new Array(256);
      if (this.hleDisk) this.cpu.hooks[0xC6] = (cpu) => this.diskHook(cpu);
      this.powerOn();
    }

    // ------------------------------------------------------------ power / reset
    powerOn() {
      this.mem.fill(0, 0, ROMBASE);
      this.key = 0; this.strobe = false; this.keyQueue.length = 0; this.anyKeyDown = false;
      this.resetSwitches();
      this.lcBank2 = true; this.lcRead = false; this.lcWrite = false; this.lcPre = false;
      this.remap();
      this.cpu.cycles = 0;
      this.cpu.reset();
    }

    resetSwitches() {
      this.text = true; this.mixed = false; this.page2 = false; this.hires = false;
      this.store80 = false; this.ramrd = false; this.ramwrt = false; this.altzp = false;
      this.intcxrom = false; this.slotc3rom = false; this.intc8rom = false;
      this.col80 = false; this.altchar = false; this.dhires = false; this.an = [false, false, false, false];
    }

    reset() { // Ctrl-Reset
      if (this.iie) {
        this.resetSwitches();
        this.lcBank2 = true; this.lcRead = false; this.lcWrite = false; this.lcPre = false;
        this.remap();
      }
      this.cpu.reset();
    }

    // ------------------------------------------------------------ memory map
    remap() {
      const rd = this.rdOff, wr = this.wrOff;
      for (let p = 0; p < 0xC0; p++) {
        let ar = this.ramrd, aw = this.ramwrt;
        if (p < 2) ar = aw = this.altzp;
        else if (this.store80 && ((p >= 4 && p < 8) || (this.hires && p >= 0x20 && p < 0x40))) ar = aw = this.page2;
        rd[p] = ar ? AUX : MAIN;
        wr[p] = aw ? AUX : MAIN;
      }
      rd[0xC0] = wr[0xC0] = IO;
      for (let p = 0xC1; p < 0xD0; p++) rd[p] = wr[p] = IO;
      const aux = this.altzp, ramBase = aux ? AUX : MAIN;
      for (let p = 0xD0; p < 0x100; p++) {
        const bank2Off = (aux ? LC2_AUX : LC2_MAIN) - 0xD000;
        if (this.lcRead) rd[p] = p < 0xE0 ? (this.lcBank2 ? bank2Off : ramBase) : ramBase;
        else rd[p] = ROMBASE - 0xC000;
        if (this.lcWrite) wr[p] = p < 0xE0 ? (this.lcBank2 ? bank2Off : ramBase) : ramBase;
        else wr[p] = IO; // ROM: writes are ignored by ioWrite
      }
    }

    read(addr) {
      const o = this.rdOff[addr >> 8];
      return o >= 0 ? this.mem[addr + o] : this.ioRead(addr);
    }

    write(addr, v) {
      const o = this.wrOff[addr >> 8];
      if (o !== IO) this.mem[addr + o] = v; else this.ioWrite(addr, v);
    }

    // ------------------------------------------------------------ I/O space
    ioRead(addr) {
      if (addr < 0xC100) return this.softSwitch(addr, false, 0);
      if (addr >= 0xD000) return 0; // never reached: ROM pages use rdOff
      if (addr >= 0xC800) {
        if (addr === 0xCFFF) this.intc8rom = false;
        if (this.iie && (this.intcxrom || this.intc8rom)) return this.mem[ROMBASE + addr - 0xC000];
        return 0;
      }
      const slot = (addr >> 8) & 7;
      if (this.iie) {
        if (this.intcxrom) return this.mem[ROMBASE + addr - 0xC000];
        if (slot === 3 && !this.slotc3rom) { this.intc8rom = true; return this.mem[ROMBASE + addr - 0xC000]; }
      }
      if (slot === 6) return this.diskRom[addr & 0xFF];
      return 0;
    }

    ioWrite(addr, v) {
      if (addr < 0xC100) this.softSwitch(addr, true, v);
      // ROM and empty slots ignore writes
    }

    pressKey(code) {
      this.keyQueue.push(code & 0x7F);
      if (!this.strobe) this.nextKey();
    }
    nextKey() {
      if (this.keyQueue.length) { this.key = this.keyQueue.shift(); this.strobe = true; }
    }

    vbl() { return (this.cpu.cycles % CYCLES_PER_FRAME) >= VBL_START; }

    softSwitch(addr, write, val) {
      const lo = addr & 0xFF, cpu = this.cpu;
      if (lo < 0x80) {
        switch (lo >> 4) {
          case 0x0:
            if (write && this.iie) {
              const on = lo & 1;
              switch (lo >> 1) {
                case 0: this.store80 = !!on; break;
                case 1: this.ramrd = !!on; break;
                case 2: this.ramwrt = !!on; break;
                case 3: this.intcxrom = !!on; break;
                case 4: this.altzp = !!on; break;
                case 5: this.slotc3rom = !!on; break;
                case 6: this.col80 = !!on; break;
                case 7: this.altchar = !!on; break;
              }
              this.remap();
              return 0;
            }
            return (this.key & 0x7F) | (this.strobe ? 0x80 : 0);
          case 0x1: {
            if (lo === 0x10) {
              const r = (this.key & 0x7F) | (this.anyKeyDown ? 0x80 : 0);
              this.strobe = false;
              this.nextKey();
              return r;
            }
            if (!this.iie || write) return (this.key & 0x7F);
            let s = false;
            switch (lo) {
              case 0x11: s = this.lcBank2; break;
              case 0x12: s = this.lcRead; break;
              case 0x13: s = this.ramrd; break;
              case 0x14: s = this.ramwrt; break;
              case 0x15: s = this.intcxrom; break;
              case 0x16: s = this.altzp; break;
              case 0x17: s = this.slotc3rom; break;
              case 0x18: s = this.store80; break;
              case 0x19: s = !this.vbl(); break;
              case 0x1A: s = this.text; break;
              case 0x1B: s = this.mixed; break;
              case 0x1C: s = this.page2; break;
              case 0x1D: s = this.hires; break;
              case 0x1E: s = this.altchar; break;
              case 0x1F: s = this.col80; break;
            }
            return (this.key & 0x7F) | (s ? 0x80 : 0);
          }
          case 0x3:
            if (lo === 0x30 && this.spkEnabled && this.spk.length < 200000) this.spk.push(cpu.cycles);
            return 0;
          case 0x5: {
            const on = !!(lo & 1);
            let remapNeeded = false;
            switch (lo >> 1) {
              case 0x28: this.text = on; break; // C050 graphics / C051 text
              case 0x29: this.mixed = on; break;
              case 0x2A: this.page2 = on; remapNeeded = this.store80; break;
              case 0x2B: this.hires = on; remapNeeded = this.store80; break;
              case 0x2C: this.an[0] = on; break;
              case 0x2D: this.an[1] = on; break;
              case 0x2E: this.an[2] = on; break;
              case 0x2F: this.an[3] = on; if (this.iie) this.dhires = !on; break;
            }
            if (remapNeeded) this.remap();
            return 0;
          }
          case 0x6: {
            const i = lo & 7;
            if (i === 0) return 0;
            if (i <= 3) return this.buttons[i - 1] ? 0x80 : 0;
            const pdl = this.paddles[i - 4];
            const t = cpu.cycles - this.paddleTrig;
            return t < pdl * 11 + 8 ? 0x80 : 0;
          }
          case 0x7:
            if (lo === 0x70) this.paddleTrig = cpu.cycles;
            return 0;
          default: return 0;
        }
      }
      if (lo < 0x90) { this.langCard(lo & 0x0F, write); return 0; }
      const slot = (lo >> 4) - 8;
      if (slot === 6) return this.disk.access(lo & 0x0F, write, val);
      return 0;
    }

    langCard(reg, write) {
      this.lcBank2 = !(reg & 8);
      const op = reg & 3;
      this.lcRead = op === 0 || op === 3;
      if (reg & 1) {
        if (!write) { if (this.lcPre) this.lcWrite = true; this.lcPre = true; } else this.lcPre = false;
      } else {
        this.lcWrite = false; this.lcPre = false;
      }
      this.remap();
    }

    // ------------------------------------------------------------ slot 6 boot ROM
    // A tiny stand-in for the Disk II boot PROM: it carries the signature bytes the monitor looks for and
    // hooks two entry points (boot at $C608, read-sector at $C65C), serviced by diskHook() below.
    buildDiskRom() {
      const r = this.diskRom;
      r.fill(0x60);
      r.set([0xA2, 0x20, 0xA0, 0x00, 0xA2, 0x03, 0x86, 0x3C], 0); // LDX #$20 / LDY #$00 / LDX #$03 / STX $3C
      r[8] = 0xEA; // $C608: boot trap
      r[0x5C] = 0x60; // $C65C: read-sector trap (RTS)
      r[0xFF] = 0x00; // 16-sector controller
    }

    diskHook(cpu) {
      if (this.intcxrom) return false;
      const m = this.mem;
      if (cpu.pc === 0xC608) { // boot: load track 0 sector 0 to $0800, jump to $0801
        const dr = this.disk.drives[0];
        dr.half = 0;
        this.disk.cur = 0;
        this.disk.motor = true;
        const sec = dr.disk && dr.disk.readSector(0, 0);
        if (!sec) { this.bootFailed = true; cpu.cycles += 100; return true; } // no disk: keep spinning here until one is inserted
        this.bootFailed = false;
        m.set(sec, 0x0800);
        this.zp(0x2B, 0x60); this.zp(0x26, 0x00); this.zp(0x27, 0x09); this.zp(0x3D, 0x00); this.zp(0x41, 0x00);
        cpu.x = 0x60; cpu.a = 0; cpu.pc = 0x0801;
        cpu.cycles += 200000;
        return true;
      }
      if (cpu.pc === 0xC65C) { // read sector: $41 track, $3D sector, $26/$27 destination, then JMP $0801
        const dr = this.disk.drives[this.disk.cur];
        const track = m[0x41], sector = m[0x3D];
        dr.half = track * 2;
        const sec = dr.disk && dr.disk.readSector(track, sector);
        if (sec) {
          const dst = m[0x26] | (m[0x27] << 8);
          for (let i = 0; i < 256; i++) this.write((dst + i) & 0xFFFF, sec[i]);
          cpu.p &= ~1;
        } else {
          cpu.p |= 1;
        }
        // Like the real PROM, finish by re-entering the boot sector at $0801 (DOS 3.3's boot code relies on this;
        // cracked loaders patch $0801 to an RTS to get a plain subroutine).
        cpu.cycles += 20000;
        m[0x27] = (m[0x27] + 1) & 0xFF;
        cpu.pc = 0x0801;
        return true;
      }
      return false;
    }

    zp(a, v) { this.mem[a] = v; }
    pullByte(cpu) { cpu.sp = (cpu.sp + 1) & 0xFF; return this.mem[0x100 + cpu.sp]; }

    // ------------------------------------------------------------ run
    // Run the CPU until at least `cycles` more cycles have elapsed.
    run(cycles) {
      const cpu = this.cpu, end = cpu.cycles + cycles;
      while (cpu.cycles < end) cpu.step();
    }
  }

  A2.Apple2 = Apple2;
  A2.identifyRom = identifyRom;
  A2.CYCLES_PER_FRAME = CYCLES_PER_FRAME;
  A2.MEM = { MAIN, AUX, ROMBASE };
})(typeof A2 !== "undefined" ? A2 : (globalThis.A2 = globalThis.A2 || {}));
