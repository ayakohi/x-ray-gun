// A small ZIP reader: lists the central directory and extracts stored/deflated members. No zip64.
// Every size and offset in a zip is the archive's claim, so each one is checked against the real file.

import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { constants } from 'node:buffer';
import { extractor, EXTRACT_BUDGET } from './extract.mjs';

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
    if (cdOff + cdSize > size) throw new Error(`central directory claims bytes ${cdOff}–${cdOff + cdSize}, past the end of the ${size}-byte file`);
    const cd = Buffer.alloc(cdSize);
    readSync(fd, cd, 0, cdSize, cdOff);
    const entries = [];
    for (let p = 0; p + 46 <= cd.length && entries.length < count; ) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
      const local = cd.readUInt32LE(p + 42);
      const flags = cd.readUInt16LE(p + 8);
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, Math.min(cd.length, p + 46 + nlen));
      entries.push({ name, method, csize, usize, local, encrypted: !!(flags & 1), dir: name.endsWith('/') });
      p += 46 + nlen + xlen + clen;
    }
    return { size, entries };
  } finally { closeSync(fd); }
}

// One member's bytes, never more than `max` once unpacked.
export function readEntry(path, e, max = constants.MAX_LENGTH) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    if (e.local + 30 > size) throw new Error('local header past the end of the file');
    const lh = Buffer.alloc(30);
    readSync(fd, lh, 0, 30, e.local);
    const start = e.local + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    if (start + e.csize > size) throw new Error('packed data past the end of the file');
    const data = Buffer.alloc(e.csize);
    readSync(fd, data, 0, e.csize, start);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRawSync(data, { maxOutputLength: Math.min(max, constants.MAX_LENGTH) });
    throw new Error(`compression method ${e.method} not supported`);
  } finally { closeSync(fd); }
}

// Extracts into `dest` through the shared extractor: names stay inside `dest`, real bytes count
// against `budget`, and a member whose unpacked size differs from its header is set aside.
export function extractZip(path, entries, dest, budget = EXTRACT_BUDGET) {
  const ex = extractor(dest, budget);
  for (const e of entries) {
    if (e.dir) continue;
    if (e.encrypted) { ex.skipped.push(`${e.name} (encrypted)`); continue; }
    ex.add(e.name, (left) => {
      if (e.usize > left) throw new Error('over size budget');
      // Allow one byte past the claim, so a member that lies about its size is caught, not cut short.
      const data = readEntry(path, e, Math.min(left, e.usize + 1));
      if (data.length !== e.usize) throw new Error(`unpacks to ${data.length} bytes, header says ${e.usize}`);
      return data;
    });
  }
  return { written: ex.written, skipped: ex.skipped, used: ex.used };
}
