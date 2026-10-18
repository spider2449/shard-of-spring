// Headless Edge smoke test for a generated page: node tools/a2test/browser.js page.html out.png ["js to run in page"]
const { spawn } = require("child_process"), fs = require("fs"), path = require("path");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const [page, out, scriptArg] = process.argv.slice(2);
const script = scriptArg && scriptArg[0] === "@" ? fs.readFileSync(scriptArg.slice(1), "utf8") : scriptArg;
const url = "file:///" + path.resolve(page).split(path.sep).join("/");
const profile = path.join(process.env.TEMP || "/tmp", "a2-profile-" + Date.now());
const proc = spawn(edge, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9334", "--user-data-dir=" + profile, "--window-size=1000,900", "--remote-allow-origins=*", url], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9334/json")).json(); if (targets.some((t) => t.type === "page")) break; } catch (e) {} await sleep(250); }
  const pg = targets.find((t) => t.type === "page");
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result || d); pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(d.params.exceptionDetails.exception || d.params.exceptionDetails.text)); if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error " + JSON.stringify(d.params.args.map((a) => a.value))); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable"); await send("Page.reload");
  for (let i = 0; i < 60; i++) { const r = await send("Runtime.evaluate", { expression: "document.readyState === 'complete' && typeof window.__a2" }); if (r.result && r.result.value && r.result.value !== 'undefined') break; await sleep(250); }
  let res = "";
  if (script) { const r = await send("Runtime.evaluate", { expression: script, awaitPromise: true, returnByValue: true }); res = JSON.stringify(r.result && r.result.value !== undefined ? r.result.value : r); await sleep(800); }
  const st = await send("Runtime.evaluate", { expression: "document.getElementById('status').textContent" });
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("status:", st.result && st.result.value, "| result:", res, "| errors:", errors.length ? errors.join("; ") : "none");
  ws.close(); proc.kill();
  setTimeout(() => process.exit(0), 500);
})();
