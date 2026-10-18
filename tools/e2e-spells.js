// Spellbook smoke test in headless Edge: node tools/e2e-spells.js out.png
// Boot flow is navigated by fixed waits (its menus are hi-res), then from the
// camp menu on the text screen is decoded and verified: pick "C)ast spell",
// cycle character numbers until "Cast what spell?" appears, click HEAL in the
// Spellbook panel and check the game moves on to its "S.P. #" prompt.
const { spawn } = require("child_process"), fs = require("fs"), path = require("path");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const url = "file:///" + path.join(__dirname, "../dist/index.html").split(path.sep).join("/");
const out = process.argv[2] || "F:/temp/opencode/e2e-spells3.png";
const profile = path.join(process.env.TEMP || "/tmp", "e2e-profile-" + Date.now());
const proc = spawn(edge, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9333", "--user-data-dir=" + profile, "--window-size=1000,1100", "--remote-allow-origins=*", url], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9333/json")).json(); if (targets.some((t) => t.type === "page")) break; } catch (e) {} await sleep(250); }
  const page = targets.filter((t) => t.type === "page" && t.url.includes("index.html"))[0] || targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result || d); pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(d.params.exceptionDetails.exception || d.params.exceptionDetails.text)); if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error " + JSON.stringify(d.params.args.map((a) => a.value))); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  await sleep(2000);
  const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true }); if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r; };
  // record page errors and wait for the engine to be fully up
  await ev("window.__e2eErr=[]; window.onerror=function(m){window.__e2eErr.push(String(m))}; 1");
  for (let i = 0; i < 40; i++) { const r = await ev("typeof window.__game"); if (r.result.value === "function") break; await sleep(300); }
  const pageErr = async () => (await ev("(window.__e2eErr||[]).join(' && ')")).result.value;
  const screen = async () => {
    for (let i = 0; i < 30; i++) {
      const s = (await ev(`(function(){if(!window.__game)return 'NOGAME';var m=window.__game().m,x='';for(var y=0;y<24;y++){for(var j=0;j<40;j++){var c=m.ram[0x400+y*40+j]&127;x+=c>=32&&c<127?String.fromCharCode(c):' ';}x+='\\n';}return x;})()`)).result.value;
      if (s !== "NOGAME") return s;
      await sleep(250);
    }
    throw new Error("page lost window.__game for 7.5s");
  };
  const key = async (k) => { const code = { Enter: 13, Esc: 27 }[k] || k.toUpperCase().charCodeAt(0); await ev(`window.__game().m.pushKey(${code}); 1`); await sleep(400); };
  const waitScreen = async (needle, tries) => {
    const want = needle.toUpperCase().replace(/\s+/g, "");
    for (let i = 0; i < (tries || 25); i++) { const s = await screen(); if (s.toUpperCase().replace(/\s+/g, "").includes(want)) return s; await sleep(300); }
    return null;
  };
  const shot = (file) => send("Page.captureScreenshot", { format: "png" }).then((s) => fs.writeFileSync(file, Buffer.from(s.data, "base64")));
  const fail = async (msg) => { await shot(out.replace(".png", "-fail.png")); console.log("FAIL:", msg, "| pageErr:", await pageErr(), "| errors:", errors.length ? errors.join("; ") : "none"); ws.close(); proc.kill(); setTimeout(() => process.exit(1), 500); };

  await key("Enter");            // title: "Insert game disk and hit a key"
  await sleep(5000);             // main menu (hi-res)
  await key("L");                // load party
  await sleep(1200);
  await key("5");                // ready-made party in slot 5
  await sleep(5000);             // back on the adventure map
  await key("C");                // C at map -> camp menu (text screen)
  const camp = await waitScreen("ast spell", 40);
  if (!camp) { console.log("SCREEN AT FAIL >>>\n" + (await screen()) + "\n<<<"); await fail("camp menu (C)ast spell not shown"); }
  // Pick characters until one actually gets to cast HEAL (clerical spell)
  let ok = false, who = "?", last = "";
  for (let ch = 1; ch <= 4 && !ok; ch++) {
    await key("C");              // (C)ast spell in camp menu
    await sleep(500);
    await key(String(ch));       // character number
    const s = await waitScreen("ast what spell", 12);
    if (!s) continue;
    who = ch;
    await ev("document.querySelector('.sp-row[data-spell=\"HEAL\"]').click(); 1");
    for (let i = 0; i < 25; i++) {
      await sleep(300);
      const s = await screen();
      if (s.toUpperCase().replace(/\s+/g, "").includes("S.P.")) { ok = true; break; }
    }
    if (!ok) { who = ch; last = await screen(); }
  }
  const rows = await ev("document.querySelectorAll('.sp-row').length");
  if (!ok) { console.log("LAST SCREEN >>>\n" + last + "\n<<<"); await fail("HEAL never reached the S.P. prompt (last tried char " + who + ")"); }
  await shot(out);
  console.log("rows:", rows.result.value, "| OK: char " + who + " clicked HEAL -> game shows S.P. prompt | errors:", errors.length ? errors.join("; ") : "none");
  ws.close(); proc.kill();
  setTimeout(() => process.exit(0), 500);
})();