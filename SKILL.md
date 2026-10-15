---
name: x-ray-gun
description: Take apart something that already exists — a website, an app, a file, a folder, a database — to learn how a feature or a look was built, then rebuild it yourself. Load when the user wants to understand how some app or site does a thing (a visual effect, an interaction, a data format), inspect or identify an unknown file, pull apart an Electron/web/desktop app, read an app's database, or reverse-engineer anything they own or are allowed to examine. Point it at a file, folder, or URL.
---

# x-ray-gun

A small kit for looking inside something that exists so you can rebuild it. You run one command, it works out what the thing is, opens it with the adapter that knows that kind, and writes a report into a case folder. It is the compact, Windows-first cousin of REA (github.com/morluto/rea) — same method, a handful of tools instead of a hundred, no install.

**Use it when** a question depends on a shipped thing: "how does this site make that frosted glass?", "what's in this app?", "what is this file?", "what does this app store in its database?". **Skip it** for ordinary source code you already have — just read that.

## The point in one line

See how something was made → study the evidence → build your own version. Observe, don't pirate: the output is understanding, not a copy.

## Run it

```
node <skill>/xray.mjs scan <file | folder | url> [--case <name>] [--as <adapter>]
node <skill>/xray.mjs adapters      # what it can open
node <skill>/xray.mjs cases         # past investigations
```

`<skill>` is this folder. Examples:

```
node xray.mjs scan https://example.com --case glassy-site
node xray.mjs scan "C:/Users/me/AppData/Local/SomeApp" --case someapp
node xray.mjs scan ./mystery.bin
```

It prints a trimmed report and the path to the full one. Everything lands in a **case folder** (default `~/.x-ray-gun/cases/<name>/`): a `notebook.md` and one dated sub-folder per scan holding `report.md`, `report.json`, and any files pulled out.

Needs only Node 18+ and, for the `web` adapter, Chrome or Edge (set `XRAY_BROWSER` to override the path). Nothing to install.

## The method (do this, in order)

1. **Name the thing first.** File, folder, or URL? The gun auto-routes, but know what you handed it. One `scan` is one look at one thing.
2. **Read the summary, then drill.** Each report leads with a summary and a `Next shots` list. Follow a shot only when a real question is still open — don't scan everything because you can.
3. **Label every claim.** Each report separates **Findings** (seen in the bytes/DOM), **Guesses** (inferred, say what would confirm them), and **Still unknown** (what it couldn't reach). Carry those labels into what you tell the user. Reading files never proves runtime behaviour — don't claim the app *does* X from static text alone.
4. **Keep the notebook.** Put the user's real questions at the top of `notebook.md`, mark each answered / partial / open, and don't call the job done while one is open.
5. **Follow one thread.** To find a feature, pick one clue it must contain — the visible text, a CSS class, an API path, an IPC channel — and search the extracted files for it. That beats reading everything.
6. **Static first, live only when needed.** Read the shipped files before running anything. Use the `web` adapter (which runs the page) when the look depends on what happens live.

## What it opens

| You have | Adapter | It gives you |
|---|---|---|
| a URL | `web` | structure, scripts, libraries, network, **a screenshot, the real CSS behind each visual effect, the big images/videos, and motion**: what moves on its own, what follows the pointer, and what scrolling does (fades, slides, pins, parallax, scale), plus a filmstrip of one frame per scroll step |
| a website/app's code folder, or a `.js` bundle | `js` | entry points, import map, libraries, Electron windows/IPC/preload, **recovered original source from source maps** |
| `app.asar` (Electron) | `asar` | unpacks the app's code, then runs `js` on it |
| `.zip .apk .jar .msix .docx .xpi .ipa .whl …` | `zip` | member list, names the flavour, extracts, then runs `folder` on it |
| `.exe .dll .node` (Windows) | `pe` | how it was built and from what (header facts only — **no code interpretation**) |
| `.sqlite .db` | `sqlite` | schema, row counts, a few sample rows (read-only) |
| `.har` | `har` | requests by host, API calls, payload shapes |
| a folder | `folder` | inventory by kind, the files that explain it, what to scan next |
| anything else | `generic` | signature, entropy, strings, embedded payloads — **never just "unsupported"** |

Force one with `--as <adapter>`. Useful options: `--deep` (js: include node_modules), `--rows N` (sqlite), `--no-extract` (zip), `--no-motion` / `--steps N` (web: skip motion capture, or cap the scroll steps; default 16), `--lines N` (how much to print).

### Reading the web adapter's motion lines

- **moves on its own**: changed while nobody touched the page (looping animation, autoplay, a ticker).
- **follows the pointer**: changed while the mouse swept across the first screen (parallax, tilt, custom cursor).
- **on scroll**: changed while the gun wheel-scrolled down like a person. `fades in`, `slides Y 50px → 0px`, `scales`, `rotates` describe the change; `pinned` means it stayed on screen while the page moved; `parallax 0.6×` means it scrolled slower than the page; `starts near scrollY N` is where it kicks in.
- **animation "name"**: a CSS/Web Animation the browser itself reports, with its duration and easing.
- `×N` means N copies of the same element did the same thing (letters split for animation, a grid of cards).

Then open `files/scroll/` to watch it as a filmstrip and confirm.

## Add an adapter (this is the cheap part)

Drop one file in `adapters/`. It exports a default object:

```js
export default {
  name: 'thing',
  about: 'one line for the adapters list',
  detect(t) { return t.ext === '.thing' ? 90 : 0; },   // 0 = not mine; highest score wins
  async run(t, ctx) {
    // t: { kind:'file'|'dir'|'url', path/url, ext, size, head (first 4KB), sig }
    // ctx: { filesDir (write pulled files here), opts, handoff(input, adapterName) }
    return {
      kind: 'Thing',
      summary: 'one or two sentences',
      facts: {}, findings: [], guesses: [], unknowns: [], next: [], inventory: [], files: [],
    };
  },
};
```

`detect` returns a confidence score so new adapters slot in without touching the router. `ctx.handoff(folder, 'js')` lets your adapter hand a piece of the target to another adapter; its report nests under yours. Return the shared report shape and the renderer and notebook handle the rest.

## Limits, said plainly

- **No decompiling of machine code.** The `pe` adapter reads headers, not instructions. For a compiled program whose logic you truly need (e.g. a game), run the real REA once: `npx -y rea-agents@latest` with Ghidra. A `ghidra` adapter could be added here later.
- **Android/iOS code is compiled.** `zip` lists an APK/IPA and extracts it, but turning it back into readable Java/Swift needs JADX or similar — not bundled.
- **One viewport, no clicks.** `web` works at 1280×900, scrolls and sweeps the mouse, but doesn't click, type, or log in. Motion is sampled per scroll step, not per frame, and hover on individual buttons isn't tested.
- **Only examine what you own or are allowed to.** Same line REA draws. The gun is for learning and interoperability, not cracking protection or copying protected assets.

## Credit

Method and spirit adapted from REA (MIT, github.com/morluto/rea). This is an independent, much smaller reimplementation — not REA, and not affiliated with it.
