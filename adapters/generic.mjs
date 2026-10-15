// The never-heard-of-it adapter. Opens any file at all: signature, entropy, readable strings,
// embedded payloads. It is the fallback, so it always matches, with the lowest score.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRange, entropy, strings, embedded, human } from '../lib/bytes.mjs';

const CAP = 64 * 1024 * 1024;   // read at most this much of a huge file

const PATTERNS = [
  ['web address', /\bhttps?:\/\/[^\s"'<>]{6,}/i],
  ['file path', /(?:[A-Z]:\\|\/(?:usr|etc|home|var|opt|Users)\/)[^\s"'<>]{3,}/],
  ['version', /\bv?\d+\.\d+\.\d+(?:[-+.][\w.]+)?\b/],
  ['build tool / compiler', /\b(?:GCC|clang|MSVC|rustc|Go build ID|Delphi|Electron|Qt\d?|Python \d|PyInstaller|Nuitka|NSIS|Nullsoft|Inno Setup|Unity|Unreal|Godot|GameMaker|\.NETFramework|mono)\b/i],
  ['secret-looking', /\b(?:api[_-]?key|secret|token|password|bearer)\b/i],
];

export default {
  name: 'generic',
  about: 'any file: signature, entropy, strings, embedded payloads (the fallback)',
  detect: (t) => (t.kind === 'file' ? 1 : 0),
  async run(t, ctx) {
    const buf = readRange(t.path, 0, Math.min(t.size, CAP));
    const ent = entropy(buf);
    const chunk = 64 * 1024, peaks = [];
    for (let i = 0; i < buf.length; i += chunk) peaks.push(entropy(buf.subarray(i, i + chunk)));
    const hi = peaks.filter((e) => e > 7.5).length;

    const strs = strings(buf, 6);
    writeFileSync(join(ctx.filesDir, 'strings.txt'), strs.map((s) => `${s.offset.toString(16).padStart(8, '0')}${s.utf16 ? ' u16' : '    '}  ${s.text}`).join('\n'));

    const findings = [], guesses = [], seen = new Set();
    for (const [label, re] of PATTERNS) {
      const hits = strs.filter((s) => re.test(s.text)).slice(0, 8);
      for (const s of hits) {
        const key = label + s.text;
        if (seen.has(key)) continue;
        seen.add(key);
        findings.push({ what: `${label}: ${s.text.slice(0, 140)}`, evidence: `offset 0x${s.offset.toString(16)}` });
      }
    }
    const emb = embedded(buf);
    for (const e of emb.slice(0, 20)) findings.push({ what: `embedded ${e.what}`, evidence: `offset 0x${e.offset.toString(16)}` });

    if (ent > 7.8) guesses.push('Almost all of it looks compressed or encrypted: strings will be thin. Try extracting it as an archive, or find the program that reads it.');
    else if (hi) guesses.push(`${hi} of ${peaks.length} 64KB chunks look compressed or encrypted: there may be packed data inside.`);
    if (emb.length) guesses.push('Embedded signatures can be false alarms. A real payload usually sits at a round offset, and its header bytes make sense.');

    return {
      kind: 'unknown file (generic look)',
      summary: `${t.sig}, ${human(t.size)}. Entropy ${ent} bits/byte (8 = random or compressed, 4–5 = text). ${strs.length} readable strings, ${emb.length} embedded signatures.`,
      facts: { signature: t.sig, entropy: ent, highEntropyChunks: `${hi}/${peaks.length}`, readTruncated: t.size > CAP },
      findings, guesses,
      unknowns: [t.size > CAP ? `Only the first ${human(CAP)} were read.` : null, 'What the bytes mean structurally: that needs an adapter (or a tool) that knows the format.'].filter(Boolean),
      next: ['Grep files/strings.txt for words from the feature you care about.', ...emb.slice(0, 3).map((e) => `Carve the ${e.what} at 0x${e.offset.toString(16)} into its own file, then scan that.`)],
      files: ['files/strings.txt'],
    };
  },
};
