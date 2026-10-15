// Electron's app.asar: the archive holding an Electron app's own code. Reads the header,
// extracts the packed files, and hands the result to the js adapter.

import { readRange, human } from '../lib/bytes.mjs';
import { brief } from '../lib/case.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

function readHeader(path) {
  const pre = readRange(path, 0, 16);
  const headerSize = pre.readUInt32LE(4);          // pickle 1: size of pickle 2
  const jsonLen = pre.readUInt32LE(12);            // pickle 2: string length
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
    const { header, base } = readHeader(t.path);
    const all = flatten(header);
    const dest = join(ctx.filesDir, 'extracted');
    let written = 0;
    const unknowns = [];
    for (const f of all) {
      if (f.unpacked || f.link || f.offset === null) continue;
      const out = join(dest, ...f.path.split('/'));
      if (!out.startsWith(dest)) continue;
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, readRange(t.path, base + f.offset, f.size));
      written++;
    }
    const unpacked = all.filter((f) => f.unpacked);
    if (unpacked.length) unknowns.push(`${unpacked.length} files live outside the archive in app.asar.unpacked/ next to it (often native .node modules). Scan that folder too.`);

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
