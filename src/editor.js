// Party editor: change gold, time, character stats, skills and inventory, either in the running game's
// memory or in the saved character / party files. The data layout comes from the game's own programs
// (CAMP and TOWN): a character is a 200 byte record, five of them live at $0800 + n * 256 and the
// party record (gold, date) at $0D00.
(function (SS) {
  "use strict";

  const CHAR_BASE = 2048, CHAR_STRIDE = 256, CHAR_MAX = 5, CHAR_LEN = 200;
  const PARTY_BASE = 3328;
  const NO_ITEM = 255;

  const RACES = ["Human", "Dwarf", "Troll", "Elf", "Gnome"];
  const CLASSES = ["Fighter", "Wizard"];
  const STATUS = ["Healthy", "Poisoned", "Bound in chains", "Frozen in still air", "Frozen in ice", "Dead"];
  const STATS = ["Speed", "Strength", "Intellect", "Endurance", "Skill"];
  const MONTHS = ["Spirit", "Dragon", "Rose", "Sword", "Unicorn", "Metal", "Lotus", "Axe", "Panther", "Ice", "Mandrake",
    "Aurora", "Onyx", "Phoenix", "Wind", "Jade", "Fire", "Hyacinth", "Ruby", "Ebony", "Gold", "Comet"];

  // Offsets inside a character record.
  const C = { name: 0, nameLen: 10, race: 10, cls: 11, stat: 12, maxHp: 17, hp: 18, maxSp: 19, sp: 20,
    weapon: 21, armor: 22, status: 23, level: 24, skill: 25, skillCount: 13, exp: 38, item: 41, itemCount: 10,
    ident: 51 };
  // Offsets inside the party record (the game reads gold at 3338, month 3343, day 3344, hour 3345).
  const P = { gold: 10, month: 15, day: 16, hour: 17 };

  // Split a game data file (lines ended by CR) into strings.
  function parseLines(bytes) {
    const out = [];
    let cur = "";
    for (const b of bytes) {
      if (b === 0x8D || b === 0x0D || b === 0) { out.push(cur); cur = ""; } else cur += String.fromCharCode(b & 0x7F);
    }
    return out;
  }

  // Item names: six lines per item (name, unidentified name, price and three numbers).
  function parseItems(bytes) {
    const lines = parseLines(bytes), items = [];
    for (let i = 0; i + 5 < lines.length && lines[i]; i += 6) items.push(lines[i]);
    return items;
  }

  // Skill names: four lines per skill (fighter name, cost, wizard name, cost).
  function parseSkills(bytes) {
    const lines = parseLines(bytes), out = [];
    for (let i = 0; i + 3 < lines.length && lines[i] && lines[i + 2] && isNaN(+lines[i]); i += 4) out.push([lines[i], lines[i + 2]]);
    return out;
  }

  const get = (buf, off, len = 1) => { let v = 0; for (let i = len - 1; i >= 0; i--) v = v * 256 + buf[off + i]; return v; };
  const put = (buf, off, len, v) => { v = Math.max(0, Math.min(Math.pow(256, len) - 1, Math.floor(+v) || 0)); for (let i = 0; i < len; i++) { buf[off + i] = v % 256; v = Math.floor(v / 256); } };

  // Plain object view of a character record.
  function readChar(buf) {
    let name = "";
    for (let i = 0; i < C.nameLen; i++) name += String.fromCharCode(buf[C.name + i] & 0x7F);
    const ch = {
      name: name.trim(), race: buf[C.race], cls: buf[C.cls], level: buf[C.level], status: buf[C.status],
      hp: buf[C.hp], maxHp: buf[C.maxHp], sp: buf[C.sp], maxSp: buf[C.maxSp], exp: get(buf, C.exp, 3),
      weapon: buf[C.weapon], armor: buf[C.armor], stats: [], skills: [], items: [], ident: [],
    };
    for (let i = 0; i < STATS.length; i++) ch.stats.push(buf[C.stat + i]);
    for (let i = 0; i < C.skillCount; i++) ch.skills.push(buf[C.skill + i]);
    for (let i = 0; i < C.itemCount; i++) { ch.items.push(buf[C.item + i]); ch.ident.push(buf[C.ident + i]); }
    return ch;
  }

  function writeChar(buf, ch) {
    buf[C.race] = ch.race; buf[C.cls] = ch.cls;
    put(buf, C.level, 1, ch.level); put(buf, C.status, 1, ch.status);
    put(buf, C.hp, 1, ch.hp); put(buf, C.maxHp, 1, ch.maxHp); put(buf, C.sp, 1, ch.sp); put(buf, C.maxSp, 1, ch.maxSp);
    put(buf, C.exp, 3, ch.exp);
    put(buf, C.weapon, 1, ch.weapon); put(buf, C.armor, 1, ch.armor);
    ch.stats.forEach((v, i) => put(buf, C.stat + i, 1, v));
    ch.skills.forEach((v, i) => put(buf, C.skill + i, 1, v));
    ch.items.forEach((v, i) => { put(buf, C.item + i, 1, v); put(buf, C.ident + i, 1, ch.ident[i]); });
  }

  function readParty(buf) {
    return { gold: get(buf, P.gold, 3), month: buf[P.month], day: buf[P.day], hour: buf[P.hour] };
  }
  function writeParty(buf, p) {
    put(buf, P.gold, 3, p.gold); put(buf, P.month, 1, p.month); put(buf, P.day, 1, p.day); put(buf, P.hour, 1, p.hour);
  }

  // A character that was just healed: full points, no ailment.
  function healed(ch) { return Object.assign({}, ch, { hp: ch.maxHp, sp: ch.maxSp, status: 0 }); }

  // ------------------------------------------------------------------ data sources
  // A source hides where the bytes live. Each exposes party() / chars() and the matching setters.
  function liveSource(game) {
    const ram = game.m.ram;
    const chars = [];
    for (let n = 0; n < CHAR_MAX; n++) {
      if (ram[CHAR_BASE + n * CHAR_STRIDE] !== 0) chars.push({ label: charName(ram.subarray(CHAR_BASE + n * CHAR_STRIDE)), n });
    }
    return {
      note: chars.length ? "Edits the running game. Reopen a menu in the game to see them on screen." : "No party is loaded yet; load one in the game first.",
      chars,
      party: chars.length ? () => readParty(ram.subarray(PARTY_BASE)) : null,
      readChar: (i) => readChar(ram.subarray(CHAR_BASE + chars[i].n * CHAR_STRIDE)),
      writeChar: (i, ch) => writeChar(ram.subarray(CHAR_BASE + chars[i].n * CHAR_STRIDE), ch),
      writeParty(p) {
        writeParty(ram.subarray(PARTY_BASE), p);
        // The town shop keeps the gold in a BASIC variable and writes it back when it is left.
        const it = game.interp;
        if (it.prog && it.prog.name === "TOWN" && it.vars.has("G")) it.vars.set("G", p.gold);
      },
    };
  }

  function charName(buf) {
    let s = "";
    for (let i = 0; i < C.nameLen; i++) s += String.fromCharCode(buf[i] & 0x7F);
    return s.trim();
  }

  function savedFiles(dos) {
    const names = new Set();
    for (let d = 0; d < 2; d++) {
      for (const n of dos.catalogs[d].keys()) names.add(n);
      for (const [n, f] of dos.overlay[d]) if (f) names.add(n);
    }
    const found = [...names].filter((n) => /\.CHAR$/.test(n) || /^PARTY\d+$/.test(n)).filter((n) => dos.find(n)).sort();
    dos.cur = 0;
    return found;
  }

  function fileSource(dos, name) {
    const f = dos.find(name);
    dos.cur = 0;
    const isChar = /\.CHAR$/.test(name);
    const buf = Uint8Array.from(f.raw || f.data);
    const save = () => dos.putFile(1, name, f.type, f.load, buf.subarray(0, Math.max(f.data.length, isChar ? CHAR_LEN : 13)));
    return {
      note: "Edits the saved file; it takes effect the next time the party is loaded. A party loaded in the game is not changed.",
      chars: isChar ? [{ label: charName(buf) }] : [],
      party: isChar ? null : () => readParty(buf),
      readChar: () => readChar(buf),
      writeChar: (i, ch) => { writeChar(buf, ch); save(); },
      writeParty: (p) => { writeParty(buf, p); save(); },
    };
  }

  SS.Editor = { C, P, RACES, CLASSES, STATUS, STATS, MONTHS, NO_ITEM, parseLines, parseItems, parseSkills, readChar, writeChar,
    readParty, writeParty, healed, liveSource, fileSource, savedFiles };

  // ------------------------------------------------------------------ dialog
  if (typeof document === "undefined") return;

  const el = (tag, props, ...kids) => {
    const e = Object.assign(document.createElement(tag), props || {});
    for (const k of kids) e.append(k);
    return e;
  };

  SS.mountEditor = function (getGame, button) {
    const dlg = document.getElementById("editor");
    const body = el("div", { className: "ed-body" });
    dlg.append(body);
    let items = [], skills = [];

    const numField = (label, value, min, max, onInput) => {
      const input = el("input", { type: "number", min, max, value });
      input.addEventListener("input", () => onInput(input.value === "" ? 0 : +input.value));
      return { row: el("label", { className: "ed-f" }, label, input), input };
    };
    const selectField = (label, options, value, onChange) => {
      const sel = el("select");
      options.forEach(([v, text]) => sel.append(el("option", { value: v, textContent: text, selected: String(v) === String(value) })));
      sel.addEventListener("change", () => onChange(+sel.value));
      return { row: el("label", { className: "ed-f" }, label, sel), sel };
    };

    function build() {
      const g = getGame();
      body.textContent = "";
      const bytes = (name) => { const f = g.dos.lookupOn(0, name); return f ? f.data : new Uint8Array(0); };
      items = SS.Editor.parseItems(bytes("BITEMS"));
      skills = SS.Editor.parseSkills(bytes("BSKILLS"));

      const files = SS.Editor.savedFiles(g.dos);
      const src = selectField("Edit", [["live", "Running game"], ...files.map((n) => [n, "Saved: " + n.trim()])], "live", () => {});
      const area = el("div");
      const note = el("p", { className: "ed-note" });
      body.append(el("h2", { textContent: "Party editor" }), src.row, note, area);
      src.sel.addEventListener("change", () => show(src.sel.value));
      show("live");

      function show(which) {
        const source = which === "live" ? SS.Editor.liveSource(g) : SS.Editor.fileSource(g.dos, which);
        note.textContent = source.note;
        area.textContent = "";
        if (source.party) area.append(partyForm(source));
        if (source.chars.length) area.append(charForm(source));
      }
    }

    function partyForm(source) {
      const p = source.party();
      const box = el("fieldset", {}, el("legend", { textContent: "Party" }));
      const gold = numField("Gold", p.gold, 0, 16777215, (v) => { p.gold = v; });
      const month = selectField("Month", SS.Editor.MONTHS.map((n, i) => [i + 1, n]), p.month, (v) => { p.month = v; });
      const day = numField("Day", p.day, 1, 34, (v) => { p.day = v; });
      const hour = numField("Hour", p.hour, 0, 23, (v) => { p.hour = v; });
      const apply = el("button", { textContent: "Apply party" });
      apply.addEventListener("click", () => { source.writeParty(p); apply.textContent = "Applied"; setTimeout(() => { apply.textContent = "Apply party"; }, 1200); });
      box.append(el("div", { className: "ed-grid" }, gold.row, month.row, day.row, hour.row), apply);
      return box;
    }

    function charForm(source) {
      const wrap = el("div");
      const pick = selectField("Character", source.chars.map((c, i) => [i, c.label]), 0, show);
      wrap.append(pick.row);
      const form = el("div");
      wrap.append(form);
      show(0);
      return wrap;

      function show(i) {
        form.textContent = "";
        const ch = source.readChar(i);
        const grid = el("div", { className: "ed-grid" });
        const add = (f) => { grid.append(f.row); return f; };
        add(selectField("Race", SS.Editor.RACES.map((n, k) => [k, n]), ch.race, (v) => { ch.race = v; }));
        add(selectField("Class", SS.Editor.CLASSES.map((n, k) => [k, n]), ch.cls, (v) => { ch.cls = v; }));
        add(numField("Level", ch.level, 0, 255, (v) => { ch.level = v; }));
        add(numField("Experience", ch.exp, 0, 16777215, (v) => { ch.exp = v; }));
        const hp = add(numField("HP", ch.hp, 0, 255, (v) => { ch.hp = v; }));
        const maxHp = add(numField("Max HP", ch.maxHp, 0, 255, (v) => { ch.maxHp = v; }));
        const sp = add(numField("SP", ch.sp, 0, 255, (v) => { ch.sp = v; }));
        const maxSp = add(numField("Max SP", ch.maxSp, 0, 255, (v) => { ch.maxSp = v; }));
        const status = add(selectField("Condition", SS.Editor.STATUS.map((n, k) => [k, n]), ch.status, (v) => { ch.status = v; }));
        SS.Editor.STATS.forEach((n, k) => add(numField(n, ch.stats[k], 0, 255, (v) => { ch.stats[k] = v; })));

        const skillBox = el("fieldset", {}, el("legend", { textContent: "Skills" }));
        const sgrid = el("div", { className: "ed-grid" });
        ch.skills.forEach((v, k) => {
          const pair = skills[k];
          const label = pair ? pair[ch.cls] : "Skill " + (k + 1);
          sgrid.append(numField(label, v, 0, 255, (x) => { ch.skills[k] = x; }).row);
        });
        skillBox.append(sgrid);

        const invBox = el("fieldset", {}, el("legend", { textContent: "Items" }));
        const slotOpts = [[NO_ITEM, "None"], ...ch.items.map((_, k) => [k, String.fromCharCode(65 + k)])];
        const igrid = el("div", { className: "ed-items" });
        const itemOpts = [[NO_ITEM, "(empty)"], ...items.map((n, k) => [k, n])];
        ch.items.forEach((id, k) => {
          const f = selectField(String.fromCharCode(65 + k), itemOpts, id, (v) => { ch.items[k] = v; });
          const known = el("input", { type: "checkbox", checked: ch.ident[k] !== 0, title: "Identified" });
          known.addEventListener("change", () => { ch.ident[k] = known.checked ? 1 : 0; });
          igrid.append(el("div", { className: "ed-item" }, f.row, el("label", {}, known, " known")));
        });
        const equip = el("div", { className: "ed-grid" });
        equip.append(selectField("Weapon in hand", slotOpts, ch.weapon, (v) => { ch.weapon = v; }).row,
          selectField("Armor worn", slotOpts, ch.armor, (v) => { ch.armor = v; }).row);
        invBox.append(igrid, equip);

        const heal = el("button", { textContent: "Heal fully" });
        heal.addEventListener("click", () => {
          const h = SS.Editor.healed(ch);
          ch.hp = h.hp; ch.sp = h.sp; ch.status = h.status;
          hp.input.value = ch.hp; sp.input.value = ch.sp; status.sel.value = 0;
        });
        const maxOut = el("button", { textContent: "Max points" });
        maxOut.addEventListener("click", () => {
          ch.maxHp = ch.hp = 255; ch.maxSp = ch.sp = 255;
          hp.input.value = maxHp.input.value = sp.input.value = maxSp.input.value = 255;
        });
        const apply = el("button", { textContent: "Apply character" });
        apply.addEventListener("click", () => {
          source.writeChar(i, ch);
          apply.textContent = "Applied"; setTimeout(() => { apply.textContent = "Apply character"; }, 1200);
        });
        form.append(grid, skillBox, invBox, el("div", { className: "ed-bar" }, heal, maxOut, apply));
      }
    }

    button.addEventListener("click", () => { build(); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); });
    const close = el("button", { textContent: "Close", className: "ed-close" });
    close.addEventListener("click", () => { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); });
    dlg.append(close);
  };
})(typeof SS !== "undefined" ? SS : (globalThis.SS = globalThis.SS || {}));
