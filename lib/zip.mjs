// A small ZIP reader: lists the central directory and extracts stored/deflated members. No zip64.

import { openSync, readSync, closeSync, fstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join, dirname, normalize, isAbsolute, sep } from 'node:path';

export function listZip(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from('504b0506', 'hex'));
    if (eocd < 0) throw new Error('no end-of-central-directory record (truncated or not a zip)');
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOff = tail.readUInt32LE(eocd + 16);
    if (cdOff === 0xffffffff || count === 0xffff) throw new Error('zip64 archive (not supported by this reader)');
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOff);
    const entries = [];
    for (let p = 0; p < cd.length && entries.length < count; ) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const flags = cd.readUInt16LE(p + 8);
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
      entries.push({ name, method, csize, usize, local, encrypted: !!(flags & 1), dir: name.endsWith('/') });
      p += 46 + nlen + xlen + clen;
    }
    return { size, entries };
  } finally { closeSync(fd); }
}

export function readEntry(path, e) {
  const fd = openSync(path, 'r');
  try {
    const lh = Buffer.alloc(30);
    readSync(fd, lh, 0, 30, e.local);
    const start = e.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const data = Buffer.alloc(e.csize);
    readSync(fd, data, 0, e.csize, start);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRawSync(data);
    throw new Error(`compression method ${e.method} not supported`);
  } finally { closeSync(fd); }
}

// Extracts into `dest`, refusing names that would escape it. Stops at `budget` bytes.
export function extractZip(path, entries, dest, budget = 300 * 1024 * 1024) {
  let used = 0;
  const written = [], skipped = [];
  for (const e of entries) {
    if (e.dir) continue;
    const rel = normalize(e.name);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) { skipped.push(`${e.name} (unsafe path)`); continue; }
    if (e.encrypted) { skipped.push(`${e.name} (encrypted)`); continue; }
    if (used + e.usize > budget) { skipped.push(`${e.name} (over size budget)`); continue; }
    try {
      const out = join(dest, rel);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, readEntry(path, e));
      used += e.usize;
      written.push(rel);
    } catch (err) { skipped.push(`${e.name} (${err.message})`); }
  }
  return { written, skipped, used };
}
