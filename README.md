# The Shard of Spring (SSI, 1986) in the browser

`dist/index.html` is one self-contained page. Open it in any modern browser; nothing else has to be
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
| Page | `src/main.js`, `tools/template.html` | Canvas, keyboard, touch pad, sound, restart/erase buttons. |

Notes on behaviour that differs from the real hardware:

* Disk swaps are automatic. The game still shows its "Insert ... disk" prompts; the runtime follows them.
* The disk-serial copy protection ("SOS ID") reports a valid game disk, and the "Make game disk" utility
  (which formats real floppies) is replaced by a short note. Progress is saved in the browser instead.
* Empty `FOR ... NEXT` delay loops are executed at once and then wait about as long as an Apple II
  would, so messages stay on screen; everything else runs faster than the original.

## Rebuilding

```
node tools/build.js          # writes dist/index.html
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
