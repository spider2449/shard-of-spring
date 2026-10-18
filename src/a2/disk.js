// Disk II: image parsing (.dsk/.do/.po/.nib/.2mg), 6&2 nibblizing, and the controller card at $C0E0.
(function (A2) {
  "use strict";

  const TRACKS = 35, TRACK_LEN = 6656, SECTOR_BYTES = 256;
  const XLATE = [0x96, 0x97, 0x9A, 0x9B, 0x9D, 0x9E, 0x9F, 0xA6, 0xA7, 0xAB, 0xAC, 0xAD, 0xAE, 0xAF, 0xB2, 0xB3,
    0xB4, 0xB5, 0xB6, 0xB7, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xCB, 0xCD, 0xCE, 0xCF, 0xD3,
    0xD6, 0xD7, 0xD9, 0xDA, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xE5, 0xE6, 0xE7, 0xE9, 0xEA, 0xEB, 0xEC,
    0xED, 0xEE, 0xEF, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF];
  const UNX = new Uint8Array(256).fill(0xFF);
  XLATE.forEach((v, i) => { UNX[v] = i; });
  // Physical sector -> index of that sector inside the image file.
  const SKEW = {
    do: [0, 7, 14, 6, 13, 5, 12, 4, 11, 3, 10, 2, 9, 1, 8, 15],
    po: [0, 8, 1, 9, 2, 10, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15],
  };

  const swap2 = (b) => ((b & 1) << 1) | ((b >> 1) & 1);

  function put44(out, p, v) { out[p] = (v >> 1) | 0xAA; out[p + 1] = v | 0xAA; return p + 2; }
  function fill(out, p, n, v) { out.fill(v, p, p + n); return p + n; }

  function nibblizeSector(out, p, vol, trk, sec, d) {
    out[p++] = 0xD5; out[p++] = 0xAA; out[p++] = 0x96;
    p = put44(out, p, vol); p = put44(out, p, trk); p = put44(out, p, sec); p = put44(out, p, vol ^ trk ^ sec);
    out[p++] = 0xDE; out[p++] = 0xAA; out[p++] = 0xEB;
    p = fill(out, p, 6, 0xFF);
    out[p++] = 0xD5; out[p++] = 0xAA; out[p++] = 0xAD;
    const v = new Uint8Array(342);
    for (let i = 0; i < 86; i++) {
      let t = swap2(d[i]) | (swap2(d[i + 86]) << 2);
      if (i + 172 < 256) t |= swap2(d[i + 172]) << 4;
      v[i] = t;
    }
    for (let i = 0; i < 256; i++) v[86 + i] = d[i] >> 2;
    let last = 0;
    for (let i = 0; i < 342; i++) { out[p++] = XLATE[v[i] ^ last]; last = v[i]; }
    out[p++] = XLATE[last];
    out[p++] = 0xDE; out[p++] = 0xAA; out[p++] = 0xEB;
    return p;
  }

  // Build a standard 16-sector DOS 3.3 style track from 16 sector buffers (indexed by physical sector).
  function nibblizeTrack(sectors, trk, vol) {
    const out = new Uint8Array(TRACK_LEN);
    let p = fill(out, 0, 32, 0xFF);
    for (let s = 0; s < 16; s++) {
      p = nibblizeSector(out, p, vol, trk, s, sectors[s]);
      p = fill(out, p, 45, 0xFF);
    }
    out.fill(0xFF, p);
    return out;
  }

  // Locate and decode all sectors of a nibble track. Returns {sectors:[16 x Uint8Array|null], vol}.
  function decodeTrack(buf) {
    const n = buf.length, sectors = new Array(16).fill(null);
    let vol = 254;
    const at = (i) => buf[i % n];
    const dec44 = (i) => (((at(i) << 1) | 1) & at(i + 1));
    for (let i = 0; i < n; i++) {
      if (at(i) !== 0xD5 || at(i + 1) !== 0xAA || at(i + 2) !== 0x96) continue;
      const v = dec44(i + 3), t = dec44(i + 5), s = dec44(i + 7), c = dec44(i + 9);
      if ((v ^ t ^ s) !== c || s > 15) continue;
      let data = -1;
      for (let k = 0; k < 80; k++) {
        const q = i + 14 + k;
        if (at(q) === 0xD5 && at(q + 1) === 0xAA && at(q + 2) === 0xAD) { data = q + 3; break; }
        if (at(q) === 0xD5 && at(q + 1) === 0xAA && at(q + 2) === 0x96) break;
      }
      if (data < 0) continue;
      const w = new Uint8Array(342);
      let last = 0, ok = true;
      for (let k = 0; k < 342; k++) {
        const x = UNX[at(data + k)];
        if (x === 0xFF) { ok = false; break; }
        last ^= x; w[k] = last;
      }
      if (!ok || UNX[at(data + 342)] !== last) continue;
      const out = new Uint8Array(256);
      for (let k = 0; k < 256; k++) {
        const two = (w[k % 86] >> (k < 86 ? 0 : k < 172 ? 2 : 4)) & 3;
        out[k] = (w[86 + k] << 2) | swap2(two);
      }
      sectors[s] = out; vol = v;
    }
    return { sectors, vol };
  }

  function detectOrder(name, b) {
    if (/\.po$/i.test(name)) return "po";
    if (/\.do$/i.test(name)) return "do";
    // A ProDOS volume directory header sits in block 2; if it is found at the raw offset the file is block ordered.
    if (b.length >= 1032 && b[1024] === 0 && b[1025] === 0 && (b[1028] >> 4) === 0xF && b[1028] !== 0xF0) {
      const dosVtoc = b[17 * 4096 + 3];
      if (dosVtoc !== 3 && dosVtoc !== 2 && dosVtoc !== 1) return "po";
    }
    return "do";
  }

  class Disk {
    // data: Uint8Array holding the file contents.
    constructor(name, data) {
      this.name = name;
      this.writeProtected = false;
      this.dirty = false;
      let b = data, format;
      if (b.length >= 64 && b[0] === 0x32 && b[1] === 0x49 && b[2] === 0x4D && b[3] === 0x47) { // 2IMG container
        const fmt = b[12], off = b[24] | (b[25] << 8) | (b[26] << 16), len = b[28] | (b[29] << 8) | (b[30] << 16);
        b = b.subarray(off, off + len);
        format = fmt === 2 ? "nib" : fmt === 1 ? "po" : "do";
      } else if (b.length === TRACKS * TRACK_LEN) {
        format = "nib";
      } else if (b.length === TRACKS * 16 * SECTOR_BYTES) {
        format = detectOrder(name, b);
      } else {
        throw new Error(name + ": unsupported disk image size (" + b.length + " bytes)");
      }
      this.format = format;
      this.tracks = [];
      if (format === "nib") {
        for (let t = 0; t < TRACKS; t++) this.tracks.push(new Uint8Array(b.subarray(t * TRACK_LEN, (t + 1) * TRACK_LEN)));
      } else {
        const skew = SKEW[format];
        for (let t = 0; t < TRACKS; t++) {
          const secs = [];
          for (let s = 0; s < 16; s++) {
            const o = (t * 16 + skew[s]) * SECTOR_BYTES;
            secs.push(b.subarray(o, o + SECTOR_BYTES));
          }
          this.tracks.push(nibblizeTrack(secs, t, 254));
        }
      }
    }

    // Serialise back to an image file. Falls back to .nib when any sector cannot be decoded.
    toBytes() {
      if (this.format !== "nib") {
        const out = new Uint8Array(TRACKS * 16 * SECTOR_BYTES), skew = SKEW[this.format];
        let ok = true;
        for (let t = 0; t < TRACKS && ok; t++) {
          const { sectors } = decodeTrack(this.tracks[t]);
          for (let s = 0; s < 16; s++) {
            if (!sectors[s]) { ok = false; break; }
            out.set(sectors[s], (t * 16 + skew[s]) * SECTOR_BYTES);
          }
        }
        if (ok) return { bytes: out, format: this.format };
      }
      const nib = new Uint8Array(TRACKS * TRACK_LEN);
      for (let t = 0; t < TRACKS; t++) nib.set(this.tracks[t], t * TRACK_LEN);
      return { bytes: nib, format: "nib" };
    }

    // Decoded copy of one physical sector, or null.
    readSector(track, sector) {
      if (track >= TRACKS) return null;
      return decodeTrack(this.tracks[track]).sectors[sector];
    }
  }

  // ---------------------------------------------------------------- controller
  class DiskII {
    constructor(machine) {
      this.m = machine;
      this.drives = [{ disk: null, half: 0 }, { disk: null, half: 0 }];
      this.cur = 0;
      this.motor = false; this.spinUntil = 0; // platter keeps turning ~1s after a motor-off
      this.phases = 0;
      this.q6 = 0; this.q7 = 0;
      this.latch = 0;
      this.lastIdx = -1;
      this.writing = false; this.wpos = 0;
      this.noise = 0x1234567;
      this.lastActive = -1e9; // CPU cycle of the latest controller access
      this.onChange = null; // callback(kind) for UI: "motor", "track", "write"
    }

    insert(drive, disk) {
      this.drives[drive].disk = disk;
      if (this.onChange) this.onChange("disk");
    }

    isSpinning() { return this.motor || this.m.cpu.cycles < this.spinUntil; }

    // True while software is actively using the drive (used for the automatic fast-forward).
    isBusy() { return this.isSpinning() && this.m.cpu.cycles - this.lastActive < 300000; }

    track() { return this.drives[this.cur].half >> 1; }

    // Drive spin timing: one nibble every 32 CPU cycles.
    idx() { return Math.floor(this.m.cpu.cycles / 32) % TRACK_LEN; }

    access(reg, write, val) {
      const d = this.drives[this.cur];
      if (reg !== 8) this.lastActive = this.m.cpu.cycles;
      if (reg < 8) {
        const ph = reg >> 1;
        if (reg & 1) {
          this.phases |= 1 << ph;
          let dir = 0;
          if (this.phases & (1 << ((d.half + 1) & 3))) dir++;
          if (this.phases & (1 << ((d.half + 3) & 3))) dir--;
          const nh = Math.max(0, Math.min(2 * (TRACKS - 1) + 1, d.half + dir));
          if (nh !== d.half) { d.half = nh; if (this.onChange) this.onChange("track"); }
        } else {
          this.phases &= ~(1 << ph);
        }
        return 0;
      }
      switch (reg) {
        case 8: if (this.motor) { this.motor = false; this.spinUntil = this.m.cpu.cycles + 1000000; } break;
        case 9: if (!this.motor) { this.motor = true; if (this.onChange) this.onChange("motor"); } break;
        case 10: this.cur = 0; break;
        case 11: this.cur = 1; break;
        case 12: this.q6 = 0; break;
        case 13: this.q6 = 1; break;
        case 14: this.q7 = 0; this.writing = false; break;
        case 15: this.q7 = 1; break;
      }
      const dr = this.drives[this.cur];
      if (write && this.q6 && this.q7) { // data latch load while in write mode -> one nibble goes onto the track
        this.writeNibble(dr, val);
        return 0;
      }
      if (reg & 1) {
        // odd registers: Q6H / Q7H reads
        if (reg === 13 && !this.q7) return dr.disk && dr.disk.writeProtected ? 0x80 : 0x00;
        return 0;
      }
      if (reg === 12 && !this.q7) return this.readNibble(dr);
      return 0;
    }

    readNibble(dr) {
      if (!dr.disk || !this.isSpinning()) {
        // Empty drive or stopped motor: noise with the high bit set now and then.
        this.noise = (this.noise * 1103515245 + 12345) & 0x7FFFFFFF;
        return (this.noise >> 16) & 0xFF;
      }
      const i = this.idx();
      const t = dr.disk.tracks[dr.half >> 1];
      if (!t) return 0;
      if (i !== this.lastIdx) { this.lastIdx = i; this.latch = t[i]; return this.latch; }
      return this.latch & 0x7F;
    }

    writeNibble(dr, val) {
      if (!dr.disk || dr.disk.writeProtected) return;
      const t = dr.disk.tracks[dr.half >> 1];
      if (!t) return;
      if (!this.writing) { this.writing = true; this.wpos = this.idx(); }
      t[this.wpos] = val;
      this.wpos = (this.wpos + 1) % TRACK_LEN;
      this.lastIdx = this.wpos;
      dr.disk.dirty = true;
      if (this.onChange) this.onChange("write");
    }
  }

  A2.Disk = Disk;
  A2.DiskII = DiskII;
  A2.disk = { nibblizeTrack, decodeTrack, TRACKS, TRACK_LEN };
})(typeof A2 !== "undefined" ? A2 : (globalThis.A2 = globalThis.A2 || {}));
