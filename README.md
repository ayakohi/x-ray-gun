# x-ray-gun 🔫

Point it at a thing that already exists — a website, an app, a file, a folder, a database — and it tells you how the thing was built, so you can build your own. The compact, Windows-first cousin of [REA](https://github.com/morluto/rea): the same method, a handful of small adapters instead of a hundred tools, and nothing to install.

```
node xray.mjs scan <file | folder | url> [--case <name>] [--as <adapter>]
node xray.mjs adapters      # what it can open
node xray.mjs cases         # past investigations
```

- **`web`** — loads a page in headless Chrome/Edge and hands back its structure, scripts, network, a screenshot, and **the real CSS behind each visual effect** (that frosted-glass look, as copy-pasteable rules).
- **`js`** — maps a JavaScript/Electron project: entry points, imports, libraries, Electron windows/IPC/preload bridges, and **recovers original source from source maps**.
- **`asar` / `zip`** — unpack Electron apps and the whole zip family (apk, jar, msix, docx, xpi, ipa…), then scan what's inside.
- **`pe`** — reads a Windows `.exe`/`.dll`'s headers: how it was built and from what. Header facts only; no code interpretation.
- **`sqlite`** — an app's database, read-only: schema, counts, sample rows.
- **`har`** — a saved network capture: requests by host, API calls, payload shapes.
- **`folder` / `generic`** — a folder's inventory, or any unknown file's signature, entropy, strings, and embedded payloads. Nothing is ever "unsupported".

Every scan writes a **case folder** with a notebook and per-scan reports that separate **Findings** (seen), **Guesses** (inferred), and **Still unknown** (not reached). Adding a new format is one file in `adapters/`.

Needs Node 18+ and, for `web`, Chrome or Edge. Full guide and the method it follows: [SKILL.md](SKILL.md).

## Only examine what you own or are allowed to

x-ray-gun is for learning, interoperability, and software you have the right to inspect — not for cracking protection or copying protected assets. Same line REA draws.

## Credit

Method and spirit adapted from [REA](https://github.com/morluto/rea) (MIT). Independent reimplementation, not affiliated. MIT licensed — see [LICENSE](LICENSE).
