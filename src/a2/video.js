// Apple II video: 40/80 column text, lo-res, double lo-res, hi-res and double hi-res into a 560x384 RGBA frame.
(function (A2) {
  "use strict";

  const W = 560, H = 384;

  // Classic 5x7 glyphs, one byte per column (bit 0 = top row), ASCII $20-$7E.
  const FONT5X7 = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x5F, 0x00, 0x00, 0x00, 0x07, 0x00, 0x07, 0x00, 0x14, 0x7F, 0x14, 0x7F, 0x14,
    0x24, 0x2A, 0x7F, 0x2A, 0x12, 0x23, 0x13, 0x08, 0x64, 0x62, 0x36, 0x49, 0x56, 0x20, 0x50, 0x00, 0x05, 0x03, 0x00, 0x00,
    0x00, 0x1C, 0x22, 0x41, 0x00, 0x00, 0x41, 0x22, 0x1C, 0x00, 0x2A, 0x1C, 0x7F, 0x1C, 0x2A, 0x08, 0x08, 0x3E, 0x08, 0x08,
    0x00, 0x50, 0x30, 0x00, 0x00, 0x08, 0x08, 0x08, 0x08, 0x08, 0x00, 0x00, 0x60, 0x60, 0x00, 0x20, 0x10, 0x08, 0x04, 0x02,
    0x3E, 0x51, 0x49, 0x45, 0x3E, 0x00, 0x42, 0x7F, 0x40, 0x00, 0x72, 0x49, 0x49, 0x49, 0x46, 0x21, 0x41, 0x49, 0x4D, 0x33,
    0x18, 0x14, 0x12, 0x7F, 0x10, 0x27, 0x45, 0x45, 0x45, 0x39, 0x3C, 0x4A, 0x49, 0x49, 0x31, 0x41, 0x21, 0x11, 0x09, 0x07,
    0x36, 0x49, 0x49, 0x49, 0x36, 0x46, 0x49, 0x49, 0x29, 0x1E, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x40, 0x34, 0x00, 0x00,
    0x00, 0x08, 0x14, 0x22, 0x41, 0x14, 0x14, 0x14, 0x14, 0x14, 0x00, 0x41, 0x22, 0x14, 0x08, 0x02, 0x01, 0x59, 0x09, 0x06,
    0x3E, 0x41, 0x5D, 0x59, 0x4E, 0x7C, 0x12, 0x11, 0x12, 0x7C, 0x7F, 0x49, 0x49, 0x49, 0x36, 0x3E, 0x41, 0x41, 0x41, 0x22,
    0x7F, 0x41, 0x41, 0x41, 0x3E, 0x7F, 0x49, 0x49, 0x49, 0x41, 0x7F, 0x09, 0x09, 0x09, 0x01, 0x3E, 0x41, 0x41, 0x51, 0x73,
    0x7F, 0x08, 0x08, 0x08, 0x7F, 0x00, 0x41, 0x7F, 0x41, 0x00, 0x20, 0x40, 0x41, 0x3F, 0x01, 0x7F, 0x08, 0x14, 0x22, 0x41,
    0x7F, 0x40, 0x40, 0x40, 0x40, 0x7F, 0x02, 0x1C, 0x02, 0x7F, 0x7F, 0x04, 0x08, 0x10, 0x7F, 0x3E, 0x41, 0x41, 0x41, 0x3E,
    0x7F, 0x09, 0x09, 0x09, 0x06, 0x3E, 0x41, 0x51, 0x21, 0x5E, 0x7F, 0x09, 0x19, 0x29, 0x46, 0x26, 0x49, 0x49, 0x49, 0x32,
    0x03, 0x01, 0x7F, 0x01, 0x03, 0x3F, 0x40, 0x40, 0x40, 0x3F, 0x1F, 0x20, 0x40, 0x20, 0x1F, 0x3F, 0x40, 0x38, 0x40, 0x3F,
    0x63, 0x14, 0x08, 0x14, 0x63, 0x03, 0x04, 0x78, 0x04, 0x03, 0x61, 0x59, 0x49, 0x4D, 0x43, 0x00, 0x7F, 0x41, 0x41, 0x00,
    0x02, 0x04, 0x08, 0x10, 0x20, 0x00, 0x41, 0x41, 0x7F, 0x00, 0x04, 0x02, 0x01, 0x02, 0x04, 0x40, 0x40, 0x40, 0x40, 0x40,
    0x00, 0x03, 0x07, 0x08, 0x00, 0x20, 0x54, 0x54, 0x78, 0x40, 0x7F, 0x28, 0x44, 0x44, 0x38, 0x38, 0x44, 0x44, 0x44, 0x28,
    0x38, 0x44, 0x44, 0x28, 0x7F, 0x38, 0x54, 0x54, 0x54, 0x18, 0x00, 0x08, 0x7E, 0x09, 0x02, 0x18, 0xA4, 0xA4, 0x9C, 0x78,
    0x7F, 0x08, 0x04, 0x04, 0x78, 0x00, 0x44, 0x7D, 0x40, 0x00, 0x20, 0x40, 0x40, 0x3D, 0x00, 0x7F, 0x10, 0x28, 0x44, 0x00,
    0x00, 0x41, 0x7F, 0x40, 0x00, 0x7C, 0x04, 0x78, 0x04, 0x78, 0x7C, 0x08, 0x04, 0x04, 0x78, 0x38, 0x44, 0x44, 0x44, 0x38,
    0xFC, 0x18, 0x24, 0x24, 0x18, 0x18, 0x24, 0x24, 0x18, 0xFC, 0x7C, 0x08, 0x04, 0x04, 0x08, 0x48, 0x54, 0x54, 0x54, 0x24,
    0x04, 0x04, 0x3F, 0x44, 0x24, 0x3C, 0x40, 0x40, 0x20, 0x7C, 0x1C, 0x20, 0x40, 0x20, 0x1C, 0x3C, 0x40, 0x30, 0x40, 0x3C,
    0x44, 0x28, 0x10, 0x28, 0x44, 0x4C, 0x90, 0x90, 0x90, 0x7C, 0x44, 0x64, 0x54, 0x4C, 0x44, 0x00, 0x08, 0x36, 0x41, 0x00,
    0x00, 0x00, 0x77, 0x00, 0x00, 0x00, 0x41, 0x36, 0x08, 0x00, 0x02, 0x01, 0x02, 0x04, 0x02,
  ];

  // GLYPH[ascii] = 8 row bytes, 7 pixels wide (bit 0 = leftmost pixel), for ascii $20-$7E; ascii $7F is a block.
  const GLYPH = [];
  for (let a = 0; a < 128; a++) {
    const rows = new Uint8Array(8);
    if (a >= 0x20 && a <= 0x7E) {
      for (let c = 0; c < 5; c++) {
        const col = FONT5X7[(a - 0x20) * 5 + c];
        for (let r = 0; r < 8; r++) if (col & (1 << r)) rows[r] |= 1 << (c + 1);
      }
    } else if (a === 0x7F) {
      rows.fill(0x7F);
    }
    GLYPH.push(rows);
  }

  const abgr = (r, g, b) => (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
  const LORES = [[0, 0, 0], [227, 30, 96], [96, 78, 189], [255, 68, 253], [0, 163, 96], [156, 156, 156], [20, 207, 253], [208, 195, 255],
    [96, 114, 3], [255, 106, 60], [156, 156, 156], [255, 160, 208], [20, 245, 60], [208, 221, 141], [114, 255, 208], [255, 255, 255]]
    .map((c) => abgr(c[0], c[1], c[2]));
  const HIRES_PAL = [[abgr(255, 68, 253), abgr(20, 245, 60)], [abgr(20, 207, 253), abgr(255, 106, 60)]];
  const WHITE = abgr(255, 255, 255), BLACK = abgr(0, 0, 0);
  const PHOSPHOR = { color: WHITE, white: WHITE, green: abgr(60, 255, 90), amber: abgr(255, 176, 0) };

  function rowAddr(base, y) { return base + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28; }
  function textAddr(base, r) { return base + (r & 7) * 0x80 + (r >> 3) * 0x28; }

  class Renderer {
    constructor() {
      this.mode = "color"; // color | white | green | amber
      this.hgr = "sharp"; // sharp: per-pixel colour rules | ntsc: composite artifact colours
    }

    // Which glyph rows to draw for a text byte; returns {rows, invert}.
    charFor(m, code, flash) {
      let ascii, inv = false;
      if (m.altchar && m.iie) {
        if (code < 0x40) { ascii = code < 0x20 ? code + 0x40 : code; inv = true; }
        else if (code < 0x60) { ascii = 0x7F; } // MouseText: drawn as a block placeholder
        else if (code < 0x80) { ascii = code; inv = true; }
        else { ascii = code & 0x7F; if (ascii < 0x20) ascii += 0x40; }
      } else {
        const hi = code >> 6;
        if (hi === 3 && m.iie && code >= 0xE0) { ascii = code & 0x7F; }
        else { const i = code & 0x3F; ascii = i < 0x20 ? i + 0x40 : i; }
        if (hi === 0) inv = true; else if (hi === 1) inv = flash;
      }
      return { rows: GLYPH[ascii], inv };
    }

    render(m, px, flash) {
      const fg = this.mode === "color" ? WHITE : PHOSPHOR[this.mode];
      const mono = this.mode !== "color";
      const main = m.mem, AUX = A2.MEM.AUX;
      const text = m.text;
      const gfxRows = text ? 0 : (m.mixed ? 160 : 192);
      const page2 = m.page2 && !m.store80;
      const col80 = m.iie && m.col80;
      const dbl = m.iie && m.col80 && m.dhires;

      px.fill(BLACK);
      if (gfxRows) {
        if (m.hires) {
          const base = page2 ? 0x4000 : 0x2000;
          for (let y = 0; y < gfxRows; y++) {
            if (dbl) this.dhgrLine(m, px, y, base, fg, mono); else this.hgrLine(m, px, y, base, fg, mono);
          }
        } else {
          this.loresBlocks(m, px, gfxRows >> 3, page2, dbl, fg, mono);
        }
      }
      const textFrom = text ? 0 : (m.mixed ? 20 : 24);
      const tbase = page2 ? 0x800 : 0x400;
      for (let r = textFrom; r < 24; r++) {
        const a = textAddr(tbase, r);
        if (col80) {
          for (let c = 0; c < 80; c++) {
            const code = (c & 1) ? main[a + (c >> 1)] : main[AUX + a + (c >> 1)];
            this.drawChar(m, px, c * 7, r * 16, code, flash, fg, 1);
          }
        } else {
          for (let c = 0; c < 40; c++) this.drawChar(m, px, c * 14, r * 16, main[a + c], flash, fg, 2);
        }
      }
    }

    drawChar(m, px, x0, y0, code, flash, fg, sx) {
      const { rows, inv } = this.charFor(m, code, flash);
      for (let r = 0; r < 8; r++) {
        let bits = rows[r];
        if (inv) bits ^= 0x7F;
        if (!bits) continue;
        const o0 = (y0 + r * 2) * W + x0;
        for (let c = 0; c < 7; c++) {
          if (!(bits & (1 << c))) continue;
          const o = o0 + c * sx;
          for (let k = 0; k < sx; k++) { px[o + k] = fg; px[o + W + k] = fg; }
        }
      }
    }

    loresBlocks(m, px, textRows, page2, dbl, fg, mono) {
      const main = m.mem, AUX = A2.MEM.AUX;
      const tbase = page2 ? 0x800 : 0x400;
      for (let r = 0; r < textRows; r++) {
        const a = textAddr(tbase, r);
        const cols = dbl ? 80 : 40, bw = dbl ? 7 : 14;
        for (let c = 0; c < cols; c++) {
          let v = dbl ? ((c & 1) ? main[a + (c >> 1)] : main[AUX + a + (c >> 1)]) : main[a + c];
          for (let half = 0; half < 2; half++) {
            let n = half ? v >> 4 : v & 15;
            if (dbl && !(c & 1)) n = ((n << 1) | (n >> 3)) & 15; // aux nibbles are rotated
            const col = mono ? (n ? fg : BLACK) : LORES[n];
            const y0 = r * 16 + half * 8;
            for (let y = 0; y < 8; y++) {
              const o = (y0 + y) * W + c * bw;
              for (let k = 0; k < bw; k++) px[o + k] = col;
            }
          }
        }
      }
    }

    // NTSC artifact colours: hi-res bits become a 560 sample stream (a set palette bit delays the byte by half a
    // pixel) and each sample takes the colour of the 4 sample chroma cycle around it.
    hgrNtsc(m, px, y, base) {
      const a = rowAddr(base, y), mem = m.mem;
      const s = new Uint8Array(566);
      for (let b = 0; b < 40; b++) {
        const v = mem[a + b], shift = v >> 7;
        for (let k = 0; k < 7; k++) {
          if (!((v >> k) & 1)) continue;
          const i = 3 + (b * 7 + k) * 2 + shift;
          s[i] = 1; s[i + 1] = 1;
        }
      }
      const o0 = y * 2 * W;
      for (let x = 0; x < 560; x++) {
        let n = 0;
        for (let j = x - 1; j <= x + 2; j++) if (s[j + 3]) n |= 1 << ((j + 4) & 3);
        if (!n) continue;
        const c = LORES[n];
        px[o0 + x] = c; px[o0 + W + x] = c;
      }
    }

    hgrLine(m, px, y, base, fg, mono) {
      if (!mono && this.hgr === "ntsc") { this.hgrNtsc(m, px, y, base); return; }
      const a = rowAddr(base, y), mem = m.mem;
      const on = new Uint8Array(282), pal = new Uint8Array(282);
      for (let b = 0; b < 40; b++) {
        const v = mem[a + b];
        for (let k = 0; k < 7; k++) { const x = b * 7 + k + 1; on[x] = (v >> k) & 1; pal[x] = v >> 7; }
      }
      const o0 = y * 2 * W;
      for (let x = 0; x < 280; x++) {
        let c = BLACK;
        if (on[x + 1]) c = mono ? fg : ((on[x] || on[x + 2]) ? WHITE : HIRES_PAL[pal[x + 1]][x & 1]);
        else if (!mono && on[x] && on[x + 2]) c = HIRES_PAL[pal[x]][(x - 1) & 1];
        if (c === BLACK) continue;
        const o = o0 + x * 2;
        px[o] = c; px[o + 1] = c; px[o + W] = c; px[o + W + 1] = c;
      }
    }

    dhgrLine(m, px, y, base, fg, mono) {
      const a = rowAddr(base, y), mem = m.mem, AUX = A2.MEM.AUX;
      const bits = new Uint8Array(560);
      for (let b = 0; b < 40; b++) {
        const au = mem[AUX + a + b], mn = mem[a + b];
        for (let k = 0; k < 7; k++) { bits[b * 14 + k] = (au >> k) & 1; bits[b * 14 + 7 + k] = (mn >> k) & 1; }
      }
      const o0 = y * 2 * W;
      for (let x = 0; x < 560; x += 4) {
        const n = bits[x] | (bits[x + 1] << 1) | (bits[x + 2] << 2) | (bits[x + 3] << 3);
        if (!n) continue;
        const c = mono ? fg : LORES[n];
        for (let k = 0; k < 4; k++) { px[o0 + x + k] = c; px[o0 + W + x + k] = c; }
      }
    }
  }

  A2.Renderer = Renderer;
  A2.SCREEN_W = W;
  A2.SCREEN_H = H;
  A2.GLYPH = GLYPH;
})(typeof A2 !== "undefined" ? A2 : (globalThis.A2 = globalThis.A2 || {}));
