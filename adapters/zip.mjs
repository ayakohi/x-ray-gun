// ZIP and everything built on it: apk, jar, msix/appx, docx/xlsx/pptx, xpi/crx-unpacked, nupkg, whl,
// ipa. Lists members, names the flavour, extracts, and hands the inside to the folder adapter.

import { listZip, extractZip } from '../lib/zip.mjs';
import { human } from '../lib/bytes.mjs';
import { brief } from '../lib/case.mjs';
import { join } from 'node:path';

const FLAVOURS = [
  ['Android app (APK)', (n) => n.has('AndroidManifest.xml') && [...n].some((x) => /^classes\d*\.dex$/.test(x))],
  ['iOS app (IPA)', (n) => [...n].some((x) => /^Payload\/[^/]+\.app\//.test(x))],
  ['Windows Store package (MSIX/APPX)', (n) => n.has('AppxManifest.xml')],
  ['Word document', (n) => n.has('word/document.xml')],
  ['Excel workbook', (n) => n.has('xl/workbook.xml')],
  ['PowerPoint deck', (n) => n.has('ppt/presentation.xml')],
  ['Java archive (JAR)', (n) => n.has('META-INF/MANIFEST.MF')],
  ['browser extension', (n) => n.has('manifest.json') && [...n].some((x) => /\.js$/.test(x))],
  ['NuGet package', (n) => [...n].some((x) => /\.nuspec$/.test(x))],
  ['Python wheel', (n) => [...n].some((x) => /\.dist-info\/WHEEL$/.test(x))],
];

const ZIP_STARTS = ['504b0304', '504b0506', '504b0708'].map((h) => Buffer.from(h, 'hex'));
const ZIP_EXTS = new Set(['.zip', '.apk', '.jar', '.msix', '.appx', '.docx', '.xlsx', '.pptx', '.xpi', '.ipa', '.whl', '.nupkg', '.aab']);

export default {
  name: 'zip',
  about: 'zip and its family (apk, jar, msix, docx, xpi, ipa, whl...): list, name the flavour, extract',
  // A zip can start with a file record, an empty-archive record, or a spanning marker. A zip-family
  // extension alone is a weaker claim; listZip then looks for the record at the end of the file.
  detect(t) {
    if (t.kind !== 'file') return 0;
    if (ZIP_STARTS.some((sig) => t.head?.subarray(0, 4).equals(sig))) return 90;
    return ZIP_EXTS.has(t.ext) ? 50 : 0;
  },
  async run(t, ctx) {
    const { entries } = listZip(t.path);
    const names = new Set(entries.map((e) => e.name));
    const flavour = FLAVOURS.find(([, test]) => test(names))?.[0] || 'plain zip';
    const files = entries.filter((e) => !e.dir);
    const usize = files.reduce((s, e) => s + e.usize, 0);
    const dest = join(ctx.filesDir, 'extracted');
    const ex = ctx.opts['no-extract'] ? { written: [], skipped: [] } : extractZip(t.path, files, dest);

    const findings = [{ what: `flavour: ${flavour}`, evidence: 'member names' }];
    const notable = files.filter((e) => /(^|\/)(AndroidManifest\.xml|AppxManifest\.xml|MANIFEST\.MF|manifest\.json|package\.json|Info\.plist|.*\.nuspec|classes\d*\.dex|.*\.so|.*\.dll|.*\.exe|.*\.asar|.*\.wasm)$/i.test(e.name));
    for (const e of notable.slice(0, 25)) findings.push({ what: `${e.name} (${human(e.usize)})`, evidence: 'zip member' });

    const unknowns = [];
    if (flavour.startsWith('Android')) unknowns.push('AndroidManifest.xml and resources are compiled binary XML, and classes.dex is Dalvik bytecode. Readable Java needs JADX (free, needs Java).');
    if (ex.skipped.length) unknowns.push(`${ex.skipped.length} members not extracted: ${ex.skipped.slice(0, 5).join('; ')}`);

    const children = [];
    if (ex.written.length) children.push(brief(await ctx.handoff(dest, 'folder')));

    return {
      kind: `zip — ${flavour}`,
      summary: `${flavour}: ${files.length} files, ${human(usize)} unpacked. Extracted ${ex.written.length} into files/extracted.`,
      facts: { flavour, members: files.length, unpacked: human(usize), encrypted: files.filter((e) => e.encrypted).length },
      findings, unknowns, children,
      next: ex.written.length ? [`Grep ${dest} for words from the feature you care about.`] : [],
      inventory: files.slice(0, 500).map((e) => `${e.name}  ${human(e.usize)}`),
      inventoryTotal: files.length,
      files: ex.written.length ? ['files/extracted/'] : [],
    };
  },
};
