// Checks the party editor against the running game and the saved files.
const { SS, load } = require("./harness.js");
require("../src/editor.js");
const E = SS.Editor;
const store = {}; const storage = { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } };
const g = new SS.Game(load(), storage); g.boot();
const settle = () => { for (let i = 0; i < 2000; i++) { const s = g.pump(1); if (s !== "running") return s; } return "x"; };
settle();
for (const k of [32, 76, 53, 13, 13, 13]) { g.key(k); settle(); }

let fails = 0;
const check = (name, ok) => { if (!ok) fails++; console.log(ok ? "ok  " : "FAIL", name); };

const bytes = (n) => g.dos.lookupOn(0, n).data;
const items = E.parseItems(bytes("BITEMS")), skills = E.parseSkills(bytes("BSKILLS"));
check("57 items, first Dagger, last Teleporter", items.length === 57 && items[0] === "Dagger" && items[56] === "Teleporter");
check("skills parsed", skills.length >= 10 && skills[0][0] === "Sword" && skills[0][1] === "Fire runes");

const live = E.liveSource(g);
check("live party has 4 characters", live.chars.length === 4 && live.chars[0].label === "REDWIND");
const p = live.party();
check("party gold read", p.gold === g.m.ram[3338] + g.m.ram[3339] * 256 + g.m.ram[3340] * 65536);
p.gold = 1234567; p.hour = 5;
live.writeParty(p);
check("gold written", g.m.ram[3338] + g.m.ram[3339] * 256 + g.m.ram[3340] * 65536 === 1234567 && g.m.ram[3345] === 5);

const ch = live.readChar(0);
check("character read", ch.name === "REDWIND" && ch.level === 3 && ch.exp === 737);
ch.level = 20; ch.exp = 99999; ch.stats[1] = 30; ch.maxHp = ch.hp = 200; ch.items[0] = 6; ch.ident[0] = 1; ch.weapon = 0; ch.skills[0] = 7;
live.writeChar(0, ch);
const back = live.readChar(0);
check("character written", back.level === 20 && back.exp === 99999 && back.stats[1] === 30 && back.hp === 200 && back.items[0] === 6 && back.weapon === 0 && back.skills[0] === 7);
check("name untouched", back.name === "REDWIND");

const files = E.savedFiles(g.dos);
check("saved files listed", files.includes("REDWIND   .CHAR") && files.includes("PARTY5"));
const fs = E.fileSource(g.dos, "REDWIND   .CHAR");
const sc = fs.readChar(0);
check("saved character is the original", sc.level === 3);
sc.level = 9; fs.writeChar(0, sc);
check("saved character changed", E.fileSource(g.dos, "REDWIND   .CHAR").readChar(0).level === 9 && g.dos.lookupOn(1, "REDWIND   .CHAR").data.length === 200);
const ps = E.fileSource(g.dos, "PARTY5");
check("party file gold", ps.party().gold === 75);
const pp = ps.party(); pp.gold = 5000; ps.writeParty(pp);
check("party file gold changed", E.fileSource(g.dos, "PARTY5").party().gold === 5000);
check("overlay persisted", JSON.parse(store["shardOfSpring.overlay"])[1]["PARTY5"] !== undefined);
const h = E.healed(Object.assign({}, ch, { hp: 1, status: 5 }));
check("heal", h.hp === ch.maxHp && h.status === 0);

console.log(fails ? fails + " failed" : "all passed");
process.exit(fails ? 1 : 0);
