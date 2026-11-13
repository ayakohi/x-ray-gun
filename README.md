# x-ray-gun 🔫

*By ayakohi and Cygnus.*

Point it at a thing that already exists — a website, an app, a file, a folder, a database — and it tells you how the thing was built, so you can build your own. The compact, Windows-first cousin of [REA](https://github.com/morluto/rea): the same method, a handful of small adapters instead of a hundred tools, and nothing to install.

```
node xray.mjs scan <file | folder | url> [--case <name>] [--as <adapter>]
node xray.mjs adapters      # what it can open
node xray.mjs cases         # past investigations
```

- **`web`** — loads a page (an address or an `.html` file) in headless Chrome/Edge and hands back **its own words** (headings, visible text, and every link and button with where it leads), its structure, scripts, network, a screenshot, **the real CSS behind each visual effect** (that frosted-glass look, as copy-pasteable rules), and **motion**: what animates on its own, follows the mouse, or changes as you scroll, with a filmstrip.
- **`js`** — maps a JavaScript/Electron project: entry points, imports, libraries (an import is a finding; a text match alone is a guess), Electron windows/IPC/preload bridges, and **recovers original source from source maps**.
- **`asar` / `zip`** — unpack Electron apps and the whole zip family (apk, jar, msix, docx, xpi, ipa…), then scan what's inside.
- **`pe`** — reads a Windows `.exe`/`.dll`'s headers: how it was built and from what. Header facts only; no code interpretation.
- **`sqlite`** — an app's database, read-only: schema, counts, sample rows.
- **`har`** — a saved network capture: requests by host, API calls, payload shapes.
- **`folder` / `generic`** — a folder's inventory, or any unknown file's signature, entropy, strings, and embedded payloads. Nothing is ever "unsupported".

Every scan writes a **case folder** with a notebook and per-scan reports that separate **Findings** (seen), **Guesses** (inferred), and **Still unknown** (not reached). The notebook keeps your question (`--question "..."`) and one line per scan. Adding a new format is one file in `adapters/`.

Needs Node 22.5 or newer and, for `web`, Chrome or Edge. Full guide and the method it follows: [SKILL.md](SKILL.md).

The gun reports how a thing was built. Reading why it was built that way is a separate layer, kept in [brain/](brain/): a draft, not yet wired into the gun.

## Only examine what you own or are allowed to

x-ray-gun is for learning, interoperability, and software you have the right to inspect — not for cracking protection or copying protected assets. Same line REA draws.

## Credit

x-ray-gun is written by **ayakohi** and **Cygnus**.

Method and spirit adapted from [REA](https://github.com/morluto/rea) (MIT). Independent reimplementation, not affiliated. MIT licensed — see [LICENSE](LICENSE).
