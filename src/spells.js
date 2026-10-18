// Spellbook: all spell records from the game's BSPELLS.bin file, decoded.
// Fields: g = school (1 Fire, 2 Metal, 3 Wind, 4 Ice, 5 Spirit),
// e = effect id, f = effect factor, d = minimum S.P. to spend,
// where: "camp"/"combat"/"both" derived from the game's own dispatch tables.
(function (SS) {
  "use strict";

  var SCHOOLS = {
    1: { en: "Fire", zh: "火", color: "#e2543a" },
    2: { en: "Metal", zh: "金", color: "#b7b0a4" },
    3: { en: "Wind", zh: "風", color: "#9ad0e8" },
    4: { en: "Ice", zh: "冰", color: "#7fb8ff" },
    5: { en: "Spirit", zh: "靈", color: "#cba6f7" },
  };

  // In file order (names must be typed exactly as the game stores them)
  var SPELLS = [
    { school: 1, name: "COLUMN OF FIRE",   e: 5,  f: -3, d: 1,  where: "combat", desc: "火柱重創一名敵人,最高 ≈ SP×3 傷害" },
    { school: 1, name: "FLAME STRIKE",     e: 2,  f: 25, d: 16, where: "combat", desc: "天火劈落,機率 ≈ SP×25/16% 一擊擊斃" },
    { school: 1, name: "FIRE STORM",       e: 1,  f: 15, d: 10, where: "combat", desc: "火焰風暴,目標 5×5 範圍內敵人皆受傷" },
    { school: 1, name: "SWORD",            e: 5,  f: -5, d: 2,  where: "combat", desc: "魔劍直擊一名敵人,最高 ≈ SP×5 傷害" },
    { school: 2, name: "CHAINS",           e: 11, f: 1,  d: 10, where: "combat", desc: "鐵鏈縛住一名敵人,使其無法行動" },
    { school: 2, name: "DEATH BLADE",      e: 2,  f: 18, d: 15, where: "combat", desc: "死亡之刃,機率 ≈ SP×18/15% 一擊擊斃" },
    { school: 2, name: "STRENGTH",         e: 4,  f: 1,  d: 1,  where: "combat", desc: "提升目標力量" },
    { school: 2, name: "TEMPEST",          e: 1,  f: 7,  d: 6,  where: "combat", desc: "風暴襲擊,目標 5×5 範圍內敵人皆受傷" },
    { school: 3, name: "STILL AIR",        e: 11, f: 1,  d: 11, where: "combat", desc: "靜滯空氣,拘束一名敵人" },
    { school: 3, name: "WINGS OF VICTORY", e: 3,  f: 1,  d: 1,  where: "combat", desc: "凱旋之翼,提升目標技巧(命中率)" },
    { school: 3, name: "WINGS",            e: 6,  f: 3,  d: 4,  where: "combat", desc: "提升目標移動速度(最高 ≈ SP×1)" },
    { school: 3, name: "BREATH OF LIFE",   e: 5,  f: 10, d: 5,  where: "both",   desc: "生命之息,治療一名隊員(最高 ≈ SP×2)" },
    { school: 4, name: "HAIL STORM",       e: 1,  f: 8,  d: 7,  where: "combat", desc: "冰雹風暴,目標 5×5 範圍內敵人皆受傷" },
    { school: 4, name: "CHILL",            e: 3,  f: -1, d: 1,  where: "combat", desc: "寒意侵體,降低一名敵人的技巧" },
    { school: 4, name: "SLOW",             e: 6,  f: -3, d: 3,  where: "combat", desc: "大幅降低一名敵人的速度" },
    { school: 4, name: "FREEZE",           e: 11, f: 1,  d: 9,  where: "combat", desc: "凍結一名敵人(需 MELT 才能解開)" },
    { school: 5, name: "SPIRIT WRACK",     e: 2,  f: 26, d: 20, where: "combat", desc: "摧殘魂魄,機率 ≈ SP×26/20% 一擊擊斃" },
    { school: 5, name: "WEAKEN",           e: 4,  f: -1, d: 1,  where: "combat", desc: "削弱一名敵人的力量" },
    { school: 5, name: "CLUMSINESS",       e: 3,  f: -3, d: 2,  where: "combat", desc: "目標失去準頭,技巧大幅下降" },
    { school: 5, name: "HEAL",             e: 5,  f: 3,  d: 1,  where: "both",   desc: "治療一名隊員(最高 ≈ SP×3)" },
    { school: 5, name: "RESSURECT",        e: 8,  f: 25, d: 25, where: "camp",   desc: "復活一名陣亡的角色" },
    { school: 5, name: "CURE POISON",      e: 9,  f: 60, d: 9,  where: "both",   desc: "解除中毒狀態" },
    { school: 5, name: "TRANSFERENCE",     e: 13, f: 3,  d: 3,  where: "both",   desc: "把施法者的 SP 轉移給目標(最高 ≈ SP×1)" },
    { school: 1, name: "MELT",             e: 10, f: 1,  d: 11, where: "both",   desc: "融化寒冰,解除被 FREEZE 凍結的目標" },
    { school: 2, name: "BREAK BONDS",      e: 10, f: 1,  d: 11, where: "both",   desc: "掙斷鐵鏈,解除被 CHAINS 縛住的目標" },
    { school: 3, name: "FREEDOM",          e: 10, f: 1,  d: 13, where: "both",   desc: "解除被 STILL AIR 拘束的目標" },
    { school: 3, name: "WIND WALK",        e: 12, f: 1,  d: 10, where: "camp",   desc: "御風而行,整隊瞬間移動(Gate)" },
    { school: 2, name: "ARMOR",            e: 7,  f: 1,  d: 2,  where: "combat", desc: "金屬鎧甲加持,提高目標護甲" },
    { school: 5, name: "SANCTUARY",        e: 7,  f: 1,  d: 3,  where: "combat", desc: "和平光環,提高目標護甲" },
    { school: 4, name: "ICE SHIELD",       e: 7,  f: 1,  d: 3,  where: "combat", desc: "冰盾加持,提高目標護甲" },
    { school: 1, name: "FLAME SHIELD",     e: 7,  f: 1,  d: 4,  where: "combat", desc: "火焰護盾加持,提高目標護甲" },
    { school: 1, name: "MAGIC TORCH",      e: 12, f: 2,  d: 6,  where: "camp",   desc: "召出魔法光球,在地牢為隊伍照明" },
    { school: 4, name: "CRYSTALIGHT",      e: 12, f: 2,  d: 4,  where: "camp",   desc: "凍藍光暈,在地牢為隊伍照明" },
  ];

  var WHERE = { camp: "營地", combat: "戰鬥", both: "營地+戰鬥" };

  // Builds the table inside el; calls onCast(name) when a spell is clicked.
  SS.mountSpellbook = function (el, onCast) {
    var html = '<table class="sp-table"><tbody>';
    for (var s = 1; s <= 5; s++) {
      var meta = SCHOOLS[s];
      html += '<tr class="sp-school"><td colspan="4"><span class="sp-chip" style="background:' + meta.color + '">' +
        meta.en + " " + meta.zh + "</span></td></tr>";
      for (var i = 0; i < SPELLS.length; i++) {
        var sp = SPELLS[i];
        if (sp.school !== s) continue;
        html += '<tr class="sp-row" data-spell="' + sp.name + '" title="點一下 = 遊戲等待輸入時自動打出 ' + sp.name + '">' +
          '<td class="sp-name">' + sp.name + "</td>" +
          '<td class="sp-desc">' + sp.desc + "</td>" +
          '<td class="sp-d">SP ' + sp.d + "</td>" +
          '<td class="sp-where">' + WHERE[sp.where] + "</td></tr>";
      }
    }
    html += "</tbody></table>";
    el.innerHTML = html;
    el.addEventListener("click", function (ev) {
      var row = ev.target.closest ? ev.target.closest(".sp-row") : null;
      if (row && onCast) onCast(row.dataset.spell, SPELLS.filter(function (x) { return x.name === row.dataset.spell; })[0]);
    });
  };
})(window.SS);