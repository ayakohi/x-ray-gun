// Byte-level helpers every adapter can lean on: identity, file signatures, entropy, strings.

import { createHash } from 'node:crypto';
import { createReadStream, openSync, readSync, closeSync, statSync } from 'node:fs';

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

export function readHead(path, n = 4096) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(n, statSync(path).size));
    readSync(fd, buf, 0, buf.length, 0);
    return buf;
  } finally { closeSync(fd); }
}

export function readRange(path, start, length) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    const got = readSync(fd, buf, 0, length, start);
    return buf.subarray(0, got);
  } finally { closeSync(fd); }
}

// Known file signatures: [name, bytes, offset]. Order matters only for display.
export const SIGNATURES = [
  ['zip (also apk, jar, msix, docx, xpi...)', Buffer.from('504b0304', 'hex'), 0],
  ['Windows program (PE / MZ)', Buffer.from('4d5a', 'hex'), 0],
  ['ELF (Linux program)', Buffer.from('7f454c46', 'hex'), 0],
  ['Mach-O (macOS program)', Buffer.from('cffaedfe', 'hex'), 0],
  ['Java class or Mach-O universal (cafebabe)', Buffer.from('cafebabe', 'hex'), 0],
  ['SQLite database', Buffer.from('SQLite format 3\0'), 0],
  ['PNG image', Buffer.from('89504e470d0a1a0a', 'hex'), 0],
  ['JPEG image', Buffer.from('ffd8ff', 'hex'), 0],
  ['GIF image', Buffer.from('GIF8'), 0],
  ['WebP / RIFF', Buffer.from('RIFF'), 0],
  ['PDF', Buffer.from('%PDF'), 0],
  ['gzip', Buffer.from('1f8b08', 'hex'), 0],
  ['7-zip', Buffer.from('377abcaf271c', 'hex'), 0],
  ['RAR', Buffer.from('Rar!'), 0],
  ['xz', Buffer.from('fd377a585a00', 'hex'), 0],
  ['zstd', Buffer.from('28b52ffd', 'hex'), 0],
  ['WebAssembly', Buffer.from('0061736d', 'hex'), 0],
  ['Android dex', Buffer.from('dex\n'), 0],
  ['Windows installer / OLE (msi, old office)', Buffer.from('d0cf11e0a1b11ae1', 'hex'), 0],
  ['Windows shortcut (.lnk)', Buffer.from('4c00000001140200', 'hex'), 0],
  ['tar', Buffer.from('ustar'), 257],
  ['ISO 9660 disk image', Buffer.from('CD001'), 0x8001],
];

export function identify(head) {
  for (const [name, sig, off] of SIGNATURES) {
    if (head.length >= off + sig.length && head.subarray(off, off + sig.length).equals(sig)) return name;
  }
  const sample = head.subarray(0, 1024);
  if (sample.length && [...sample].every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128)) {
    const t = sample.toString('utf8').trimStart();
    if (t.startsWith('{') || t.startsWith('[')) return 'JSON text';
    if (/^<!doctype html|^<html/i.test(t)) return 'HTML text';
    if (t.startsWith('<?xml') || t.startsWith('<')) return 'XML / markup text';
    return 'text';
  }
  return 'unknown binary';
}

// Shannon entropy in bits per byte: ~8 means compressed or encrypted, low means text or padding.
export function entropy(buf) {
  if (!buf.length) return 0;
  const counts = new Uint32Array(256);
  for (const b of buf) counts[b]++;
  let e = 0;
  for (const c of counts) if (c) { const p = c / buf.length; e -= p * Math.log2(p); }
  return Math.round(e * 100) / 100;
}

// Printable runs, ASCII and UTF-16LE, with their byte offsets.
export function strings(buf, min = 6, limit = 20000) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const b = buf[i];
    const ok = b >= 32 && b < 127;
    if (ok && start < 0) start = i;
    else if (!ok && start >= 0) {
      if (i - start >= min) out.push({ offset: start, text: buf.toString('latin1', start, i) });
      start = -1;
      if (out.length >= limit) return out;
    }
  }
  for (let i = 0, run = '', s = 0; i + 1 < buf.length; i += 2) {
    const lo = buf[i], hi = buf[i + 1];
    if (hi === 0 && lo >= 32 && lo < 127) { if (!run) s = i; run += String.fromCharCode(lo); }
    else { if (run.length >= min) out.push({ offset: s, text: run, utf16: true }); run = ''; if (out.length >= limit * 2) break; }
  }
  return out;
}

// Signatures found anywhere inside the file (embedded payloads), skipping offset 0.
export function embedded(buf, max = 200) {
  const hits = [];
  const wanted = SIGNATURES.filter(([n]) => /zip|PE|ELF|SQLite|PNG|gzip|7-zip|WebAssembly|PDF|xz|zstd/.test(n));
  for (const [name, sig] of wanted) {
    let i = buf.indexOf(sig, 1);
    while (i !== -1 && hits.length < max) { hits.push({ offset: i, what: name }); i = buf.indexOf(sig, i + 1); }
  }
  return hits.sort((a, b) => a.offset - b.offset);
}

export function human(n) {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}
