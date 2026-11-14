// Writing files that come out of an untrusted archive (zip, asar, source maps). Every name must land
// inside the destination folder, and every byte written counts against one budget. Adapters hand each
// member to an extractor; they never write archive members themselves.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, isAbsolute, dirname, sep } from 'node:path';

export const EXTRACT_BUDGET = 300 * 1024 * 1024;

// The path a member name would be written to, or null when the name would leave `dest`.
export function inside(dest, name) {
  const parts = String(name).split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return null;
  const out = join(dest, ...parts);
  const rel = relative(dest, out);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return out;
}

// One extraction into `dest`. `add(name, read)` writes one member: `read(left)` returns its bytes and
// is given the bytes still allowed, so a reader can refuse or cap before it allocates anything.
export function extractor(dest, budget = EXTRACT_BUDGET) {
  let used = 0;
  const written = [], skipped = [];
  return {
    written, skipped,
    get used() { return used; },
    add(name, read) {
      const out = inside(dest, name);
      if (!out) { skipped.push(`${name} (unsafe path)`); return false; }
      const left = budget - used;
      if (left <= 0) { skipped.push(`${name} (over size budget)`); return false; }
      try {
        const data = read(left);
        if (data.length > left) { skipped.push(`${name} (over size budget)`); return false; }
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, data);
        used += data.length;
        written.push(relative(dest, out));
        return true;
      } catch (err) { skipped.push(`${name} (${err.message})`); return false; }
    },
  };
}
