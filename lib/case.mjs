// Case folders: where every scan writes its report and any files it pulls out.
// Layout: <cases root>/<case>/notebook.md and <case>/<scan>/report.json, report.md, files/

import { mkdirSync, existsSync, writeFileSync, readFileSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// The exact command to fire the gun again, for "next shots" lines a cold reader can paste.
export const XRAY = `node "${fileURLToPath(new URL('../xray.mjs', import.meta.url))}"`;

export const CASES_ROOT =process.env.XRAY_CASES || join(homedir(), '.x-ray-gun', 'cases');

export const slug = (s) => String(s).replace(/^[a-z]+:\/\//i, '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'target';

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export function openCase(name) {
  const dir = join(CASES_ROOT, slug(name));
  mkdirSync(dir, { recursive: true });
  const nb = join(dir, 'notebook.md');
  if (!existsSync(nb)) writeFileSync(nb, NOTEBOOK(name));
  return dir;
}

// Scans live in <case>/scans/. Two scans by one adapter in the same second get -2, -3 … so neither overwrites the other.
export function newScan(caseDir, adapter) {
  const base = join(caseDir, 'scans', `${stamp()}-${adapter}`);
  let dir = base;
  for (let n = 2; existsSync(dir); n++) dir = `${base}-${n}`;
  mkdirSync(join(dir, 'files'), { recursive: true });
  return dir;
}

// Puts the person's question at the top of the notebook's Questions list.
export function addQuestion(caseDir, question) {
  const nb = join(caseDir, 'notebook.md');
  const text = readFileSync(nb, 'utf8');
  const line = `- [ ] ${question.trim()}`;
  if (text.includes(line)) return;
  const blank = text.indexOf('\n- [ ]\n');
  const at = text.indexOf('\n## Findings');
  const next = blank >= 0 ? text.replace('\n- [ ]\n', `\n${line}\n`)
    : at >= 0 ? `${text.slice(0, at).trimEnd()}\n${line}\n${text.slice(at)}`
    : `${text.trimEnd()}\n${line}\n`;
  writeFileSync(nb, next);
}

// Adds one line per scan to the notebook, so a cold reader can find every report from one file.
export function logScan(caseDir, r) {
  const nb = join(caseDir, 'notebook.md');
  const text = readFileSync(nb, 'utf8');
  const head = text.includes('\n## Scans') ? '' : '\n## Scans\n<!-- One line per scan, written by the gun. -->\n';
  const summary = String(r.summary || '').replace(/\s+/g, ' ').slice(0, 200);
  appendFileSync(nb, `${head}- ${r.scannedAt.slice(0, 16).replace('T', ' ')} · ${r.adapter} · ${r.target} — ${summary} Report: \`${join(r.scanDir, 'report.md')}\`\n`);
}

// A scan folder is named <date>-<time>-<tool>. Older cases keep theirs at the case root; both places are read.
const SCAN_NAME = /^(\d{8})-\d{6}-([a-z0-9]+)/i;
const dirsIn = (p) => (existsSync(p) ? readdirSync(p).filter((s) => SCAN_NAME.test(s) && statSync(join(p, s)).isDirectory()) : []);

export function listCases() {
  if (!existsSync(CASES_ROOT)) return [];
  return readdirSync(CASES_ROOT).filter((d) => statSync(join(CASES_ROOT, d)).isDirectory()).map((d) => ({
    name: d,
    scans: [...dirsIn(join(CASES_ROOT, d)), ...dirsIn(join(CASES_ROOT, d, 'scans'))],
  }));
}

// How much each tool has been used, read from the scan folder names: { tool: { cases, scans, last } }.
export function usage() {
  const out = {};
  for (const c of listCases()) {
    for (const s of c.scans) {
      const [, date, tool] = s.match(SCAN_NAME);
      const u = (out[tool] ??= { cases: new Set(), scans: 0, last: '' });
      u.cases.add(c.name); u.scans++;
      if (date > u.last) u.last = date;
    }
  }
  return out;
}

const NOTEBOOK = (name) => `# Case: ${name}

## Questions
<!-- One line each. Mark: [ ] open, [~] partly answered, [x] answered. -->
- [ ]

## Findings
<!-- Each finding names where it came from: report path, file:line, selector, or offset. -->

## Guesses
<!-- Things that look true but were not directly seen. Say what would confirm them. -->

## Still unknown
<!-- What the scans could not reach, and what tool or access would reach it. -->
`;

// What a parent report keeps of a handed-off child: enough to know it ran and where to read it.
export const brief = (r) => ({ adapter: r.adapter, kind: r.kind, target: r.target, summary: r.summary, scanDir: r.scanDir });

// The report every adapter returns, rendered for humans.
export function renderMarkdown(r, depth = 1) {
  const h = '#'.repeat(Math.min(depth, 5));
  const L = [];
  L.push(`${h} ${r.kind || r.adapter} — ${r.target}`);
  if (r.summary) L.push('', r.summary);
  if (depth > 1 && r.scanDir) L.push('', `Full report: \`${join(r.scanDir, 'report.md')}\``);
  if (r.facts && Object.keys(r.facts).length) {
    L.push('', `${h}# Facts`);
    for (const [k, v] of Object.entries(r.facts)) L.push(`- **${k}:** ${typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  for (const [title, key] of [['Findings', 'findings'], ['Guesses', 'guesses'], ['Still unknown', 'unknowns'], ['Next shots', 'next']]) {
    const list = r[key];
    if (!list?.length) continue;
    L.push('', `${h}# ${title}`);
    for (const f of list) {
      if (typeof f === 'string') L.push(`- ${f}`);
      else L.push(`- ${f.what}${f.evidence ? `  — \`${f.evidence}\`` : ''}`);
    }
  }
  if (r.inventory?.length) {
    L.push('', `${h}# Inventory (${r.inventory.length}${r.inventoryTotal > r.inventory.length ? ` of ${r.inventoryTotal}` : ''})`);
    for (const i of r.inventory.slice(0, 80)) L.push(`- ${typeof i === 'string' ? i : Object.values(i).join('  ·  ')}`);
    if (r.inventory.length > 80) L.push(`- … ${r.inventory.length - 80} more in report.json`);
  }
  if (r.files?.length) {
    L.push('', `${h}# Files written`);
    for (const f of r.files) L.push(`- ${f}`);
  }
  for (const c of r.children || []) L.push('', renderMarkdown(c, depth + 1));
  return L.join('\n');
}
