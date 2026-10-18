// End-to-end check in headless Edge: node tools/e2e.js out.png "key key ..."  (keys: names or single chars)
const { spawn } = require("child_process"), fs = require("fs"), path = require("path");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const url = "file:///" + path.join(__dirname, "../dist/index.html").split(path.sep).join("/");
const out = process.argv[2], keys = (process.argv[3] || "").split(/\s+/).filter(Boolean);
const profile = path.join(process.env.TEMP || "/tmp", "e2e-profile-" + Date.now());
const proc = spawn(edge, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9333", "--user-data-dir=" + profile, "--window-size=1000,900", "--remote-allow-origins=*", url], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch("http://127.0.0.1:9333/json")).json(); if (targets.some((t) => t.type === "page")) break; } catch (e) {} await sleep(250); }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d.result || d); pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(d.params.exceptionDetails.exception || d.params.exceptionDetails.text)); if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error " + JSON.stringify(d.params.args.map((a) => a.value))); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  await sleep(1500);
  const keyDefs = { Enter: ["Enter", 13], Esc: ["Escape", 27], Left: ["ArrowLeft", 37], Right: ["ArrowRight", 39], Up: ["ArrowUp", 38], Down: ["ArrowDown", 40], Space: [" ", 32], Back: ["Backspace", 8] };
  for (const k of keys) {
    const d = keyDefs[k] || [k, k.toUpperCase().charCodeAt(0)];
    const text = d[0].length === 1 ? d[0] : undefined;
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: d[0], code: d[0], windowsVirtualKeyCode: d[1], text });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: d[0], code: d[0], windowsVirtualKeyCode: d[1] });
    await sleep(250);
  }
  await sleep(600);
  const st = await send("Runtime.evaluate", { expression: "document.getElementById('status').textContent + ' | disk ' + (window.__game().dos.cur+1)" });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("status:", st.result && st.result.value, "| errors:", errors.length ? errors.join("; ") : "none");
  ws.close(); proc.kill();
  setTimeout(() => process.exit(0), 500);
})();
