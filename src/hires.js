// Hi-res graphics: Applesoft-style plotting into Apple II hi-res memory and a
// frame renderer that turns video memory into RGBA pixels.
(function (SS) {
  "use strict";

  function rowAddr(base, y) {
    return base + (y & 7) * 0x400 + ((y >> 3) & 7) * 0x80 + (y >> 6) * 0x28;
  }

  // Applesoft HCOLOR patterns for even/odd columns.
  const PAT = [[0x00, 0x00], [0x2A, 0x55], [0x55, 0x2A], [0x7F, 0x7F], [0x80, 0x80], [0xAA, 0xD5], [0xD5, 0xAA], [0xFF, 0xFF]];

  const Hires = {
    hgr(m, page) {
      const base = page === 2 ? 0x4000 : 0x2000;
      m.ram.fill(0, base, base + 0x2000);
      m.hgrBase = base;
      m.graphics = true; m.hires = true; m.mixed = page === 1; m.page2 = page === 2;
    },

    plot(m, x, y, color) {
      const base = m.hgrBase || 0x2000;
      const a = rowAddr(base, y) + Math.floor(x / 7);
      const bit = x % 7;
      const c = PAT[color & 7][x & 1];
      let v = m.ram[a];
      v = (v & ~(1 << bit)) | (c & (1 << bit));
      v = (v & 0x7F) | (c & 0x80);
      m.ram[a] = v;
    },

    line(m, x0, y0, x1, y1, color) {
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        Hires.plot(m, x0, y0, color);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    },
  };

  // ---------------------------------------------------------------- renderer
  // Output is 1120x768 (4x the 280x192 hi-res grid). Colours follow the classic artifact rules but are
  // computed per pixel without blur: a lone lit pixel is violet/green (blue/orange with the palette bit),
  // two lit neighbours are white, and a dark pixel between two lit ones takes their colour.
  const SCALE = 4, OUT_W = 280 * SCALE, OUT_H = 192 * SCALE;
  const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
  const PALETTE = [
    [[255, 68, 253], [20, 207, 64]],   // palette 0: even x violet, odd x green
    [[20, 108, 255], [255, 106, 60]],  // palette 1: even x blue, odd x orange
  ];

  // Text glyphs come from a 96-glyph 8x8 font table (ASCII $20-$7F, 8 bytes each).
  function glyphRow(font, ascii, row) {
    if (!font) return 0;
    const idx = ascii - 0x20;
    if (idx < 0 || idx >= 96) return 0;
    return font[idx * 8 + row] & 0x7F;
  }

  function fillRect(out, x, y, w, h, c) {
    for (let j = 0; j < h; j++) {
      let o = ((y + j) * OUT_W + x) * 4;
      for (let i = 0; i < w; i++, o += 4) { out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; }
    }
  }

  function renderHiresLine(m, out, y, base) {
    const a = rowAddr(base, y);
    const on = new Uint8Array(282), pal = new Uint8Array(282);
    for (let b = 0; b < 40; b++) {
      const v = m.ram[a + b];
      for (let k = 0; k < 7; k++) { const x = b * 7 + k + 1; on[x] = (v >> k) & 1; pal[x] = v >> 7; }
    }
    // Character cells drawn by the game's text routine and still untouched are shown as plain white glyphs.
    const cells = m.textCells;
    const textByte = new Uint8Array(40);
    if (cells) {
      const rowBase = rowAddr(base, y & ~7);
      for (let b = 0; b < 40; b++) {
        const bytes = cells.get(0x2000 + (rowBase - base) + b);
        if (!bytes) continue;
        let same = true;
        for (let k = 0; k < 8; k++) if (m.ram[rowAddr(base, (y & ~7) + k) + b] !== bytes[k]) { same = false; break; }
        if (same) textByte[b] = 1;
      }
    }
    const py = y * SCALE;
    for (let x = 0; x < 280; x++) {
      const bi = (x / 7) | 0;
      const p = on[x + 1];
      let c = BLACK;
      if (textByte[bi]) c = p ? WHITE : BLACK;
      else if (p) {
        c = (on[x] || on[x + 2]) ? WHITE : PALETTE[pal[x + 1]][x & 1];
      } else if (on[x] && on[x + 2]) {
        c = PALETTE[pal[x]][(x - 1) & 1];
      }
      if (c !== BLACK) fillRect(out, x * SCALE, py, SCALE, SCALE, c);
    }
  }

  // Render the current video state into an RGBA buffer of 1120x768 (cleared to black first).
  function render(m, out, font, flashOn) {
    out.fill(0);
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    const textRows = [];
    if (m.graphics && m.hires) {
      const base = m.page2 ? 0x4000 : 0x2000;
      const gfxRows = m.mixed ? 160 : 192;
      for (let y = 0; y < gfxRows; y++) renderHiresLine(m, out, y, base);
      if (m.mixed) for (let r = 20; r < 24; r++) textRows.push(r);
    } else {
      for (let r = 0; r < 24; r++) textRows.push(r);
    }
    for (const r of textRows) {
      const base = 0x400 + (m.page2 ? 0x400 : 0) + (r & 7) * 0x80 + (r >> 3) * 0x28;
      for (let col = 0; col < 40; col++) {
        const code = m.ram[base + col];
        let ascii, inv = false;
        if (code >= 0x80) ascii = code & 0x7F;
        else if (code >= 0x60) { ascii = code - 0x40; inv = !!flashOn; }
        else if (code >= 0x40) { ascii = code; inv = !!flashOn; }
        else { ascii = code < 0x20 ? code + 0x40 : code; inv = true; }
        if (ascii < 0x20) ascii += 0x40;
        for (let y = 0; y < 8; y++) {
          const bits = glyphRow(font, ascii, y);
          for (let x = 0; x < 7; x++) {
            let on = (bits >> x) & 1;
            if (inv) on ^= 1;
            if (on) fillRect(out, (col * 7 + x) * SCALE, (r * 8 + y) * SCALE, SCALE, SCALE, WHITE);
          }
        }
      }
    }
  }

  SS.Hires = Hires;
  SS.renderScreen = render;
  SS.SCREEN_W = OUT_W;
  SS.SCREEN_H = OUT_H;

})(typeof SS !== "undefined" ? SS : (globalThis.SS = globalThis.SS || {}));
