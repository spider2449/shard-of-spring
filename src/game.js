// Ties the machine, file system and BASIC interpreter together and runs the boot program.
(function (SS) {
  "use strict";

  class Game {
    constructor(images, storage) {
      this.m = new SS.Machine();
      this.dos = new SS.Dos(this.m, images, storage);
      this.interp = new SS.Interpreter(this.m, this.dos);
      this.gen = null;
      this.status = "idle";
      this.realTime = false;   // the browser sets this so delay loops really wait
      this.delayMs = 0;
      this.errorText = null;
    }

    boot() {
      this.m.ram[0x3F2] = 0x00; this.m.ram[0x3F3] = 0xBE;
      this.dos.cur = 0; this.dos.reading = null; this.dos.writing = null;
      const i = this.interp;
      i.halted = false; i.resetRequested = false; i.errorText = null;
      i.loadProgram(this.dos.getProgram("HELLO"));
      this.gen = i.run();
      this.status = "running";
    }

    // Run until the program waits for a key, yields for a time slice, or ends.
    pump(maxSlices = 1) {
      if (!this.gen) return this.status;
      for (let n = 0; n < maxSlices; n++) {
        let r;
        try { r = this.gen.next(); } catch (e) { this.status = "crashed"; this.errorText = String(e && e.stack || e); this.gen = null; return this.status; }
        if (r.done) {
          if (this.interp.resetRequested) { this.boot(); continue; }
          this.status = this.interp.errorText ? "error" : "ended";
          this.errorText = this.interp.errorText || null;
          this.gen = null;
          return this.status;
        }
        if (r.value === "key") { this.status = "waiting"; return this.status; }
        if (r.value && r.value.delay) {
          if (this.realTime) { this.delayMs = Math.min(r.value.delay, 4000); this.status = "delay"; return this.status; }
          continue;
        }
        this.status = "running";
      }
      return this.status;
    }

    key(code) { this.m.pushKey(code); }
  }

  SS.Game = Game;
})(typeof SS !== "undefined" ? SS : (globalThis.SS = globalThis.SS || {}));
