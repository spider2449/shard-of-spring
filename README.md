# Apple II game page builder

Give it any Apple II disk image (or a .zip of them) and it writes one self-contained page, `dist/<game_name>.html`,
that runs the game in a browser on a full Apple II emulator.

```
node tools/build.js "rom/Shard of Spring, The (1986)(SSI).zip"              # -> dist/The_Shard_of_Spring.html
node tools/build.js game.dsk --rom apple2plus.rom                           # embed the system ROM as well
node tools/build.js disk1.dsk disk2.po --name "My Game" --out dist
```

**One page for every game**: `node tools/build.js --rom system.rom` (or without `--rom`) writes a generic
`dist/apple2.html` with no game inside. Drop any disk image or `.zip` onto it (or use "Open game disk") and it boots;
per-game pages are only needed if you want a single file with the game baked in.

* **Inputs**: `.dsk .do .po .nib .2mg`, loose or inside `.zip` files, or a folder. DOS-order and ProDOS-order images are
  told apart automatically. The first disk goes into drive 1, the second into drive 2; the page has menus to swap them
  and to load other disk files.
* **System ROM**: the emulator needs the firmware of a real machine, which is not shipped here. Pass it with
  `--rom` (or `$APPLE2_ROM`) and it is embedded; otherwise the page asks for it on first load and remembers it in
  the browser. A 12 KB image is an Apple ][ / ][+, a 16 KB image is an Apple //e or enhanced //e (65C02 is used when the
  ROM is the enhanced one). Larger dumps that carry extra banks (e.g. 20 KB or 32 KB files) are accepted too; the
  part ending at $FFFF is used. `--disk-rom` optionally supplies the 256-byte Disk II boot PROM; without it a built-in
  stand-in loads the boot sector and answers the sector-read call at `$C65C`, everything after that goes through
  the real Disk II controller model.
* **Game name**: taken from the file name (`Shard of Spring, The (1986)(SSI).zip` becomes "The Shard of Spring") or
  from `--name`.

The emulator (`src/a2/`): `cpu65.js` (6502 and 65C02, cycle counted; passes Klaus Dormann's functional tests),
`machine.js` (memory map, language card, IIe auxiliary memory and 80-column switches, keyboard, speaker, paddles and
buttons), `disk.js` (image loading, 6&2 nibble encoding, Disk II controller with reads, writes and head stepping),
`video.js` (text, 80 column, lo-res, double lo-res, hi-res, double hi-res), `ui.js` (page: keyboard, joystick keys
and gamepad, sound, fast loading, saves). Disk changes are kept in the browser (`localStorage`) and can be exported.

Not supported: copy protection that depends on bit-level disk timing, `.woz` images, hard disks, mouse and
other expansion cards.

Tests (no ROM needed; they use a stub monitor and the disks in `playable/`):

```
node tools/a2test/cpu_test.js 6502_functional_test.bin nmos 3469        # Klaus Dormann test binaries
node tools/a2test/cpu_test.js 65C02_extended_opcodes_test.bin cmos 24f1
node tools/a2test/disk_test.js playable/*.dsk       # image <-> nibble round trip
node tools/a2test/nibble_test.js playable/shard_of_spring_disk2.dsk   # 6502 code reading sectors via the controller
node tools/a2test/write_test.js playable/shard_of_spring_disk2.dsk    # RWTS-style sector write
node tools/a2test/memory_test.js                    # language card, aux memory, soft switches
node tools/a2test/realrom_test.js system.rom game.dsk 15 [disk2.rom] [out.png]   # boot on a real ROM, print the text screen
node tools/a2test/play_test.js system.rom out.png "disk|0|a.dsk" reset "wait|12" "key|\r" "wait|20"   # scripted session
```

---

# The Shard of Spring (SSI, 1986) in the browser

The original, game-specific port (no ROM needed) is described below; `dist/index.html` is one self-contained page. Open it in any modern browser; nothing else has to be
installed. It contains both original game disks and a small runtime that executes the game's own
code, so every rule, map, monster, spell and line of text is the original's.

## How it works

The 1986 game is an Applesoft BASIC program plus a few 6502 machine-code helpers. The page does not
emulate the whole computer; it implements only what the game touches:

| Piece | File | Notes |
| --- | --- | --- |
| Applesoft interpreter | `src/applesoft.js` | Runs the tokenized programs straight from the disk. Generator based, so `GET`/`INPUT` can wait for a key. |
| 6502 CPU | `src/cpu6502.js` | Runs the game's machine code (tile drawing, character output, sound). |
| Machine model | `src/machine.js` | 64K RAM, language card, keyboard, speaker, text/hi-res switches and the monitor ROM routines the game calls. |
| Hi-res video | `src/hires.js` | Applesoft `HPLOT` plus an NTSC colour decoder for the canvas. |
| RDOS file system | `src/dos.js` | Reads the SSI RDOS disk format, serves the `&RECALL/&RUN/&STORE/&DEL/&READ/&PRINT/&END` commands, keeps saves in `localStorage`. |
| Party editor | `src/editor.js` | "Edit party" button: gold, date, and per character level, experience, HP/SP, stats, skills, items and equipment. Edits the running game's memory or a saved `.CHAR` / `PARTYn` file. `node tools/editortest.js` checks it. |
| Spellbook | `src/spells.js` | The game's `BSPELLS` file decoded into a clickable table (school, effect, minimum S.P., where it can be cast). Clicking a spell types its name into the game when a prompt is waiting. `node tools/e2e-spells.js shot.png` checks it end to end. |
| Page | `src/main.js`, `tools/template.html` | Canvas, keyboard, touch pad, sound, restart/erase buttons. |

Notes on behaviour that differs from the real hardware:

* Disk swaps are automatic. The game still shows its "Insert ... disk" prompts; the runtime follows them.
* The disk-serial copy protection ("SOS ID") reports a valid game disk, and the "Make game disk" utility
  (which formats real floppies) is replaced by a short note. Progress is saved in the browser instead.
* Empty `FOR ... NEXT` delay loops are executed at once and then wait about as long as an Apple II
  would, so messages stay on screen; everything else runs faster than the original.

## Rebuilding

```
node tools/build-hle.js      # writes dist/index.html
```

The build reads the disk images from `playable/` (`shard_of_spring_disk1_original_protected.dsk` is the
unmodified starter disk, `shard_of_spring_disk2.dsk` the game disk).

## Tools used to take the disks apart

* `tools/rdos.py` extracts every file from a `.dsk` (`uv run python -I tools/rdos.py disk.dsk outdir`).
  Within a track the file sectors are stored in the order `0,14,13,...,1,15`.
* `tools/basic.py` turns the tokenized BASIC programs back into readable listings.
* `tools/dis6502.py` is a small 6502 disassembler.
* `tools/harness.js`, `play.js`, `fuzz.js`, `tp.js`, `e2e.js` drive the game headless (Node) or in headless
  Edge for regression checks.
