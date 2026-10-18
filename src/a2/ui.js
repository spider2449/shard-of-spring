// Browser front end for the Apple II emulator: canvas, keyboard, joystick, sound, disk drives and saved disks.
(function (A2) {
  "use strict";

  const CFG = window.A2CFG;
  const $ = (id) => document.getElementById(id);
  const CPU_HZ = 1022727;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const b64ToBytes = (s) => {
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const bytesToB64 = (b) => {
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };

  const canvas = $("screen"), ctx = canvas.getContext("2d");
  const frame = ctx.createImageData(A2.SCREEN_W, A2.SCREEN_H);
  const pixels = new Uint32Array(frame.data.buffer);
  const renderer = new A2.Renderer();
  const statusEl = $("status");
  const setStatus = (t) => { statusEl.textContent = t; };

  let machine = null;
  const diskRom = CFG.diskRom ? b64ToBytes(CFG.diskRom) : null;
  const embedded = CFG.rom ? b64ToBytes(CFG.rom) : null;
  const saveKey = (i) => "a2save:" + CFG.id + ":" + i;

  // ------------------------------------------------------------------ disks
  // Embedded disks as {name, bytes}; user-loaded disks join the same list for the drive menus.
  const library = (CFG.disks || []).map((d, i) => ({ name: d.name, bytes: b64ToBytes(d.data), embedded: i, saved: false }));

  function makeDisk(entry) {
    let bytes = entry.bytes;
    const name = entry.name;
    let saved = false;
    if (entry.embedded !== undefined) {
      const s = store.get(saveKey(entry.embedded));
      if (s) { try { bytes = b64ToBytes(s); saved = true; } catch (e) { bytes = entry.bytes; } }
    }
    let d;
    try { d = new A2.Disk(name, bytes); } catch (e) { setStatus(e.message); return null; }
    d.entry = entry;
    return d;
  }

  function persist(disk) {
    if (!disk || !disk.dirty || !disk.entry || disk.entry.embedded === undefined) return;
    const { bytes, format } = disk.toBytes();
    // Saved copy keeps its format; a later load re-detects it from size/contents.
    if (store.set(saveKey(disk.entry.embedded), bytesToB64(bytes))) { disk.dirty = false; flashNote("Disk saved in this browser (" + format + ")"); }
    else { flashNote("Could not save the disk (browser storage is full)"); disk.dirty = false; }
  }
  let noteTimer = 0;
  function flashNote(t) { $("note").textContent = t; clearTimeout(noteTimer); noteTimer = setTimeout(() => { $("note").textContent = ""; }, 4000); }

  function buildDriveMenus() {
    for (const n of [0, 1]) {
      const sel = $("drive" + (n + 1));
      sel.innerHTML = "";
      const none = document.createElement("option"); none.value = "-1"; none.textContent = "(empty)"; sel.appendChild(none);
      library.forEach((e, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = e.name; sel.appendChild(o); });
      const cur = machine.disk.drives[n].disk;
      sel.value = cur && cur.entry ? String(library.indexOf(cur.entry)) : "-1";
    }
  }

  function insertEntry(drive, idx) {
    const cur = machine.disk.drives[drive].disk;
    if (cur) persist(cur);
    machine.disk.insert(drive, idx < 0 ? null : makeDisk(library[idx]));
  }

  for (const n of [0, 1]) {
    $("drive" + (n + 1)).addEventListener("change", (e) => { insertEntry(n, +e.target.value); e.target.blur(); });
  }
  // ---- user supplied disks: .dsk/.do/.po/.nib/.2mg, or .zip files holding them
  const DISK_EXT = /\.(dsk|do|po|nib|2mg)$/i;
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const w = ds.writable.getWriter(); w.write(bytes); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function unzip(buf) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), out = [];
    let e = buf.length - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error("not a zip file");
    let p = v.getUint32(e + 16, true);
    for (let n = v.getUint16(e + 10, true); n > 0; n--) {
      const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (!DISK_EXT.test(name)) continue;
      const start = lho + 30 + v.getUint16(lho + 26, true) + v.getUint16(lho + 28, true);
      const raw = buf.subarray(start, start + csize);
      out.push({ name: name.replace(/^.*\//, ""), bytes: method === 0 ? raw : await inflateRaw(raw) });
    }
    return out;
  }
  async function readDiskFiles(files) {
    const list = [];
    for (const f of files) {
      const b = new Uint8Array(await f.arrayBuffer());
      if (/\.zip$/i.test(f.name)) { try { list.push(...await unzip(b)); } catch (err) { flashNote(f.name + ": " + err.message); } }
      else list.push({ name: f.name, bytes: b });
    }
    const c = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
    return list.sort((a, b) => c.compare(a.name, b.name));
  }
  // opts.boot: put the first two disks in drives 1 and 2 and power-cycle; otherwise insert into opts.drive.
  async function addDisks(files, opts) {
    const list = await readDiskFiles(files);
    if (!list.length) { flashNote("No disk images found (.dsk .do .po .nib .2mg or a .zip of them)"); return; }
    const entries = list.map((d) => { const en = { name: d.name, bytes: d.bytes }; library.push(en); return en; });
    if (!machine) { // the ROM prompt is still up: the disks wait in the library and boot once a ROM is chosen
      flashNote(entries.length + " disk(s) ready. Choose the Apple II ROM to start.");
      return;
    }
    let failed = "";
    const put = (en, drive) => {
      try { machine.disk.insert(drive, new A2.Disk(en.name, en.bytes)); machine.disk.drives[drive].disk.entry = en; return true; }
      catch (err) { failed = err.message; return false; }
    };
    let ok;
    if (opts.boot) {
      ok = put(entries[0], 0);
      if (entries[1]) put(entries[1], 1);
      if (ok) machine.powerOn();
    } else {
      ok = put(entries[0], opts.drive);
    }
    buildDriveMenus();
    if (failed) { flashNote(failed); setStatus(failed); }
    if (ok) setStatus(opts.boot ? "Booting " + entries[0].name : "Disk changed");
  }
  $("loadFile").addEventListener("change", (e) => {
    addDisks(Array.from(e.target.files), { drive: +$("loadTarget").value, boot: false });
    e.target.value = "";
  });
  $("bootFile").addEventListener("change", (e) => {
    addDisks(Array.from(e.target.files), { boot: true });
    e.target.value = "";
  });
  $("btnSaveImg").addEventListener("click", () => {
    const d = machine.disk.drives[+$("loadTarget").value].disk;
    if (!d) { flashNote("That drive is empty"); return; }
    const { bytes, format } = d.toBytes();
    const a = document.createElement("a");
    const base = d.name.replace(/\.(dsk|do|po|nib|2mg)$/i, "");
    a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    a.download = base + (format === "nib" ? ".nib" : format === "po" ? ".po" : ".dsk");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("btnEraseSaves").addEventListener("click", () => {
    if (!confirm("Discard every change made to the disks in this browser and restart?")) return;
    library.forEach((e, i) => { if (e.embedded !== undefined) store.del(saveKey(i)); });
    startMachine(machine.rom, machine.diskRomBytes);
  });

  // ------------------------------------------------------------------ boot
  function startMachine(rom, diskRom) {
    let m;
    try { m = new A2.Apple2({ rom, diskRom }); } catch (e) { showRomPrompt(e.message); return; }
    m.rom = rom; m.diskRomBytes = diskRom;
    machine = m;
    m.disk.insert(0, library[0] ? makeDisk(library[0]) : null);
    m.disk.insert(1, library[1] ? makeDisk(library[1]) : null);
    if (!library.length) setStatus("No disk yet: drop a disk image or .zip on this page, or use Open game disk");
    m.disk.onChange = () => { statusDirty = true; };
    buildDriveMenus();
    $("romPrompt").hidden = true;
    $("model").textContent = { plus: "Apple ][+", iie: "Apple //e", enhanced: "Enhanced Apple //e" }[m.model];
    if (library.length) setStatus("Running");
    lastTs = 0; accum = 0;
    started = true;
  }

  function showRomPrompt(msg) {
    started = false;
    $("romPrompt").hidden = false;
    $("romMsg").textContent = msg || "";
  }

  // Load a system ROM from a file. A bad file never stops a running machine: the old ROM stays and a note is shown.
  function loadRomFile(file) {
    file.arrayBuffer().then((buf) => {
      const rom = new Uint8Array(buf);
      try { A2.identifyRom(rom); } catch (e) {
        if (machine) flashNote(file.name + ": " + e.message); else showRomPrompt(file.name + ": " + e.message);
        return;
      }
      store.set("a2rom", bytesToB64(rom));
      const keep = machine ? machine.disk.drives.map((d) => d.disk) : null; // the disks in the drives survive the ROM change
      startMachine(rom, diskRom);
      if (keep) {
        keep.forEach((d, i) => { if (d) machine.disk.insert(i, d); });
        buildDriveMenus();
      }
      flashNote("ROM loaded: " + file.name);
    });
  }
  $("romFile").addEventListener("change", (e) => { if (e.target.files[0]) loadRomFile(e.target.files[0]); e.target.value = ""; });
  $("romFile2").addEventListener("change", (e) => { if (e.target.files[0]) loadRomFile(e.target.files[0]); e.target.value = ""; });
  window.addEventListener("dragover", (e) => { e.preventDefault(); });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const isDisk = (f) => DISK_EXT.test(f.name) || /\.zip$/i.test(f.name);
    const disks = files.filter(isDisk), other = files.filter((f) => !isDisk(f));
    if (other.length && !started) loadRomFile(other[0]);
    if (disks.length) addDisks(disks, { boot: true });
  });
  $("btnForgetRom").addEventListener("click", () => {
    store.del("a2rom");
    if (embedded) { startMachine(embedded, diskRom); flashNote("Back to the ROM built into this page"); }
    else showRomPrompt("Stored ROM removed.");
  });

  // ------------------------------------------------------------------ keyboard / joystick
  let capsLock = true, joystick = false, autoTurbo = true, speed = 1, soundOn = true;
  const down = new Set();
  const joy = { left: false, right: false, up: false, down: false };

  function syncKeys() { if (machine) machine.anyKeyDown = down.size > 0; }
  function updateJoystick() {
    if (!machine) return;
    machine.paddles[0] = joy.left ? 0 : joy.right ? 255 : 128;
    machine.paddles[1] = joy.up ? 0 : joy.down ? 255 : 128;
  }

  function keyCode(e) {
    switch (e.key) {
      case "Enter": return 13;
      case "Backspace": return machine && machine.iie ? 127 : 8;
      case "Delete": return 127;
      case "Escape": return 27;
      case "Tab": return 9;
      case "ArrowLeft": return 8;
      case "ArrowRight": return 21;
      case "ArrowUp": return 11;
      case "ArrowDown": return 10;
    }
    if (e.key.length !== 1) return -1;
    let c = e.key.charCodeAt(0);
    if (c > 126) return -1;
    if (e.ctrlKey) {
      const u = e.key.toUpperCase().charCodeAt(0);
      if (u >= 64 && u <= 95) return u - 64;
      return -1;
    }
    if (capsLock || (machine && !machine.iie)) { if (c >= 97 && c <= 122) c -= 32; }
    return c;
  }

  window.addEventListener("keydown", (e) => {
    if (!machine || e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
    ensureAudio();
    if (e.key === "Alt") { e.preventDefault(); machine.buttons[e.code === "AltRight" ? 1 : 0] = true; return; }
    if (e.ctrlKey && e.key === "F12") { e.preventDefault(); machine.reset(); return; }
    if (e.metaKey) return;
    if (joystick) {
      const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      if (map[e.key]) { e.preventDefault(); joy[map[e.key]] = true; updateJoystick(); return; }
      if (e.key === " " || e.key === "z" || e.key === "Z") { e.preventDefault(); machine.buttons[0] = true; return; }
      if (e.key === "x" || e.key === "X") { e.preventDefault(); machine.buttons[1] = true; return; }
    }
    if (e.altKey) return;
    const code = keyCode(e);
    if (code < 0) return;
    e.preventDefault();
    down.add(e.code); syncKeys();
    machine.pressKey(code);
  });
  window.addEventListener("keyup", (e) => {
    if (!machine) return;
    if (e.key === "Alt") { machine.buttons[e.code === "AltRight" ? 1 : 0] = false; e.preventDefault(); return; }
    down.delete(e.code); syncKeys();
    const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (map[e.key]) { joy[map[e.key]] = false; updateJoystick(); }
    if (e.key === " " || e.key === "z" || e.key === "Z") machine.buttons[0] = false;
    if (e.key === "x" || e.key === "X") machine.buttons[1] = false;
  });
  window.addEventListener("blur", () => { down.clear(); syncKeys(); if (machine) machine.buttons.fill(false); });

  document.querySelectorAll("[data-key]").forEach((b) => {
    b.addEventListener("click", () => { if (machine) { ensureAudio(); machine.pressKey(+b.dataset.key); } });
  });

  function pollGamepad() {
    if (!navigator.getGamepads || !machine) return;
    const gp = navigator.getGamepads()[0];
    if (!gp) return;
    machine.paddles[0] = Math.round((gp.axes[0] + 1) * 127.5);
    machine.paddles[1] = Math.round((gp.axes[1] + 1) * 127.5);
    machine.buttons[0] = machine.buttons[0] || !!(gp.buttons[0] && gp.buttons[0].pressed);
    machine.buttons[1] = machine.buttons[1] || !!(gp.buttons[1] && gp.buttons[1].pressed);
  }

  // ------------------------------------------------------------------ toolbar
  $("btnReset").addEventListener("click", () => { if (machine) machine.reset(); });
  $("btnPower").addEventListener("click", () => { if (machine) { machine.powerOn(); setStatus("Running"); } });
  // toggle buttons show their state with a lit dot (class "on" + aria-pressed)
  const setTog = (id, on) => { const b = $(id); b.classList.toggle("on", !!on); b.setAttribute("aria-pressed", on ? "true" : "false"); };
  setTog("btnSound", soundOn); setTog("btnCaps", capsLock); setTog("btnJoy", joystick); setTog("btnTurbo", autoTurbo);
  $("btnSound").addEventListener("click", () => { soundOn = !soundOn; setTog("btnSound", soundOn); ensureAudio(); });
  $("btnCaps").addEventListener("click", () => { capsLock = !capsLock; setTog("btnCaps", capsLock); });
  $("btnJoy").addEventListener("click", () => {
    joystick = !joystick; setTog("btnJoy", joystick);
    joy.left = joy.right = joy.up = joy.down = false; updateJoystick();
  });
  $("speed").addEventListener("change", (e) => { speed = +e.target.value; e.target.blur(); });
  $("btnTurbo").addEventListener("click", () => { autoTurbo = !autoTurbo; setTog("btnTurbo", autoTurbo); });
  // ---- screen options, remembered between visits
  let scanlines = false;
  const opts = (() => { try { return JSON.parse(store.get("a2opts") || "{}"); } catch (e) { return {}; } })();
  function applyOpts() {
    renderer.mode = opts.mode || "color"; renderer.hgr = opts.hgr || "sharp"; scanlines = !!opts.scan;
    canvas.classList.toggle("smooth", !!opts.smooth);
    $("display").value = renderer.mode; $("hgrMode").value = renderer.hgr;
    setTog("btnSmooth", opts.smooth); setTog("btnScan", scanlines);
  }
  const saveOpts = () => { store.set("a2opts", JSON.stringify(opts)); applyOpts(); };
  $("display").addEventListener("change", (e) => { opts.mode = e.target.value; saveOpts(); e.target.blur(); });
  $("hgrMode").addEventListener("change", (e) => { opts.hgr = e.target.value; saveOpts(); e.target.blur(); });
  $("btnSmooth").addEventListener("click", () => { opts.smooth = !opts.smooth; saveOpts(); });
  $("btnScan").addEventListener("click", () => { opts.scan = !opts.scan; saveOpts(); });
  applyOpts();
  $("btnFull").addEventListener("click", () => {
    const el = $("stage");
    if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen();
  });

  // ------------------------------------------------------------------ sound
  let audio = null, nextTime = 0, level = 1, hp = 0, lastIn = 0;
  function ensureAudio() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = false; } }
    if (audio && audio.state === "suspended") audio.resume();
    return audio;
  }
  // Turn the speaker toggle times (CPU cycles) of one slice into audio samples, box-filtered per sample.
  function playSlice(c0, c1, toggles) {
    const a = audio;
    if (!a || !soundOn) return;
    const rate = a.sampleRate, cps = CPU_HZ / rate;
    const n = Math.floor((c1 - c0) / cps);
    if (n < 8) return;
    const buf = a.createBuffer(1, n, rate), d = buf.getChannelData(0);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const s0 = c0 + i * cps, s1 = s0 + cps;
      let acc = 0, t = s0;
      while (k < toggles.length && toggles[k] < s1) {
        const tt = Math.max(toggles[k], s0);
        acc += level * (tt - t); t = tt; level = -level; k++;
      }
      acc += level * (s1 - t);
      const x = acc / cps;
      hp = x - lastIn + 0.995 * hp; lastIn = x;
      d[i] = hp * 0.25;
    }
    const now = a.currentTime;
    if (nextTime < now + 0.02 || nextTime > now + 0.4) nextTime = now + 0.06;
    const src = a.createBufferSource();
    src.buffer = buf; src.connect(a.destination); src.start(nextTime);
    nextTime += n / rate;
  }

  // ------------------------------------------------------------------ main loop
  let started = false, lastTs = 0, accum = 0, statusDirty = true, frames = 0, flash = false, idleSince = 0;
  const driveLed = [$("led1"), $("led2")];

  function tick(ts) {
    requestAnimationFrame(tick);
    if (!started) return;
    const m = machine;
    if (!lastTs) lastTs = ts;
    let dt = Math.min(ts - lastTs, 100);
    lastTs = ts;
    pollGamepad();
    const turbo = autoTurbo && m.disk.isBusy();
    const mult = turbo ? 12 : speed;
    accum += dt * (CPU_HZ / 1000) * mult;
    const c0 = m.cpu.cycles;
    try {
      // Run in slices of at most one video frame so the VBL timing stays sensible.
      let budget = accum;
      while (budget > 0) {
        const slice = Math.min(budget, A2.CYCLES_PER_FRAME);
        m.run(slice);
        budget -= slice;
      }
      accum = 0;
    } catch (e) {
      started = false; setStatus("Emulator error: " + e.message); console.error(e); return;
    }
    const c1 = m.cpu.cycles;
    if (mult === 1 && !turbo) playSlice(c0, c1, m.spk); 
    m.spk.length = 0;
    if (++frames % 16 === 0) flash = !flash;
    renderer.render(m, pixels, flash);
    if (scanlines) {
      for (let y = 1; y < A2.SCREEN_H; y += 2) {
        for (let i = y * A2.SCREEN_W, e = i + A2.SCREEN_W; i < e; i++) {
          const p = pixels[i];
          pixels[i] = (((p >> 1) & 0x7F7F7F) + ((p >> 3) & 0x1F1F1F)) | 0xFF000000;
        }
      }
    }
    ctx.putImageData(frame, 0, 0);

    // drive lights and saves
    for (let n = 0; n < 2; n++) {
      const spinning = m.disk.cur === n && (m.disk.motor || m.cpu.cycles < m.disk.spinUntil);
      driveLed[n].classList.toggle("on", spinning);
      driveLed[n].title = "Track " + (m.disk.drives[n].half >> 1);
    }
    $("trk").textContent = "T" + m.disk.track();
    if (!m.disk.isSpinning()) {
      if (!idleSince) idleSince = ts;
      if (ts - idleSince > 800) for (const dr of m.disk.drives) if (dr.disk && dr.disk.dirty) persist(dr.disk);
    } else idleSince = 0;
    if (m.hleDisk && m.bootFailed && !m.disk.drives[0].disk) setStatus("Drive 1 is empty: drop a disk image on this page, or pick one in D1.");
  }

  window.addEventListener("beforeunload", () => { if (machine) for (const dr of machine.disk.drives) persist(dr.disk); });
  document.addEventListener("visibilitychange", () => { lastTs = 0; });

  // ------------------------------------------------------------------ start
  $("title").textContent = CFG.title;
  const remembered = store.get("a2rom") ? b64ToBytes(store.get("a2rom")) : embedded; // a ROM the user loaded wins
  if (remembered) startMachine(remembered, diskRom);
  else showRomPrompt("");
  requestAnimationFrame(tick);
  window.__a2 = () => machine;
})(window.A2);
