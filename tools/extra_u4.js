// Ultima IV - Quest of the Avatar: 法術表 (spell book) + 修改器 (party editor).
// Compiled into the page right after the emulator UI code (see tools/build.js --extras).
//
// Everything reads/writes the running game directly in emulator RAM. The only format
// knowledge needed is the Apple II Ultima IV memory map (from the disassembled build):
//   $0000..$001F  PRTY save block: player_xpos $00, current_location $0A, game_mode $0B,
//                 player_transport $0E, party_size $0F, move_counter $1C
//   $EC00 + $20*n player n (1-based): name (16 ASCII bytes, NUL padded), gender $10,
//                 class_index $11, status $12 ('G','P','S','D' | $80 — Apple charmap 高位元), STR $13, DEX $14,
//                 INT $15, MP $16, class_bit $17, HP $18/$19, maxHP $1A/$1B,
//                 XP $1C/$1D, weapon $1E, armour $1F   (numbers stored as BCD)
//   $ED00         party: virtues $00-$07 (0 = Avatar), torches $08, gems $09, keys $0A,
//                 sextant $0B, stones $0C, runes $0D, bell/book/candle $0E,
//                 three-part key $0F, food $10-$12, gold $13-$14, horn $15, wheel $16,
//                 skull $17, armour counts $18-$1F, weapon counts $20-$2F,
//                 reagents $38-$3F, mixture counts $40-$59
(function () {
  "use strict";
  if (!window.A2CFG || window.A2CFG.id !== "ultima_iv_quest_of_the_avatar") return;

  var note = document.getElementById("note");
  function say(msg) { note.textContent = "《U4 輔助》" + msg; }

  var PLAYER_BASE = 0xEC00, PARTY = 0xED00, PLAYER_STEP = 0x20;

  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  // ------------------------------------------------------------------ game data

  // Reagents in the game's display order; the mixing prompt types them as A..H.
  var REAGENTS = ["硫磺灰 Ash", "人參 Ginseng", "大蒜 Garlic", "蜘蛛絲 Spider Silk", "血苔 Blood Moss", "黑珍珠 Black Pearl", "顛茄 Nightshade", "曼陀羅 Mandrake"];

  // The 26 spells (letter = A..Z, the key the game asks for). name/mp/mix come from
  // the game itself: SUBS.s string table, ULT4.s spell_mp_cost, MIX.s mixture_table.
  // mix bit $80..$01 = reagent index 0..7 (typed A..H).
  var SPELLS = [
    { name: "AWAKEN",     mp: 5,  mix: 0x60 },
    { name: "BLINK",      mp: 15, mix: 0x18 },
    { name: "CURE",       mp: 5,  mix: 0x60 },
    { name: "DISPELL",    mp: 20, mix: 0xA4 },
    { name: "ENERGY",     mp: 10, mix: 0x94 },
    { name: "FIREBALL",   mp: 15, mix: 0x84 },
    { name: "GATE",       mp: 40, mix: 0x85 },
    { name: "HEAL",       mp: 10, mix: 0x50 },
    { name: "ICEBALL",    mp: 20, mix: 0x05 },
    { name: "JINX",       mp: 30, mix: 0x07 },
    { name: "KILL",       mp: 25, mix: 0x06 },
    { name: "LIGHT",      mp: 5,  mix: 0x80 },
    { name: "MAGIC MISL", mp: 5,  mix: 0x84 },
    { name: "NEGATE",     mp: 20, mix: 0xA1 },
    { name: "OPEN",       mp: 5,  mix: 0x88 },
    { name: "PROTECTION", mp: 15, mix: 0xE0 },
    { name: "QUICKNESS",  mp: 20, mix: 0xC8 },
    { name: "RESSURECT",  mp: 45, mix: 0xF9 },
    { name: "SLEEP",      mp: 15, mix: 0x50 },
    { name: "TREMMOR",    mp: 30, mix: 0x89 },
    { name: "UNDEAD",     mp: 15, mix: 0xA0 },
    { name: "VIEW",       mp: 15, mix: 0x03 },
    { name: "WINDS",      mp: 10, mix: 0x88 },
    { name: "X-IT",       mp: 15, mix: 0x98 },
    { name: "Y-UP",       mp: 10, mix: 0x18 },
    { name: "Z-DOWN",     mp: 5,  mix: 0x18 },
  ];

  var WEAPONS = ["徒手 Hands", "木杖 Staff", "匕首 Dagger", "彈弓 Sling", "釘鎚 Mace", "斧 Axe", "劍 Sword", "弓 Bow", "弩 Crossbow", "燃油 Oil", "斧槍 Halberd", "魔法斧 Magic Axe", "魔法劍 Magic Sword", "魔法弓 Magic Bow", "魔杖 Magic Wand", "神秘劍 Mystic Sword"];
  var ARMOURS = ["皮膚 Skin", "布衣 Cloth", "皮甲 Leather", "鎖甲 Chain", "板甲 Plate", "魔法鎖甲 Magic Chain", "魔法板甲 Magic Plate", "神秘袍 Mystic Robe"];
  var CLASSES = ["Mage 法師", "Bard 吟詩人", "Fighter 戰士", "Druid 德魯伊", "Tinker 工匠", "Paladin 聖騎", "Ranger 遊俠", "Shepherd 牧羊"];
  var WEAPON_SHORT = ["手", "杖", "匕", "彈", "鎚", "斧", "劍", "弓", "弩", "油", "斧槍", "+斧", "+劍", "+弓", "魔杖", "神劍"];
  var ARMOUR_SHORT = ["膚", "布", "皮", "鎖", "板", "+鎖", "+板", "神袍"];

  // ------------------------------------------------------------------ BCD helpers

  // Party numbers are BCD: each byte holds two decimal digits; hp/xp/gold/food use two
  // bytes (4 digits). Values are clamped in the editor to what the game displays.
  function fromBcd(b) { return (b >> 4) * 10 + (b & 0x0F); }
  function toBcd(v) { v = Math.max(0, Math.min(99, Math.round(v))); return ((v / 10) | 0) * 16 + (v % 10); }
  function fromBcdPair(hi, lo) { return (hi >> 4) * 1000 + (hi & 0x0F) * 100 + (lo >> 4) * 10 + (lo & 0x0F); }
  function toBcdPair(v) {
    v = Math.max(0, Math.min(9999, Math.round(v)));
    return { hi: toBcd(((v / 100) | 0) % 100), lo: toBcd(v % 100) };
  }

  // ------------------------------------------------------------------ RAM access

  function machine() {
    try { return typeof window.__a2 === "function" ? window.__a2() : null; } catch (e) { return null; }
  }
  function mread(a) { return machine().read(a & 0xFFFF); }
  // The party pages live in main-bank RAM ($EC-$ED read straight from mem once the
  // game has the code banked in, which is always true while playing).
  function rm(a) { return machine().mem[a]; }
  function wm(a, v) { machine().mem[a] = v; }

  function partySize() { return mread(0x0F); }
  function playerAlive(n) {
    var st = rm(PLAYER_BASE + (n - 1) * PLAYER_STEP + 0x12) & 0x7F;
    return st === 0x47 || st === 0x50 || st === 0x53 || st === 0x44; // 'G' 'P' 'S' 'D'
  }

  // ------------------------------------------------------------------ typed macros

  var typeQueue = [], typeTicker = null;
  function stopTyping() {
    typeQueue.length = 0;
    say("已清空輸入佇列。");
  }
  function startTyping() {
    if (typeTicker) return;
    typeTicker = setInterval(function () {
      if (!typeQueue.length) { clearInterval(typeTicker); typeTicker = null; return; }
      var m = machine();
      if (!m) { typeQueue.length = 0; return; }
      var ch = typeQueue.shift();
      m.pressKey(ch);
      say("鍵入 " + (ch === 13 ? "Return" : "'" + String.fromCharCode(ch) + "'") + (typeQueue.length ? "（剩下 " + typeQueue.length + " 鍵）" : "（完成）"));
    }, 280);
  }
  function typeKeys(codes) {
    if (!machine()) { say("模擬器尚未啟動（這頁還在等 system ROM）。"); return; }
    for (var i = 0; i < codes.length; i++) typeQueue.push(codes[i]);
    startTyping();
    say("開始代打…（每鍵 0.28 秒，可按「停止打字」）");
  }

  // ------------------------------------------------------------------ CSS

  var style = document.createElement("style");
  style.textContent = [
    ".a2x-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); z-index: 50; display: none; align-items: center; justify-content: center; padding: 1.5vh 12px; overflow: hidden; }",
    ".a2x-overlay.open { display: flex; }",
    ".a2x-panel { position: relative; background: var(--panel); border: 2px solid var(--edge); border-radius: 8px; padding: 12px 14px 14px; width: min(860px, 96vw); max-height: 97vh; display: flex; flex-direction: column; color: var(--ink); }",
    ".a2x-body { overflow-y: auto; min-height: 0; padding: 0 6px 2px 0; }",
    ".a2x-panel h3 { margin: 0 0 8px; font-size: 15px; color: var(--accent); letter-spacing: .4px; padding-right: 40px; }",
    ".a2x-panel h4 { margin: 12px 0 4px; font-size: 12px; color: var(--dim); letter-spacing: 1px; }",
    ".a2x-hint { color: var(--dim); font-size: 12.5px; margin: 6px 0 2px; }",
    ".a2x-x { position: absolute; top: 8px; right: 10px; padding: 2px 9px; min-height: 0; }",
    "table.a2x-sp { border-collapse: collapse; width: 100%; font-size: 13px; }",
    "table.a2x-sp th { text-align: left; color: var(--dim); font-weight: 600; padding: 2px 6px; }",
    "table.a2x-sp td { border-top: 1px solid var(--edge); padding: 3px 6px; vertical-align: middle; }",
    "table.a2x-sp .key { color: var(--accent); font-weight: 700; text-align: center; width: 26px; }",
    "table.a2x-sp td button { min-height: 26px; padding: 2px 9px; font-size: 12.5px; }",
    "table.a2x-sp td.a2x-btns { white-space: nowrap; }",
    ".a2x-tools { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 4px 0 8px; }",
    "table.a2x-ed { border-collapse: collapse; width: 100%; font-size: 13px; }",
    "table.a2x-ed td { border-top: 1px solid var(--edge); padding: 5px; }",
    "table.a2x-ed td:first-child { white-space: nowrap; vertical-align: top; padding-right: 10px; }",
    ".a2x-cells { display: flex; flex-wrap: wrap; gap: 5px 8px; align-items: flex-start; }",
    ".a2x-field { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 60px; }",
    ".a2x-field .a2x-lab { margin: 0; }",
    ".a2x-num { width: 58px; background: var(--panel2); color: var(--ink); border: 1px solid var(--edge); border-radius: 4px; padding: 3px 4px; font: inherit; font-size: 12.5px; text-align: right; }",
    ".a2x-lab { color: var(--dim); font-size: 11px; line-height: 1.15; text-align: center; }",
    ".a2x-plain, .a2x-name { background: var(--panel2); color: var(--ink); border: 1px solid var(--edge); border-radius: 4px; padding: 3px 5px; font: inherit; font-size: 12.5px; }",
    "table.a2x-ed .a2x-name { width: 9em; }",
    "table.a2x-ed select.a2x-plain { max-width: 10.5em; }",
    "table.a2x-ed .a2x-field:first-child { align-items: flex-start; }",
  ].join("\n");
  document.head.appendChild(style);

  // ------------------------------------------------------------------ card

  var panels = document.querySelector(".panels");
  if (!panels) return;
  var card = el("section", "card", panels);
  card.setAttribute("aria-label", "Cheats");
  var h2 = el("h2", "", card); h2.textContent = "Cheats 輔助";
  var row = el("div", "row grow", card);
  var btnSpell = el("button", "primary", row); btnSpell.textContent = "法術表";
  var btnEdit = el("button", "primary", row); btnEdit.textContent = "修改器";
  var btnKeys = el("button", "primary", row); btnKeys.textContent = "按鍵表";

  function overlayPanel(title, tagline) {
    var ov = el("div", "a2x-overlay", document.body);
    var pn = el("div", "a2x-panel", ov);
    var x = el("button", "quiet a2x-x", pn); x.textContent = "✕";
    var h3 = el("h3", "", pn); h3.textContent = title;
    el("div", "a2x-hint", pn).textContent = tagline;
    var body = el("div", "a2x-body", pn);
    function close() { ov.classList.remove("open"); }
    x.addEventListener("click", close);
    ov.addEventListener("mousedown", function (e) { if (e.target === ov) close(); });
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && ov.classList.contains("open") && !e.ctrlKey && !e.altKey) { e.stopPropagation(); close(); }
    }, true);
    return { ov: ov, root: pn, body: body };
  }

  function numField(parent, readFn, writeFn, min, max, labelText, title) {
    var cell = el("span", "a2x-field", parent);
    var inp = el("input", "a2x-num", cell);
    inp.type = "number"; inp.min = min; inp.max = max; inp.title = title || labelText;
    inp.addEventListener("change", function () {
      var v = parseInt(inp.value, 10);
      if (!(v >= min)) v = min;
      if (v > max) v = max;
      inp.value = v;
      if (machine()) writeFn(v);
    });
    el("span", "a2x-lab", cell).textContent = labelText;
    return { read: readFn, input: inp };
  }

  function selectField(parent, options, readFn, writeFn, labelText) {
    var cell = el("span", "a2x-field", parent);
    var sel = el("select", "a2x-plain", cell);
    options.forEach(function (o) { var op = el("option", "", sel); op.value = o[0]; op.textContent = o[1]; });
    sel.addEventListener("change", function () { if (machine()) writeFn(sel.value); });
    if (labelText !== "") el("span", "a2x-lab", cell).textContent = labelText;
    return { read: readFn, input: sel };
  }

  // ------------------------------------------------------------------ spell book

  var castPlayer = 1;

  function openSpellbook() {
    var p = overlayPanel("法術表 Spellbook",
      "26 個法術（按鍵 A-Z），配方與法力消耗都取自遊戲程式本身。「混合」＝M＋法術字母＋藥材字母＋Return（＋空格退出混合選單）；「施法」＝C＋施法者編號＋法術字母。請在遊戲正等待輸入時點按，按鍵會像人打字一樣送進遊戲。");

    var bar = el("div", "a2x-tools", p.body);
    var sp = el("span", "a2x-lab", bar); sp.textContent = "施法者 #";
    var sel = el("select", "a2x-plain", bar);
    for (var i = 1; i <= 8; i++) { var o = el("option", "", sel); o.value = i; o.textContent = i; }
    sel.addEventListener("change", function () { castPlayer = +sel.value; });
    var stop = el("button", "danger", bar); stop.textContent = "停止打字";
    stop.addEventListener("click", stopTyping);

    var t = el("table", "a2x-sp", p.body);
    var thead = el("thead", "", t);
    var trh = el("tr", "", thead);
    ["鍵", "名稱", "MP", "所需藥材 (遊戲內輸入鍵)", "", ""].forEach(function (h) { el("th", "", trh).textContent = h; });
    var tbody = el("tbody", "", t);
    SPELLS.forEach(function (sp2, i2) {
      var letter = String.fromCharCode(65 + i2);
      var tr = el("tr", "", tbody);
      el("td", "key", tr).textContent = letter;
      el("td", "", tr).textContent = sp2.name;
      el("td", "", tr).textContent = sp2.mp;
      var codeStr = "", names = [];
      for (var r = 0; r < 8; r++) if (sp2.mix & (0x80 >> r)) { codeStr += "ABCDEFGH"[r]; names.push(REAGENTS[r]); }
      var td = el("td", "", tr);
      var rg = el("span", "", td);
      rg.textContent = codeStr.replace(/(.)/g, "$1 ") + "— " + names.join("＋");
      rg.style.color = "var(--dim)"; rg.style.fontSize = "12.5px";

      td = el("td", "a2x-btns", tr);
      var bmix = el("button", "", td); bmix.textContent = "混合";
      bmix.addEventListener("click", function () {
        var keys = [77, letter.charCodeAt(0)]; // 'M', spell letter
        for (var r2 = 0; r2 < 8; r2++) if (sp2.mix & (0x80 >> r2)) keys.push(65 + r2); // reagent letters A-H
        keys.push(13);
        keys.push(32); // space: 混合結束後遊戲留在 mix 選單，按非 A-Z 鍵 ("NONE!") 才會 exit 回主選單
        typeKeys(keys);
      });

      td = el("td", "a2x-btns", tr);
      var bc = el("button", "", td); bc.textContent = "施法";
      bc.addEventListener("click", function () {
        typeKeys([67, 48 + castPlayer, letter.charCodeAt(0)]); // 'C', player number, spell letter
      });
    });

    el("div", "a2x-hint", p.body).textContent = "先「混合」備妥混劑（存在隊伍的法劑欄），遊戲中再按 C 施放；施放消耗隊員 MP（RESSURECT 等最高階法術 MP 費用極大）。若鍵入錯了階段，遊戲多半會當成普通指令——按「停止打字」重新來過即可。";
    p.ov.classList.add("open");
  }

  // ------------------------------------------------------------------ party editor

  function openEditor() {
    var p = overlayPanel("修改器 Party Editor",
      "直接讀寫執行中的遊戲。改完在遊戲中按 Z (Ztats) 或做任何動作即可看到效果；關閉頁面/斷電會遺失，要永久保存需回地圖畫面按 Q (Quit & save)。");
    var b = p.body;

    var bar = el("div", "a2x-tools", b);
    var bReload = el("button", "", bar); bReload.textContent = "重新讀取";
    var bAll = el("button", "", bar); bAll.title = "金錢/食物 9999、藥材/法劑各 99、火把/寶石/鑰匙 99，並取得所有特殊物品";
    bAll.textContent = "物資全滿";
    var bHeal = el("button", "", bar); bHeal.title = "HP 補滿，狀態回復成 G";
    bHeal.textContent = "全隊痊癒";
    var stop2 = el("button", "danger", bar); stop2.textContent = "停止打字";
    stop2.addEventListener("click", stopTyping);

    var status = el("div", "a2x-hint", b);
    var fields = [];

    // ---- party
    var h4 = el("h4", "", b); h4.textContent = "隊伍 PARTY ($ED00)";
    var g0 = el("div", "a2x-cells", b);
    fields.push(numField(g0, function () { return fromBcdPair(rm(PARTY + 0x13), rm(PARTY + 0x14)); }, function (v) { var pa = toBcdPair(v); wm(PARTY + 0x13, pa.hi); wm(PARTY + 0x14, pa.lo); }, 0, 9999, "金錢"));
    fields.push(numField(g0, function () { return fromBcdPair(rm(PARTY + 0x10), rm(PARTY + 0x11)); }, function (v) { var pa = toBcdPair(v); wm(PARTY + 0x10, pa.hi); wm(PARTY + 0x11, pa.lo); }, 0, 9999, "食物"));
    fields.push(numField(g0, function () { return fromBcd(rm(PARTY + 0x08)); }, function (v) { wm(PARTY + 0x08, toBcd(v)); }, 0, 99, "火把"));
    fields.push(numField(g0, function () { return fromBcd(rm(PARTY + 0x09)); }, function (v) { wm(PARTY + 0x09, toBcd(v)); }, 0, 99, "寶石"));
    fields.push(numField(g0, function () { return fromBcd(rm(PARTY + 0x0A)); }, function (v) { wm(PARTY + 0x0A, toBcd(v)); }, 0, 99, "鑰匙"));

    var bcell = el("span", "a2x-field", g0);
    var bItems = el("button", "", bcell); bItems.title = "六分儀、寶石之石、符文、燭/書/鈴、三鑰匙、號角、輪子、骷髏";
    bItems.textContent = "取得全部特殊物品";
    bItems.addEventListener("click", function () {
      if (!machine()) { say("模擬器尚未啟動。"); return; }
      wm(PARTY + 0x0B, 1); wm(PARTY + 0x0C, 0xFF); wm(PARTY + 0x0D, 0xFF);
      wm(PARTY + 0x0E, 0x07); wm(PARTY + 0x0F, 0x07);
      wm(PARTY + 0x15, 1); wm(PARTY + 0x16, 1); wm(PARTY + 0x17, 1);
      refresh();
      say("特殊物品已全數取得。");
    });

    // virtues
    h4 = el("h4", "", b); h4.textContent = "八德 Virtues（99=滿、0=已成化身）";
    var g1 = el("div", "a2x-cells", b);
    var vNames = ["誠實", "同情", "勇氣", "正義", "犧牲", "榮譽", "靈性", "謙卑"];
    for (var v = 0; v < 8; v++) (function (v) {
      fields.push(numField(g1, function () { return fromBcd(rm(PARTY + v)); }, function (x) { wm(PARTY + v, toBcd(x)); }, 0, 99, vNames[v]));
    })(v);

    // weapons
    h4 = el("h4", "", b); h4.textContent = "武器 Weapon（數量）";
    var g2 = el("div", "a2x-cells", b);
    for (var w = 0; w < 16; w++) (function (w) {
      fields.push(numField(g2, function () { return fromBcd(rm(PARTY + 0x20 + w)); }, function (x) { wm(PARTY + 0x20 + w, toBcd(x)); }, 0, 99, WEAPON_SHORT[w], WEAPONS[w]));
    })(w);

    // armour
    h4 = el("h4", "", b); h4.textContent = "防具 Armour（數量）";
    var g3 = el("div", "a2x-cells", b);
    for (var a = 0; a < 8; a++) (function (a) {
      fields.push(numField(g3, function () { return fromBcd(rm(PARTY + 0x18 + a)); }, function (x) { wm(PARTY + 0x18 + a, toBcd(x)); }, 0, 99, ARMOUR_SHORT[a], ARMOURS[a]));
    })(a);

    // reagents and mixtures
    h4 = el("h4", "", b); h4.textContent = "藥材 Reagents（A-H）";
    var g4 = el("div", "a2x-cells", b);
    for (var r = 0; r < 8; r++) (function (r) {
      fields.push(numField(g4, function () { return fromBcd(rm(PARTY + 0x38 + r)); }, function (x) { wm(PARTY + 0x38 + r, toBcd(x)); }, 0, 99, "ABCDEFGH"[r], REAGENTS[r]));
    })(r);
    h4 = el("h4", "", b); h4.textContent = "法劑 Mixtures（A-Z，0-99）";
    var g5 = el("div", "a2x-cells", b);
    for (var s = 0; s < 26; s++) (function (s) {
      fields.push(numField(g5, function () { return fromBcd(rm(PARTY + 0x40 + s)); }, function (x) { wm(PARTY + 0x40 + s, toBcd(x)); }, 0, 99, String.fromCharCode(65 + s), SPELLS[s].name + " MP " + SPELLS[s].mp));
    })(s);

    // ---- characters
    h4 = el("h4", "", b); h4.textContent = "隊員 CHARACTERS ($EC00，每人 32 bytes，數值皆十進位顯示)";
    var tbl = el("table", "a2x-ed", b);
    var rows = [];

    function PlayerRow(n) {
      var base = PLAYER_BASE + n * PLAYER_STEP;
      var tr = el("tr", "", tbl);
      tr.style.display = "none"; // shown once refresh() sees the player in RAM
      rows.push(tr);
      var td = el("td", "", tr);
      var info = el("div", "a2x-cells", td);

      el("span", "a2x-lab", info).textContent = "#" + (n + 1);
      var ncell = el("span", "a2x-field", info);
      var name = el("input", "a2x-name", ncell); name.type = "text"; name.maxLength = 8;
      name.title = "名字（最多 8 字元）";
      el("span", "a2x-lab", ncell).textContent = "名字";
      fields.push({
        read: function () {
          var s2 = "";
          for (var i = 0; i < 8; i++) { var c = rm(base + i) & 0x7F; if (c < 0x20) break; s2 += String.fromCharCode(c); }
          return s2;
        },
        input: name,
      });
      name.addEventListener("change", function () {
        if (!machine()) return;
        for (var i = 0; i < 8; i++) wm(base + i, i < name.value.length ? (name.value.charCodeAt(i) & 0x7F) | 0x80 : 0);
      });

      fields.push(selectField(info,
        CLASSES.map(function (cn, ci) { return [ci, cn]; }),
        function () { return rm(base + 0x11); },
        function (val) { wm(base + 0x11, +val); },
        "職業"));

      fields.push(selectField(info,
        [["G", "G 正常"], ["P", "P 中毒"], ["S", "S 沉睡"], ["D", "D 死亡"]],
        function () { return (rm(base + 0x12) & 0x7F) >= 0x41 ? String.fromCharCode(rm(base + 0x12) & 0x7F) : "G"; },
        function (val) { wm(base + 0x12, String(val).charCodeAt(0) | 0x80); },
        "狀態"));

      fields.push(selectField(info,
        WEAPONS.map(function (wn, wi) { return [wi, wn]; }),
        function () { return rm(base + 0x1E); },
        function (val) { wm(base + 0x1E, +val); },
        "武器"));

      fields.push(selectField(info,
        ARMOURS.map(function (an, ai) { return [ai, an]; }),
        function () { return rm(base + 0x1F); },
        function (val) { wm(base + 0x1F, +val); },
        "防具"));

      fields.push(numField(info, function () { return fromBcd(rm(base + 0x13)); }, function (x) { wm(base + 0x13, toBcd(x)); }, 0, 99, "STR"));
      fields.push(numField(info, function () { return fromBcd(rm(base + 0x14)); }, function (x) { wm(base + 0x14, toBcd(x)); }, 0, 99, "DEX"));
      fields.push(numField(info, function () { return fromBcd(rm(base + 0x15)); }, function (x) { wm(base + 0x15, toBcd(x)); }, 0, 99, "INT"));
      fields.push(numField(info, function () { return fromBcd(rm(base + 0x16)); }, function (x) { wm(base + 0x16, toBcd(x)); }, 0, 99, "MP"));
      fields.push(numField(info, function () { return fromBcdPair(rm(base + 0x18), rm(base + 0x19)); }, function (x) { var pa = toBcdPair(x); wm(base + 0x18, pa.hi); wm(base + 0x19, pa.lo); }, 0, 9999, "HP"));
      fields.push(numField(info, function () { return fromBcdPair(rm(base + 0x1A), rm(base + 0x1B)); }, function (x) { var pa = toBcdPair(x); wm(base + 0x1A, pa.hi); wm(base + 0x1B, pa.lo); }, 0, 9999, "HM 最大HP"));
      fields.push(numField(info, function () { return fromBcdPair(rm(base + 0x1C), rm(base + 0x1D)); }, function (x) { var pa = toBcdPair(x); wm(base + 0x1C, pa.hi); wm(base + 0x1D, pa.lo); }, 0, 9999, "EXP 經驗"));
    }

    for (var pp = 0; pp < 8; pp++) PlayerRow(pp);

    function refresh() {
      var m = machine();
      if (!m) { say("模擬器尚未啟動（這頁還在等 system ROM）。"); return; }
      var n = partySize();
      var alive = 0;
      // 只顯示活躍隊伍（前 partySize 格）；ROST 剩下的格子是 NPRT 模板人物（IOLO 等），改了也不會生效
      for (var i = 0; i < n; i++) if (playerAlive(i + 1)) alive++;
      rows.forEach(function (tr, i) { tr.style.display = i < n ? "" : "none"; });
      fields.forEach(function (f) { try { f.input.value = f.read(); } catch (e2) { /* keep old value */ } });
      status.textContent = "目前：隊伍 " + n + " 人（" + alive + " 人存活）。改完數值後要在遊戲裡按 Z 看效果。";
      say("修改器已讀取目前狀態。");
    }

    bReload.addEventListener("click", refresh);
    bAll.addEventListener("click", function () {
      if (!machine()) { say("模擬器尚未啟動。"); return; }
      var pa = toBcdPair(9999);
      wm(PARTY + 0x13, pa.hi); wm(PARTY + 0x14, pa.lo);
      wm(PARTY + 0x10, pa.hi); wm(PARTY + 0x11, pa.lo);
      for (var q2 = 0; q2 < 16; q2++) wm(PARTY + 0x20 + q2, 0x99);
      for (var a2 = 0; a2 < 8; a2++) wm(PARTY + 0x18 + a2, 0x99);
      for (var r2 = 0; r2 < 8; r2++) wm(PARTY + 0x38 + r2, 0x99);
      for (var s2 = 0; s2 < 26; s2++) wm(PARTY + 0x40 + s2, 0x99);
      wm(PARTY + 0x08, 0x99); wm(PARTY + 0x09, 0x99); wm(PARTY + 0x0A, 0x99);
      wm(PARTY + 0x0B, 1); wm(PARTY + 0x0C, 0xFF); wm(PARTY + 0x0D, 0xFF);
      wm(PARTY + 0x0E, 0x07); wm(PARTY + 0x0F, 0x07);
      wm(PARTY + 0x15, 1); wm(PARTY + 0x16, 1); wm(PARTY + 0x17, 1);
      refresh();
      say("物資已全滿。");
    });
    bHeal.addEventListener("click", function () {
      if (!machine()) { say("模擬器尚未啟動。"); return; }
      var n = partySize();
      for (var i3 = 1; i3 <= n; i3++) {
        var base = PLAYER_BASE + (i3 - 1) * PLAYER_STEP;
        wm(base + 0x18, rm(base + 0x1A)); wm(base + 0x19, rm(base + 0x1B));
        wm(base + 0x12, 0xC7); // 'G' | $80 (遊戲的 charmap 讓字元常數帶高位元)
      }
      refresh();
      say("隊伍已治癒（HP 滿、狀態 G）。");
    });

    p.ov.classList.add("open");
    refresh();
  }

  btnSpell.addEventListener("click", openSpellbook);
  btnEdit.addEventListener("click", openEditor);
  btnKeys.addEventListener("click", openKeyTable);

  // ------------------------------------------------------------------ key

  var KEYS = [
    ["A", "攻擊 Attack", "選擇方向後攻擊；撞上怪物會開打（戰鬥）"],
    ["B", "乘上 Board", "乘上船、馬或熱氣球"],
    ["C", "施法 Cast", "選施法者與法劑（要先調配；見「法術表」）"],
    ["D", "下降 Descend", "從樓梯、梯子、洞口往下"],
    ["E", "進入 Enter", "進入城鎮、城堡、村落或地城入口"],
    ["F", "開火 Fire", "在船上朝某方向開炮"],
    ["G", "撿取 Get", "撿起地上的物品（寶箱）"],
    ["H", "紮營 Hole up", "紮營休息（只能步行時）；可選睡或不睡"],
    ["I", "點火 Ignite", "點燃火把"],
    ["J", "撬鎖 Jimmy", "撬開上鎖的門"],
    ["K", "上爬 Klimb", "沿梯子往上爬"],
    ["L", "測位 Locate", "有六分儀時顯示經緯度座標"],
    ["M", "調劑 Mix", "調配法劑（見「法術表」可一鍵混合）"],
    ["N", "重新整隊 New order", "變更隊伍出場順序"],
    ["O", "開啟 Open", "開門（城鎮裡也用來開寶箱）"],
    ["P", "窺視 Peer", "用一枚寶石看周圍地圖"],
    ["Q", "存檔 Quit", "離開遊戲並存檔（會保存到本頁的存檔）"],
    ["R", "裝備 Ready", "為隊員挑選武器"],
    ["S", "搜尋 Search", "搜尋所在位置附近有何物"],
    ["T", "交談 Talk", "與 NPC 對話"],
    ["U", "使用 Use", "使用特殊物品（鈴、書、燭、號角、輪子、鑰匙…）"],
    ["V", "音量 Volume", "切換音樂音量"],
    ["W", "穿戴 Wear", "為隊員挑選防具"],
    ["X", "離開 X-it", "離開城鎮、地城，或下船"],
    ["Y", "吆喝 Yell", "「Yoo-hoo」呼喚馬"],
    ["Z", "狀態 Ztats", "查看隊員狀態與裝備"],
  ];

  function openKeyTable() {
    var p = overlayPanel("按鍵表 Command Keys",
      "所有指令在遊戲的「>」提示符下輸入：先按一個字母，再依提示選方向或對象。指令表取自遊戲程式本身（cmd_table），世界/城鎮/地城通用。");
    var b = p.body;

    var t = el("table", "a2x-sp", b);
    var thead = el("thead", "", t);
    var trh = el("tr", "", thead);
    ["鍵", "指令", "說明"].forEach(function (h) { el("th", "", trh).textContent = h; });
    var tbody = el("tbody", "", t);
    KEYS.forEach(function (k) {
      var tr = el("tr", "", tbody);
      el("td", "key", tr).textContent = k[0];
      el("td", "", tr).textContent = k[1];
      el("td", "", tr).textContent = k[2];
    });

    el("h4", "", b).textContent = "方向與回合";
    var dir = el("div", "a2x-hint", b);
    dir.textContent = "空白鍵＝過回合；Enter 或 ↑＝北；←＝西、↓＝南、→＝東。";

    el("h4", "", b).textContent = "戰鬥中";
    var cbt = el("div", "a2x-hint", b);
    cbt.textContent = "只有 A 攻擊、C 施法、G 撿取、R 裝備、U 使用、V 音量、Z 狀態 有效；按其他字母會出現「WHAT?」。方向鍵＝移動。";

    el("h4", "", b).textContent = "開機選單（遊戲開機後）";
    var boot = el("div", "a2x-hint", b);
    boot.textContent = "R＝回選單重新啟動；N＝磁碟機數量（1↔2，建議按成 2 免換片）；J＝Journey 出發；I＝Initiate 新遊戲；A＝Mockingboard 開關。";
    p.ov.classList.add("open");
  }

  say("U4 輔助已載入（法術表 / 修改器 / 按鍵表）。");
})();
