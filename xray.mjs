#!/usr/bin/env node
// x-ray-gun: point it at a file, folder or URL; it works out what the thing is, picks the adapter
// that knows that kind, and writes a report into a case folder. See SKILL.md for the method.
//
//   node xray.mjs scan <file|folder|url> [--as <adapter>] [--case <name>] [adapter options]
//   node xray.mjs adapters            list adapters and what they open
//   node xray.mjs cases               list case folders
//
// Adapters live in ./adapters, one file each, and are found automatically.

process.removeAllListeners('warning');   // node:sqlite prints an ExperimentalWarning otherwise

import { readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readHead, identify, sha256File, human } from './lib/bytes.mjs';
import { openCase, newScan, listCases, usage, renderMarkdown, addQuestion, logScan, CASES_ROOT } from './lib/case.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));

// One adapter that cannot load (an older Node, a broken file) is reported and skipped, so the rest still work.
const unloaded = [];
async function loadAdapters() {
  const dir = join(HERE, 'adapters');
  const list = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
    try {
      const mod = (await import(pathToFileURL(join(dir, f)).href)).default;
      if (mod?.name && mod.detect && mod.run) list.push(mod);
    } catch (err) { unloaded.push(`${f}: ${err.message}`); }
  }
  return list;
}

export function describe(input) {
  if (/^https?:\/\//i.test(input)) return { input, kind: 'url', url: input, ext: '', sig: 'web address' };
  const path = resolve(input);
  if (!existsSync(path)) throw new Error(`not found: ${path}`);
  const st = statSync(path);
  if (st.isDirectory()) return { input, kind: 'dir', path, ext: '', sig: 'folder', size: 0 };
  const head = readHead(path, 4096);
  return { input, kind: 'file', path, ext: extname(path).toLowerCase(), size: st.size, head, sig: identify(head) };
}

// Switches that never take a value, so `scan --no-motion <target>` keeps its target.
const SWITCHES = new Set(['deep', 'no-extract', 'no-motion']);

function parseArgs(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2), v = argv[i + 1];
      if (SWITCHES.has(k) || v === undefined || v.startsWith('--')) opts[k] = true; else { opts[k] = v; i++; }
    } else pos.push(a);
  }
  return { pos, opts };
}

async function scan(input, opts, adapters, caseDir) {
  const t = describe(input);
  let adapter;
  if (opts.as) {
    adapter = adapters.find((a) => a.name === opts.as);
    if (!adapter) throw new Error(`no adapter named "${opts.as}". Try: ${adapters.map((a) => a.name).join(', ')}`);
  } else {
    const scored = adapters.map((a) => ({ a, s: a.detect(t) || 0 })).sort((x, y) => y.s - x.s);
    adapter = scored[0].a;
  }
  const scanDir = newScan(caseDir, adapter.name);
  const ctx = {
    caseDir, scanDir, filesDir: join(scanDir, 'files'), opts,
    // Hand a piece of this target (an extracted folder, an embedded file) to whichever adapter fits it,
    // or to the named one. The child gets its own scan folder and report in the same case.
    handoff: (childInput, as) => scan(childInput, as ? { as } : {}, adapters, caseDir),
  };
  const started = Date.now();
  let r;
  try {
    r = await adapter.run(t, ctx);
  } catch (err) {
    r = { summary: `The ${adapter.name} adapter failed: ${err.message}`, unknowns: [`Everything this adapter would have reported. Error: ${err.stack?.split('\n').slice(0, 3).join(' | ')}`] };
  }
  const report = {
    adapter: adapter.name, target: t.url || t.path, detectedAs: t.sig,
    scannedAt: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 100) / 10,
    ...(t.kind === 'file' ? { identity: { size: t.size, sizeHuman: human(t.size), sha256: await sha256File(t.path) } } : {}),
    ...r,
    scanDir,
  };
  writeFileSync(join(scanDir, 'report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(scanDir, 'report.md'), renderMarkdown(report));
  return report;
}

async function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2));
  const cmd = pos[0];
  const adapters = await loadAdapters();

  if (cmd === 'adapters') {
    // Use is read from the case folders, so the list shows which adapters have earned their place.
    const used = usage();
    const day = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    for (const a of adapters) {
      const u = used[a.name];
      console.log(`${a.name.padEnd(9)} ${a.about}\n${' '.repeat(10)}${u ? `used in ${u.cases.size} case${u.cases.size > 1 ? 's' : ''}, ${u.scans} scan${u.scans > 1 ? 's' : ''}, last ${day(u.last)}` : 'not used in any case yet'}`);
    }
    const guests = Object.entries(used).filter(([n]) => !adapters.some((a) => a.name === n));
    for (const [n, u] of guests) console.log(`${n.padEnd(9)} outside tool, results saved in ${u.cases.size} case${u.cases.size > 1 ? 's' : ''}, last ${day(u.last)}`);
    for (const u of unloaded) console.log(`(could not load) ${u}`);
    return;
  }
  if (cmd === 'cases') {
    const cs = listCases();
    if (!cs.length) console.log(`no cases yet (root: ${CASES_ROOT})`);
    for (const c of cs) console.log(`${c.name}  (${c.scans.length} scans)  ${join(CASES_ROOT, c.name)}`);
    return;
  }
  if (cmd !== 'scan' || !pos[1]) {
    console.log('usage: node xray.mjs scan <file|folder|url> [--as <adapter>] [--case <name>] [--question "<what you want to learn>"]\n       node xray.mjs adapters | cases');
    process.exit(cmd ? 1 : 0);
  }

  const input = pos[1];
  const caseDir = openCase(opts.case || basename(input.replace(/[\\/]+$/, '')) || input);
  if (typeof opts.question === 'string') addQuestion(caseDir, opts.question);
  const r = await scan(input, opts, adapters, caseDir);
  logScan(caseDir, r);

  // Print a bounded view; the full report is on disk.
  const md = renderMarkdown(r).split('\n');
  const LIMIT = Number(opts.lines) || 120;
  console.log(md.slice(0, LIMIT).join('\n'));
  if (md.length > LIMIT) console.log(`\n… ${md.length - LIMIT} more lines in the report.`);
  console.log(`\nreport:   ${join(r.scanDir, 'report.md')}\nnotebook: ${join(caseDir, 'notebook.md')}`);
}

main().catch((e) => { console.error(`x-ray-gun: ${e.message}`); process.exit(1); });
