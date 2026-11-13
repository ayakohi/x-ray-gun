// JavaScript / TypeScript projects and bundles, Electron apps included: manifest, entry points,
// import map, frameworks, Electron windows / IPC / preload bridges, and source maps (recovered to
// readable files when they carry their sources).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename, normalize, sep } from 'node:path';
import { walk } from './folder.mjs';
import { human } from '../lib/bytes.mjs';

const CODE = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.html', '.htm']);
const PER_FILE = 8 * 1024 * 1024;

// [name, text pattern, package names]. An import of one of the packages is evidence the code uses
// the library. The text pattern alone is only a lead: it also matches a name inside a string, a
// comment, or a detector list like this one.
const LIBS = [
  ['React', /\bReact(?:DOM)?\b|__REACT_DEVTOOLS|react-dom/, ['react', 'react-dom']], ['Vue', /\bcreateApp\(|__VUE__|vue\.runtime/, ['vue']], ['Svelte', /svelte\/internal|SvelteComponent/, ['svelte']],
  ['Angular', /@angular\/core|ɵcmp/, ['@angular/core']], ['Next.js', /__NEXT_DATA__|next\/router/, ['next']], ['Three.js', /\bTHREE\.|WebGLRenderer/, ['three']],
  ['PixiJS', /\bPIXI\.|pixi\.js/, ['pixi.js', '@pixi/core']], ['GSAP', /\bgsap\.|TweenMax|ScrollTrigger/, ['gsap']], ['Framer Motion', /framer-motion|motion\.div/, ['framer-motion', 'motion']],
  ['Lottie', /lottie|bodymovin/, ['lottie-web', 'lottie-react']], ['Tailwind', /--tw-|tailwind/, ['tailwindcss']], ['jQuery', /\bjQuery\b/, ['jquery']], ['Electron', /require\(['"]electron['"]\)|from ['"]electron['"]/, ['electron']],
  ['WebGL / shaders', /gl_FragColor|getContext\(['"]webgl2?|precision (?:high|medium)p float/, []], ['Canvas 2D', /getContext\(['"]2d['"]\)/, []],
  ['Web Workers', /new Worker\(/, []], ['WebAssembly', /WebAssembly\.instantiate/, []], ['Service Worker', /serviceWorker\.register/, []],
];

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

function sourceMaps(files, dest) {
  const maps = files.filter((f) => f.ext === '.map');
  const recovered = [];
  for (const m of maps.slice(0, 200)) {
    try {
      const j = JSON.parse(readFileSync(m.path, 'utf8'));
      if (!Array.isArray(j.sourcesContent)) continue;
      j.sources.forEach((s, i) => {
        const text = j.sourcesContent[i];
        if (typeof text !== 'string') return;
        const rel = normalize(String(s).replace(/^[a-z]+:\/\/+/i, '').replace(/^(\.\.[\\/])+/, '').replace(/[?#].*$/, '').replace(/[:*?"<>|]/g, '_'));
        if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) return;
        const out = join(dest, rel);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, text);
        recovered.push(rel);
      });
    } catch { /* not a usable map */ }
  }
  return { maps: maps.length, recovered };
}

export default {
  name: 'js',
  about: 'JavaScript/TypeScript project or bundle (Electron too): entries, imports, libraries, IPC, source maps',
  detect(t) {
    if (t.kind === 'dir') return existsSync(join(t.path, 'package.json')) ? 60 : 0;
    return ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'].includes(t.ext) ? 70 : 0;
  },
  async run(t, ctx) {
    const root = t.kind === 'dir' ? t.path : dirname(t.path);
    const deep = !!ctx.opts.deep;
    const { files, skipped } = t.kind === 'dir' ? walk(root, { skip: deep ? ['.git'] : ['node_modules', '.git'] }) : { files: [{ path: t.path, rel: basename(t.path), size: t.size, ext: t.ext }], skipped: {} };
    const code = files.filter((f) => CODE.has(f.ext));

    let pkg = null;
    try { pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch { /* none */ }
    let modulesInstalled = [];
    try { modulesInstalled = readdirSync(join(root, 'node_modules')).filter((n) => !n.startsWith('.')); } catch { /* none */ }

    const findings = [], guesses = [], unknowns = [];
    const textHits = {}, imports = {}, importedIn = {}, ipc = { main: {}, renderer: {} }, bridges = [], windows = [];
    let minified = 0, partial = 0;

    for (const f of code) {
      let src;
      try { src = readFileSync(f.path, 'utf8'); } catch { continue; }
      if (src.length > PER_FILE) { partial++; src = src.slice(0, PER_FILE); }
      const lines = src.split('\n');
      if (src.length > 5000 && src.length / lines.length > 400) minified++;

      for (const [name, re] of LIBS) if (!textHits[name] && re.test(src)) textHits[name] = f.rel;

      for (const m of src.matchAll(/(?:import\s[^'"`;]*?from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"\n]{1,120})['"]/g)) {
        const spec = m[1];
        const key = spec.startsWith('.') || spec.startsWith('/') ? '(local files)' : spec.startsWith('node:') ? spec : spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
        imports[key] = (imports[key] || 0) + 1;
        importedIn[key] ??= `${f.rel}:${lineOf(src, m.index)}`;
      }
      for (const m of src.matchAll(/ipcMain\.(?:handle|on|once)\(\s*['"`]([^'"`]+)['"`]/g)) (ipc.main[m[1]] ??= []).push(`${f.rel}:${lineOf(src, m.index)}`);
      for (const m of src.matchAll(/ipcRenderer\.(?:invoke|send|sendSync|on)\(\s*['"`]([^'"`]+)['"`]/g)) (ipc.renderer[m[1]] ??= []).push(`${f.rel}:${lineOf(src, m.index)}`);
      for (const m of src.matchAll(/contextBridge\.exposeInMainWorld\(\s*['"`]([^'"`]+)['"`]/g)) bridges.push({ what: `preload exposes window.${m[1]} to the page`, evidence: `${f.rel}:${lineOf(src, m.index)}` });
      for (const m of src.matchAll(/new BrowserWindow\(/g)) {
        const snippet = src.slice(m.index, m.index + 900);
        const flags = ['transparent', 'frame', 'vibrancy', 'backgroundMaterial', 'titleBarStyle', 'nodeIntegration', 'contextIsolation', 'sandbox', 'preload', 'alwaysOnTop']
          .map((k) => { const x = snippet.match(new RegExp(`\\b${k}\\s*:\\s*([^,}\\n]{1,60})`)); return x ? `${k}: ${x[1].trim()}` : null; }).filter(Boolean);
        windows.push({ what: `BrowserWindow${flags.length ? ` { ${flags.join(', ')} }` : ''}`, evidence: `${f.rel}:${lineOf(src, m.index)}` });
      }
    }

    if (pkg) {
      findings.push({ what: `package: ${pkg.name || '(unnamed)'} ${pkg.version || ''}${pkg.main ? `, entry ${pkg.main}` : ''}`, evidence: 'package.json' });
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      if (deps.length) findings.push({ what: `declares ${deps.length} dependencies: ${deps.slice(0, 25).join(', ')}${deps.length > 25 ? ' …' : ''}`, evidence: 'package.json' });
    }
    // A library is a finding when the code imports it. A text pattern with no import behind it is a guess.
    const imported = [], textOnly = [];
    for (const [name, , packages] of LIBS) {
      const hit = packages.find((p) => importedIn[p]);
      if (hit) { imported.push(name); findings.push({ what: `imports ${name} (${hit})`, evidence: importedIn[hit] }); }
      else if (textHits[name]) textOnly.push(name);
    }
    if (textOnly.length) guesses.push(`Text patterns for ${textOnly.length} more ${textOnly.length > 1 ? 'libraries or browser features' : 'library or browser feature'} appear with no import behind them: ${textOnly.map((n) => `${n} (${textHits[n]})`).join(', ')}. In a bundle this is often real use with the import compiled away. In plain source it can be a name inside a string, a comment, or a detector list. Open the file to confirm.`);
    findings.push(...windows.slice(0, 10), ...bridges.slice(0, 15));
    const channels = new Set([...Object.keys(ipc.main), ...Object.keys(ipc.renderer)]);
    for (const c of [...channels].slice(0, 40)) {
      const a = ipc.main[c]?.[0], b = ipc.renderer[c]?.[0];
      findings.push({ what: `IPC channel "${c}"${a && b ? ': page → main paired' : a ? ': main side only' : ': page side only'}`, evidence: [b, a].filter(Boolean).join(' → ') });
    }

    const sm = sourceMaps(files, join(ctx.filesDir, 'recovered-sources'));
    if (sm.recovered.length) findings.push({ what: `recovered ${sm.recovered.length} original source files from ${sm.maps} source maps`, evidence: 'files/recovered-sources/' });
    else if (sm.maps) guesses.push(`${sm.maps} source maps exist but carry no embedded sources; the original files may be fetchable from the URLs inside them.`);

    if (minified) guesses.push(`${minified} files look minified: names are shortened, so follow strings (UI text, CSS class names, IPC channels, URLs), not variable names.`);
    // Minified code renames ipcMain, BrowserWindow and friends, so a count of zero found by name is no evidence of none.
    if (minified && (!channels.size || !windows.length || !bridges.length)) unknowns.push(`Windows, IPC channels and preload bridges are found by their usual names (ipcMain, BrowserWindow, contextBridge). ${minified} files are minified and may have renamed them, so the counts here (${channels.size} channels, ${windows.length} windows, ${bridges.length} bridges) are a floor. Search the extracted files for ".handle(" and "webPreferences" to find the rest.`);
    if (partial) unknowns.push(`${partial} files are over ${human(PER_FILE)}; only their first part was scanned.`);
    if (skipped.node_modules) unknowns.push(`node_modules skipped (${modulesInstalled.length} packages installed). Re-run with --deep to include it.`);
    unknowns.push('This is a read of the text only. Which code actually runs, and with what values, needs the app running. The web adapter can run a page from an address or an .html file; a running Electron window is out of its reach for now.');

    const topImports = Object.entries(imports).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => `${k}  ×${v}`);
    return {
      kind: imported.includes('Electron') ? 'Electron app (JavaScript)' : 'JavaScript project / bundle',
      summary: `${code.length} code files${minified ? ` (${minified} minified)` : ''}. Libraries imported: ${imported.join(', ') || 'none recognised'}.${textOnly.length ? ` Text match only: ${textOnly.join(', ')}.` : ''} ${channels.size} IPC channels, ${windows.length} windows, ${bridges.length} preload bridges.`,
      facts: { codeFiles: code.length, totalFiles: files.length, sourceMaps: sm.maps, recoveredSources: sm.recovered.length },
      findings, guesses, unknowns,
      next: [`Grep ${root} for the feature's visible text or CSS class, then read the hit with its surrounding lines.`, sm.recovered.length ? `Prefer ${join(ctx.filesDir, 'recovered-sources')} over the minified bundle: it is the authors' original code.` : null].filter(Boolean),
      inventory: topImports,
      files: sm.recovered.length ? ['files/recovered-sources/'] : [],
    };
  },
};
