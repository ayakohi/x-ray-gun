// Electron's app.asar: the archive holding an Electron app's own code. Reads the header,
// extracts the packed files, and hands the result to the js adapter.

import { readRange, human } from '../lib/bytes.mjs';
import { brief } from '../lib/case.mjs';
import { extractor } from '../lib/extract.mjs';
import { join } from 'node:path';

// Every length in the header is the archive's claim, so each one is checked against the real file size.
function readHeader(path, size) {
  const pre = readRange(path, 0, 16);
  const headerSize = pre.readUInt32LE(4);          // pickle 1: size of pickle 2
  const jsonLen = pre.readUInt32LE(12);            // pickle 2: string length
  if (8 + headerSize > size || 16 + jsonLen > 8 + headerSize) throw new Error(`header claims ${headerSize} bytes in a ${size}-byte file (damaged or not an asar)`);
  const json = readRange(path, 16, jsonLen).toString('utf8');
  return { header: JSON.parse(json), base: 8 + headerSize };
}

function flatten(node, prefix = '', out = []) {
  for (const [name, v] of Object.entries(node.files || {})) {
    const p = prefix ? `${prefix}/${name}` : name;
    if (v.files) flatten(v, p, out);
    else out.push({ path: p, size: v.size || 0, offset: v.offset !== undefined ? Number(v.offset) : null, unpacked: !!v.unpacked, link: v.link });
  }
  return out;
}

export default {
  name: 'asar',
  about: "Electron app.asar: header, file list, extraction, then the js adapter on what's inside",
  detect(t) {
    if (t.kind !== 'file' || t.size < 16) return 0;
    if (t.ext === '.asar') return 95;
    try { return t.head.readUInt32LE(0) === 4 && t.head.subarray(16, 26).toString().startsWith('{"files"') ? 90 : 0; } catch { return 0; }
  },
  async run(t, ctx) {
    const { header, base } = readHeader(t.path, t.size);
    const all = flatten(header);
    const dest = join(ctx.filesDir, 'extracted');
    const ex = extractor(dest);
    const unknowns = [];
    for (const f of all) {
      if (f.unpacked || f.link || f.offset === null) continue;
      ex.add(f.path, (left) => {
        const start = base + f.offset;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(f.size) || f.offset < 0 || f.size < 0 || start + f.size > t.size) throw new Error('outside the archive');
        if (f.size > left) throw new Error('over size budget');
        return readRange(t.path, start, f.size);
      });
    }
    const written = ex.written.length;
    const unpacked = all.filter((f) => f.unpacked);
    if (unpacked.length) unknowns.push(`${unpacked.length} files live outside the archive in app.asar.unpacked/ next to it (often native .node modules). Scan that folder too.`);
    if (ex.skipped.length) unknowns.push(`${ex.skipped.length} files not extracted: ${ex.skipped.slice(0, 5).join('; ')}`);

    const pkg = all.find((f) => f.path === 'package.json');
    const children = [brief(await ctx.handoff(dest, 'js'))];
    return {
      kind: 'Electron app archive (asar)',
      summary: `${all.length} files, ${human(all.reduce((s, f) => s + f.size, 0))}. Extracted ${written} into files/extracted and ran the js adapter on them.`,
      facts: { files: all.length, hasPackageJson: !!pkg, unpackedFiles: unpacked.length },
      findings: all.filter((f) => /(^|\/)(package\.json|main\.js|preload[^/]*\.js|index\.html)$/i.test(f.path)).slice(0, 15).map((f) => ({ what: f.path, evidence: 'asar header' })),
      unknowns, children,
      inventory: all.slice(0, 400).map((f) => `${f.path}  ${human(f.size)}${f.unpacked ? '  (unpacked)' : ''}`),
      inventoryTotal: all.length,
      files: ['files/extracted/'],
    };
  },
};
