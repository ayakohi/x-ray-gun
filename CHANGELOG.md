# What changed

## 1.3.0 — 14 November 2026

**A close plan now carries the page, not only its parts.**
- The web adapter reads the page base (background, text colour, body and heading fonts) and the page's sections from top to bottom, each with its size, background, heading, and whether a photo fills it. A band painted by a child that covers it takes that child's colour.
- `--keep close` hands Brief those lines and five pictures of the page, and Brief writes "The page, top to bottom" ahead of the measured treatments.
- `--keep numbers` opens its look lines with one line for the page itself.

## 1.2.0 — 14 November 2026

- **The build plan can keep the look.** `--keep close|numbers|words` on `brain/next.mjs` sets how much of the measured look Brief carries. `close` is the default: each treatment's full measured style. `numbers` carries the few values that make each look. `words` is the old behaviour. The rules still reach Brief in words, and the check on `6-rules.md` is unchanged.
- The web adapter looks for Chrome, Chromium or Edge in the usual places on macOS and Linux as well as Windows, then on PATH. On Windows it also finds a per-user Chrome install. Not yet run on a Mac or on Linux.
- When the browser runs as root, it starts with its sandbox off and the report says so.
- HAR: a possible secret is listed under Findings by parameter name and address. Its value is never written.
- Watch and Open say "five lists", matching the five they name.
- The Windows-program and zip adapters point to outside tools and no longer mention adapters that were never built.

## 1.1.0 — 14 November 2026

**The question stays hidden until Brief.**
- `NEXT.md` names the case and the target only. The question and destination appear once the read is complete.
- The gun no longer writes the question into `notebook.md`. The notebook is the scan log, and `0-frame.md` is the one place the question lives.
- SKILL.md now gives one method for the question: it goes to `brain/next.mjs` and nowhere else.

**One rule for where a case lives.**
- The brain and the gun share one case-folder rule (`caseFolder` in `lib/case.mjs`). Before, a case name with a space or symbol split into two folders, and the brain never saw the scan.
- `xray.mjs scan --case <name | folder>` reads the target from the case's `0-frame.md`, so the scan command in `NEXT.md` carries no target text.

**Opening untrusted files safely.**
- New `lib/extract.mjs`: every file pulled out of an archive goes through it. Names stay inside the destination, and real bytes count against one budget.
- zip: unpacked size is capped by what is actually produced, and a member that unpacks to a different size than its header claims is set aside. Sizes and offsets are checked against the real file.
- asar: header lengths, offsets and sizes are checked against the real file, and extraction shares the zip budget rules.
- Source maps: recovered files go through the same guard, with a total budget, and maps over 64 MB are listed, not parsed.
- Folders: links are counted and left unfollowed, and the walk limit counts folders too.
- js: files over 8 MB are read only up to 8 MB.
- `readRange` never allocates past the end of the file.

**Commands that are safe to paste.**
- A path goes into a ready-made command only when every character is plain in bash, PowerShell and cmd. Other paths are printed as data to quote by hand.
- The sqlite follow-up is now code for a script file, not a shell one-liner.

**Docs match the code.**
- The rules check before Brief also catches short and long hex colours, `hsl()` and other colour functions, seconds, viewport units, angles and code spans.
- The tag rule names the four steps that tag every line.
- HAR no longer claims payload shapes.
- zip detection also recognises empty and spanned zips, and zip-family extensions.
- README and SKILL.md say plainly that a scanned page runs its own scripts with the computer's network access.

**License:** PolyForm Strict 1.0.0, replacing MIT.

## 1.0.0 — 14 November 2026

First numbered version, at the state of commit `81bf574`.
