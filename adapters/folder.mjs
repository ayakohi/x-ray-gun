// Any folder: what is in it, by kind and size, and which files deserve their own scan.

import { readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { human, readHead, identify } from '../lib/bytes.mjs';
import { XRAY } from '../lib/case.mjs';

export function walk(root, { skip = ['node_modules', '.git'], limit = 50000 } = {}) {
  const out = [], skipped = {};
  const stack = [root];
  while (stack.length && out.length < limit) {
    const dir = stack.pop();
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) {
        if (skip.includes(n)) { skipped[n] = (skipped[n] || 0) + 1; continue; }
        stack.push(p);
      } else out.push({ path: p, rel: relative(root, p), size: st.size, ext: extname(n).toLowerCase() });
    }
  }
  return { files: out, skipped, truncated: out.length >= limit };
}

// Source files by language, so a folder of loose code is named as code.
const LANGS = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.cs': 'C#', '.swift': 'Swift',
  '.c': 'C / C++', '.h': 'C / C++', '.cpp': 'C / C++', '.rb': 'Ruby', '.php': 'PHP',
};

// Files that usually explain a folder, in the order to look at them.
const TELLS = [
  [/(^|[\\/])readme(\.(md|txt|rst))?$/i, "README, the maker's own description", null],
  [/(^|[\\/])app\.asar$/i, 'Electron app archive', 'asar'],
  [/(^|[\\/])package\.json$/i, 'Node / JavaScript project manifest', 'js'],
  [/(^|[\\/])(pyproject\.toml|requirements\.txt)$/i, 'Python project manifest', null],
  [/(^|[\\/])Cargo\.toml$/i, 'Rust project manifest', null],
  [/(^|[\\/])go\.mod$/i, 'Go project manifest', null],
  [/\.exe$|\.dll$/i, 'Windows program or library', null],
  [/(^|[\\/])AndroidManifest\.xml$/i, 'Android app manifest', null],
  [/(^|[\\/])AppxManifest\.xml$/i, 'Windows Store app manifest', null],
  [/(^|[\\/])Info\.plist$/i, 'macOS / iOS app manifest', null],
  [/\.(sqlite3?|db)$/i, 'database', 'sqlite'],
  [/\.har$/i, 'saved network capture', 'har'],
  [/\.pak$|\.pck$|\.unity3d$|\.assets$|\.uasset$/i, 'game engine asset pack', null],
  [/(^|[\\/])index\.html?$/i, 'web page entry', 'web'],
];

export default {
  name: 'folder',
  about: 'any folder: inventory by kind, the files that explain it, what to scan next',
  detect: (t) => (t.kind === 'dir' ? 10 : 0),
  async run(t) {
    const { files, skipped, truncated } = walk(t.path);
    const byExt = {};
    for (const f of files) { const e = f.ext || '(none)'; byExt[e] ??= { n: 0, bytes: 0 }; byExt[e].n++; byExt[e].bytes += f.size; }
    const kinds = Object.entries(byExt).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 15).map(([e, v]) => `${e}: ${v.n} files, ${human(v.bytes)}`);
    const total = files.reduce((s, f) => s + f.size, 0);

    const findings = [], next = [];
    for (const [re, what, adapter] of TELLS) {
      const hits = files.filter((f) => re.test(f.rel)).sort((a, b) => a.rel.length - b.rel.length).slice(0, 3);
      for (const h of hits) {
        findings.push({ what: `${what}`, evidence: h.rel });
        if (adapter) next.push(`${XRAY} scan "${h.path}"`);
        else if (/^README/.test(what)) next.push(`Read ${h.path} first: it is the maker saying what this is.`);
      }
    }
    const langs = {};
    for (const f of files) if (LANGS[f.ext]) langs[LANGS[f.ext]] = (langs[LANGS[f.ext]] || 0) + 1;
    const langList = Object.entries(langs).sort((a, b) => b[1] - a[1]);
    if (langList.length) findings.push({ what: `source code: ${langList.map(([l, n]) => `${n} ${l}`).join(', ')} files`, evidence: 'file extensions' });
    const scripty = (langs.JavaScript || 0) + (langs.TypeScript || 0);
    if (scripty >= 3 && !files.some((f) => /(^|[\\/])package\.json$/i.test(f.rel))) next.push(`${XRAY} scan "${t.path}" --as js   (loose JavaScript with no package.json: map its imports and entry points)`);
    const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 10);
    for (const b of biggest.slice(0, 5)) {
      if (b.size > 1024 * 1024) findings.push({ what: `large file (${human(b.size)}, ${identify(readHead(b.path, 600))})`, evidence: b.rel });
    }

    return {
      kind: 'folder',
      summary: `${files.length}${truncated ? '+' : ''} files, ${human(total)}. Biggest kinds: ${kinds.slice(0, 4).join('; ')}.`,
      facts: { files: files.length, total: human(total), skippedFolders: skipped },
      findings,
      guesses: findings.length ? [] : ['No README, manifest or source code was found among the names this adapter knows. The folder may still explain itself another way: scan the largest files one by one.'],
      unknowns: Object.keys(skipped).length ? [`Skipped folders: ${Object.keys(skipped).join(', ')} (pass a path inside one to scan it).`] : [],
      next: [...new Set(next)].slice(0, 8),
      inventory: kinds,
    };
  },
};
