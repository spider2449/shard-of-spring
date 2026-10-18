// Browser front-end: canvas display, keyboard and touch input, sound, save storage.
(function (SS) {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const canvas = $("screen");
  const ctx = canvas.getContext("2d");
  const frame = ctx.createImageData(SS.SCREEN_W, SS.SCREEN_H);
  const status = $("status");

  const storage = {
    getItem(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  const images = SS.DISKS.map(SS.b64ToBytes);
  let game, font;

  function boot() {
    game = new SS.Game(images, storage);
    game.realTime = true; waitUntil = 0; dirty = true;
    game.m.onBell = () => beep(880, 0.12);
    const a = game.dos.lookupOn(0, "ASCII.SET");
    font = a ? a.data : null;
    game.boot();
    setStatus("Running");
  }

  function setStatus(t) { status.textContent = t; }

  // ------------------------------------------------------------------ sound
  let audio = null, soundOn = true;
  function ensureAudio() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = false; } }
    if (audio && audio.state === "suspended") audio.resume();
    return audio;
  }
  function beep(freq, dur) {
    const a = soundOn && ensureAudio();
    if (!a) return;
    const o = a.createOscillator(), g = a.createGain();
    o.type = "square"; o.frequency.value = freq; g.gain.value = 0.05;
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
  }
  const CPU_HZ = 1020484;
  function playSpeaker(stamps) {
    const a = soundOn && ensureAudio();
    if (!a || stamps.length < 2) return;
    const rate = a.sampleRate;
    const total = (stamps[stamps.length - 1] - stamps[0]) / CPU_HZ;
    if (total <= 0.001 || total > 3) return;
    const buf = a.createBuffer(1, Math.ceil(total * rate), rate);
    const d = buf.getChannelData(0);
    let level = 0.15, k = 1;
    for (let i = 0; i < d.length; i++) {
      const t = stamps[0] + (i / rate) * CPU_HZ;
      while (k < stamps.length && stamps[k] <= t) { level = -level; k++; }
      d[i] = level;
    }
    const src = a.createBufferSource(); src.buffer = buf; src.connect(a.destination); src.start();
  }

  // ------------------------------------------------------------------ input
  const KEYMAP = { Enter: 13, Escape: 27, Backspace: 8, ArrowLeft: 8, ArrowRight: 21, ArrowUp: 11, ArrowDown: 10, Delete: 127 };
  function sendKey(code) {
    ensureAudio();
    const m = game.m;
    if (m.keys.length < 4) m.pushKey(code);
  }
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && e.target.id === "kbd") return;
    let code = KEYMAP[e.key];
    if (code === undefined && e.key.length === 1) {
      code = e.key.toUpperCase().charCodeAt(0);
      if (code > 95) code = 0;
    }
    if (code === undefined || code === 0) return;
    e.preventDefault();
    sendKey(code);
  });

  document.querySelectorAll("[data-key]").forEach((b) => {
    b.addEventListener("click", () => { sendKey(+b.dataset.key); });
  });
  const kbd = $("kbd");
  $("btnKeyboard").addEventListener("click", () => kbd.focus());
  kbd.addEventListener("input", () => {
    for (const ch of kbd.value) { const c = ch.toUpperCase().charCodeAt(0); if (c < 96) sendKey(c); }
    kbd.value = "";
  });
  kbd.addEventListener("keydown", (e) => {
    const code = KEYMAP[e.key];
    if (code !== undefined) { e.preventDefault(); sendKey(code); }
  });

  $("btnRestart").addEventListener("click", () => { if (confirm("Restart the game? Saved parties are kept.")) boot(); });
  $("btnSound").addEventListener("click", (e) => { soundOn = !soundOn; e.target.textContent = "Sound: " + (soundOn ? "on" : "off"); });
  $("btnErase").addEventListener("click", () => {
    if (confirm("Erase ALL saved characters, parties and dungeon progress?")) { game.dos.resetSaves(); boot(); }
  });
  $("btnFull").addEventListener("click", () => {
    const el = $("stage");
    if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen();
  });

  // ------------------------------------------------------------------ main loop
  let flash = false, lastFlash = 0, waitUntil = 0, dirty = true, lastFlashDrawn = false;
  function tick(ts) {
    if (ts - lastFlash > 500) { flash = !flash; lastFlash = ts; }
    const g = game;
    if (g.status === "delay") { waitUntil = ts + g.delayMs; g.status = "paused"; }
    if (g.status === "paused" && ts >= waitUntil) g.status = "running";
    if (g.status === "running" || (g.status === "waiting" && g.m.hasKey())) { g.pump(6); dirty = true; }
    if (g.m.speaker.length) { playSpeaker(g.m.speaker); g.m.speaker.length = 0; }
    if (g.status === "error" || g.status === "crashed") setStatus(g.errorText || "Stopped");
    else if (g.status === "ended") setStatus("Program ended");
    if (flash !== lastFlashDrawn && !g.m.graphics) dirty = true;
    if (dirty) {
      lastFlashDrawn = flash; dirty = false;
      SS.renderScreen(g.m, frame.data, font, flash);
      ctx.putImageData(frame, 0, 0);
    }
    requestAnimationFrame(tick);
  }

  boot();
  requestAnimationFrame(tick);
  window.__game = () => game;
})(window.SS);
