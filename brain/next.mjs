#!/usr/bin/env node
// The pointer. Looks at which files a case folder holds, works out the next step of the read, and
// writes it to NEXT.md in that folder (and prints it). Run it again after every step.
//
//   node next.mjs <case name | case folder> [--target <file|folder|url>] [--question "..."] [--destination "..."]
//
// The first run needs the question and the destination. Everything after that is read from the folder.

import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, isAbsolute, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const GUN = join(HERE, '..', 'xray.mjs');
const CASES_ROOT = process.env.XRAY_CASES || join(homedir(), '.x-ray-gun', 'cases');

// The sequence. A step is done when its output files exist, and ready when the files it needs exist.
const STEPS = [
  { name: 'Survey', station: '1-survey.md', out: ['1-survey.md', 'glossary.md'], needs: ['0-frame.md'] },
  { name: 'Watch', station: '2-watch.md', out: ['2-behaviour.md'], needs: ['1-survey.md', 'glossary.md'] },
  { name: 'Open', station: '3-open.md', out: ['3-build.md'], needs: ['1-survey.md', 'glossary.md'] },
  { name: 'Decide', station: '4-decide.md', out: ['4-read.md', '5-rules.md'], needs: ['2-behaviour.md', '3-build.md'] },
  { name: 'Brief', station: '5-brief.md', out: ['6-brief.md'], needs: ['5-rules.md'], alone: true },
];

function args(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { opts[argv[i].slice(2)] = argv[i + 1]; i++; } else pos.push(argv[i]);
  }
  return { pos, opts };
}

// Every scan folder in the case, oldest first, with the files a first look needs.
function scans(dir) {
  const root = join(dir, 'scans');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => statSync(join(root, d)).isDirectory()).sort().map((d) => {
    const s = join(root, d), files = join(s, 'files'), scroll = join(files, 'scroll');
    const frames = existsSync(scroll) ? readdirSync(scroll).sort().map((f) => join(scroll, f)) : [];
    return { dir: s, report: existsSync(join(s, 'report.md')) ? join(s, 'report.md') : null,
      text: existsSync(join(files, 'text.md')) ? join(files, 'text.md') : null,
      shot: existsSync(join(files, 'screenshot.png')) ? join(files, 'screenshot.png') : null, frames };
  });
}

function surveyMaterials(list) {
  const L = [];
  for (const s of list) {
    if (s.report) L.push(`- ${s.report} — a scan report.`);
    if (s.text) L.push(`- ${s.text} — the thing's own words, with every link and button.`);
    if (s.shot) L.push(`- ${s.shot} — the first screen.`);
    if (s.frames.length) {
      // Four frames spread evenly, chosen here so the survey reader spends nothing on opening them.
      const n = Math.min(4, s.frames.length);
      const pick = [...new Set(Array.from({ length: n }, (_, i) => s.frames[Math.round(i * (s.frames.length - 1) / Math.max(1, n - 1))]))];
      L.push(`  Frame paths for the Watch list, top to bottom (copy them into Watch reads; leave them unopened):`, ...pick.map((f) => `  - ${f}`));
    }
  }
  return L.join('\n');
}

// Names the watcher and the second reader coined move into the glossary, once each.
function mergeNames(dir) {
  const g = join(dir, 'glossary.md');
  if (!existsSync(g)) return;
  let have = readFileSync(g, 'utf8');
  for (const f of ['2-behaviour.md', '3-build.md']) {
    const p = join(dir, f);
    if (!existsSync(p)) continue;
    const part = readFileSync(p, 'utf8').split(/\n\**#*\s*\**New names\**\s*\n/i)[1];
    if (!part) continue;
    for (const line of part.split('\n').filter((l) => /^- \*\*/.test(l))) {
      const name = line.match(/^- \*\*(.+?)\*\*/)[1];
      if (!have.includes(`**${name}**`)) { appendFileSync(g, `${have.endsWith('\n') ? '' : '\n'}${line}\n`); have += `\n${line}\n`; }
    }
  }
}

// The rules file is the wall between the study and the rebuild: it carries words, never exact values.
function valuesIn(dir) {
  const p = join(dir, '5-rules.md');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\d+(\.\d+)?\s?(px|rem|em|ms|%)|\brgba?\(|#[0-9a-f]{6}\b/i.test(l)).map(([n]) => n);
}

function main() {
  const { pos, opts } = args(process.argv.slice(2));
  if (!pos[0]) { console.log('usage: node next.mjs <case name | case folder> [--target <file|folder|url>] [--question "..."] [--destination "..."]'); process.exit(1); }
  const dir = isAbsolute(pos[0]) ? pos[0] : join(CASES_ROOT, pos[0]);
  mkdirSync(dir, { recursive: true });
  const name = basename(dir);
  const has = (f) => existsSync(join(dir, f));
  const self = `node "${join(HERE, 'next.mjs')}" "${dir}"`;
  const L = [];

  // Step 0: the frame, in the person's own words.
  if (!has('0-frame.md')) {
    if (opts.question && opts.destination) {
      writeFileSync(join(dir, '0-frame.md'), `# Frame\n\n- **Target:** ${opts.target || '(not given)'}\n- **Question:** ${opts.question}\n- **Destination:** ${opts.destination}\n`);
    } else {
      L.push('# Next: Frame', '', 'Ask the person two things, then run this again with their answers:', '', '1. What do you want to learn from this thing?', '2. What are you building yourself?', '', '```', `${self} --target "<file, folder or address>" --question "<their answer 1>" --destination "<their answer 2>"`, '```');
      return finish(dir, L);
    }
  }
  const frame = readFileSync(join(dir, '0-frame.md'), 'utf8');
  const field = (k) => (frame.match(new RegExp(`\\*\\*${k}:\\*\\*\\s*(.+)`)) || [])[1] || '';
  const list = scans(dir);
  mergeNames(dir);

  const done = [`- [x] Frame — 0-frame.md`];
  if (list.length) done.push(`- [x] Scan — ${list.length} in scans/`);
  for (const s of STEPS) if (s.out.every(has)) done.push(`- [x] ${s.name} — ${s.out.join(', ')}`);
  const head = (title) => L.push(`# Next: ${title}`, '', `Case **${name}** · Question: ${field('Question')} · Destination: ${field('Destination')}`, '', '## Done', ...done, '');

  // Collect the material before any reading starts.
  if (!list.length) {
    head('Scan');
    L.push('## Now', '', 'Collect the material. Run the gun on the target:', '', '```', `node "${GUN}" scan "${field('Target')}" --case "${name}"`, '```', '',
      'When the gun cannot open this kind of thing (a picture, a video, a compiled program), follow "When the gun runs out" in the gun\'s SKILL.md and save what the outside tool gives you in `scans/<date>-<tool>/` with a `report.md`.', '', '## Then', '', '```', self, '```');
    return finish(dir, L);
  }

  const bad = valuesIn(dir);
  const ready = STEPS.filter((s) => !s.out.every(has) && s.needs.every(has));

  if (bad.length && !has('6-brief.md')) {
    head('Clean the rules file');
    L.push('## Now', '', `5-rules.md carries exact values on line${bad.length > 1 ? 's' : ''} ${bad.join(', ')}. Rewrite ${bad.length > 1 ? 'those lines' : 'that line'} in plain words (a soft blur, one bright colour, a short rise), then run this again.`, '', '## Then', '', '```', self, '```');
    return finish(dir, L);
  }

  if (!ready.length) {
    head('Done');
    L.push('## The read is complete', '', 'Read in this order: 0-frame.md, 1-survey.md, 4-read.md, 5-rules.md, 6-brief.md.', '',
      '**To rebuild:** open 6-brief.md from inside your own project folder and follow its build order. Build there, and keep this folder as the study.', '',
      '**To go deeper on one part:** the "Out of reach" lists in 1-survey.md and 3-build.md, and each "Check next" line in 4-read.md, name the tool that would show it. Save what that tool gives you in `scans/<date>-<tool>/`, add its findings to 2-behaviour.md or 3-build.md, move 4-read.md, 5-rules.md and 6-brief.md into a folder named `earlier/`, and run this again for a new Decide.');
    return finish(dir, L);
  }

  head(ready.map((s) => s.name).join(' and '));
  if (ready.length > 1) L.push(`${ready.length} steps are ready. Two helpers can take one each at the same time. A lone reader does them in the order shown.`, '');
  for (const s of ready) {
    const prompt = readFileSync(join(HERE, 'stations', s.station), 'utf8').trim().replaceAll('{case}', dir).replace('{materials}', surveyMaterials(list));
    L.push(`## Now: ${s.name}`, '');
    if (s.alone) L.push('Do this step in a fresh conversation, or hand it to a helper. It works from two files alone, and a reader who has seen the earlier notes will carry them in.', '');
    L.push('Follow these instructions exactly:', '', '---', '', prompt, '', '---', '');
  }
  L.push('## Then', '', 'When the step\'s files are saved, run this to get the next step:', '', '```', self, '```');
  return finish(dir, L);
}

function finish(dir, L) {
  const text = L.join('\n') + '\n';
  writeFileSync(join(dir, 'NEXT.md'), text);
  console.log(text);
  console.log(`(written to ${join(dir, 'NEXT.md')})`);
}

main();
