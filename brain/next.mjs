#!/usr/bin/env node
// The pointer. Looks at which files a case folder holds, works out the next step of the read, and
// writes it to NEXT.md in that folder (and prints it). Run it again after every step.
//
//   node next.mjs <case name | case folder> [--target <file|folder|url>] [--question "..."] [--destination "..."] [--keep close|numbers|words]
//
// The first run needs the question and the destination. Everything after that is read from the folder.
// --keep sets how much of the measured look the build plan carries (default: close). It can be changed
// on any later run, up to the Brief step.

import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseFolder, writeFrame, readFrame, KEEPS } from '../lib/case.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const GUN = join(HERE, '..', 'xray.mjs');

// The sequence. A step is done when its output files exist, and ready when the files it needs exist.
const STEPS = [
  // Only Brief reads the frame. Every step before it works without knowing what the person hopes to find.
  { name: 'Survey', station: '1-survey.md', out: ['1-survey.md', 'glossary.md'], needs: ['0-frame.md'] },
  { name: 'Watch', station: '2-watch.md', out: ['2-behaviour.md'], needs: ['1-survey.md', 'glossary.md'] },
  { name: 'Open', station: '3-open.md', out: ['3-build.md'], needs: ['1-survey.md', 'glossary.md'] },
  { name: 'Decide', station: '4-decide.md', out: ['4-read.md'], needs: ['2-behaviour.md', '3-build.md'] },
  { name: 'Challenge', station: '5-challenge.md', out: ['5-challenge.md', '6-rules.md'], needs: ['4-read.md'], alone: 'It tests the read, so it needs a reader who did not write it.' },
  { name: 'Brief', station: '6-brief.md', out: ['7-brief.md'], needs: ['6-rules.md'], alone: 'It works from the few files it names, and a reader who has seen the earlier notes will carry them in.' },
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

// The look's own lane into the build plan. The rules stay in words; measured values travel here, as
// far as the frame's Keep setting allows: nothing (words), the build notes (numbers), or the build
// notes and the scan reports (close).
function look(keep, list) {
  if (keep === 'words') return { materials: '', part: '' };
  const m = ["- {case}/3-build.md — what the maker's thing is made of, with measured values."];
  if (keep === 'close') for (const s of list) if (s.report) m.push(`- ${s.report} — a scan report, with the measured style of each effect.`);
  return { materials: m.join('\n'), part: readFileSync(join(HERE, 'stations', 'look', `${keep}.md`), 'utf8').trim() };
}

// The rules file is the wall between the study and the rebuild: it carries words, never exact values.
// This catches the common forms (sizes, timings, angles, colours, code spans). Font names and other
// words that are exact values in disguise still rely on the Challenge reader writing in plain words.
const EXACT = [
  /\d+(\.\d+)?\s?(px|rem|em|ms|s|vh|vw|vmin|vmax|pt|deg|fr)\b/i,
  /\d+(\.\d+)?\s?%/,
  /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i,
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i,
  /`[^`]+`/,
];
function valuesIn(dir) {
  const p = join(dir, '6-rules.md');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => EXACT.some((re) => re.test(l))).map(([n]) => n);
}

function main() {
  const { pos, opts } = args(process.argv.slice(2));
  if (!pos[0]) { console.log('usage: node next.mjs <case name | case folder> [--target <file|folder|url>] [--question "..."] [--destination "..."] [--keep close|numbers|words]'); process.exit(1); }
  if (opts.keep !== undefined && !KEEPS.includes(opts.keep)) { console.log(`--keep takes one of: ${KEEPS.join(', ')}`); process.exit(1); }
  const dir = caseFolder(pos[0]);
  mkdirSync(dir, { recursive: true });
  const name = basename(dir);
  const has = (f) => existsSync(join(dir, f));
  const self = `node "${join(HERE, 'next.mjs')}" "${dir}"`;
  const L = [];

  // Step 0: the frame, in the person's own words.
  if (!has('0-frame.md')) {
    if (opts.question && opts.destination) {
      writeFrame(dir, { target: opts.target, question: opts.question, destination: opts.destination, keep: opts.keep });
    } else {
      L.push('# Next: Frame', '', 'Ask the person two things, then run this again with their answers:', '', '1. What do you want to learn from this thing?', '2. What are you building yourself?', '', '```', `${self} --target "<file, folder or address>" --question "<their answer 1>" --destination "<their answer 2>"`, '```');
      return finish(dir, L);
    }
  }
  let frame = readFrame(dir);
  // The Keep setting can be changed on a later run; the rest of the frame stays as the person gave it.
  if (opts.keep && opts.keep !== frame.keep) { writeFrame(dir, { ...frame, keep: opts.keep }); frame = readFrame(dir); }
  const list = scans(dir);
  mergeNames(dir);

  const done = [`- [x] Frame — 0-frame.md`];
  if (list.length) done.push(`- [x] Scan — ${list.length} in scans/`);
  for (const s of STEPS) if (s.out.every(has)) done.push(`- [x] ${s.name} — ${s.out.join(', ')}`);
  // Every step reads this header, so it names the case and the target only. The question and the
  // destination appear once the read is complete; until then Brief alone opens 0-frame.md.
  const head = (title, { withFrame = false } = {}) => L.push(`# Next: ${title}`, '',
    `Case **${name}** · Target: ${frame.target}${withFrame ? ` · Question: ${frame.question} · Destination: ${frame.destination} · Keep: ${frame.keep}` : ''}`, '', '## Done', ...done, '');

  // Collect the material before any reading starts. The gun reads the target from 0-frame.md itself.
  if (!list.length) {
    head('Scan');
    L.push('## Now', '', 'Collect the material. Run the gun on the target:', '', '```', `node "${GUN}" scan --case "${dir}"`, '```', '',
      'When the gun cannot open this kind of thing (a picture, a video, a compiled program), follow "When the gun runs out" in the gun\'s SKILL.md and save what the outside tool gives you in `scans/<date>-<tool>/` with a `report.md`.', '', '## Then', '', '```', self, '```');
    return finish(dir, L);
  }

  const bad = valuesIn(dir);
  const ready = STEPS.filter((s) => !s.out.every(has) && s.needs.every(has));

  if (bad.length && !has('7-brief.md')) {
    head('Clean the rules file');
    L.push('## Now', '', `6-rules.md carries exact values on line${bad.length > 1 ? 's' : ''} ${bad.join(', ')}. Rewrite ${bad.length > 1 ? 'those lines' : 'that line'} in plain words (a soft blur, one bright colour, a short rise), then run this again.`, '', '## Then', '', '```', self, '```');
    return finish(dir, L);
  }

  if (!ready.length) {
    head('Done', { withFrame: true });
    L.push('## The read is complete', '', 'Read in this order: 0-frame.md, 1-survey.md, 4-read.md, 5-challenge.md, 6-rules.md, 7-brief.md.', '',
      '**To rebuild:** open 7-brief.md from inside your own project folder and follow its build order. Build there, and keep this folder as the study.', '',
      '**To go deeper on one part:** the "Out of reach" lists in 1-survey.md and 3-build.md, and each "Check next" line in 4-read.md, name the tool that would show it. Save what that tool gives you in `scans/<date>-<tool>/`, add its findings to 2-behaviour.md or 3-build.md, move 4-read.md, 5-challenge.md, 6-rules.md and 7-brief.md into a folder named `earlier/`, and run this again for a new Decide.');
    return finish(dir, L);
  }

  head(ready.map((s) => s.name).join(' and '));
  if (ready.length > 1) L.push(`${ready.length} steps are ready. Two helpers can take one each at the same time. A lone reader does them in the order shown.`, '');
  for (const s of ready) {
    const lk = s.name === 'Brief' ? look(frame.keep, list) : { materials: '', part: '' };
    const prompt = readFileSync(join(HERE, 'stations', s.station), 'utf8').trim()
      .replace('{look materials}', () => lk.materials).replace('{look}', () => lk.part).replace('{materials}', () => surveyMaterials(list))
      .replaceAll('{case}', dir).replace(/\n{3,}/g, '\n\n');
    L.push(`## Now: ${s.name}`, '');
    if (s.alone) L.push(`Do this step in a fresh conversation, or hand it to a helper. ${s.alone}`, '');
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
