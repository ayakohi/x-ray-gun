// Windows programs and libraries (.exe, .dll, .node). Reads only the file's own headers: how it was
// built and what it was built from. It does not interpret the program's instructions; turning machine
// code into readable code is a decompiler's job (Ghidra adapter — not built yet).

import { readRange, strings, human } from '../lib/bytes.mjs';

const MACHINES = { 0x14c: 'x86 (32-bit)', 0x8664: 'x64', 0xaa64: 'ARM64', 0x1c4: 'ARM' };
const SUBSYS = { 1: 'native / driver', 2: 'GUI (windowed)', 3: 'console' };

// What the app was built with, read from text the toolchain leaves in the file.
const TELLS = [
  ['Electron / Chromium', /electron\.exe|chrome_elf|libcef|Chromium/i],
  ['Go', /Go build ID:|go1\.\d+/],
  ['Rust', /rustc\/[0-9a-f]{40}|cargo/],
  ['Qt', /Qt[56]Core|QtWidgets/],
  ['.NET', /mscoree\.dll|\.NET Framework|System\.Private\.CoreLib/i],
  ['Python (bundled)', /PyInstaller|python3\d\.dll|_MEIPASS/],
  ['installer', /Nullsoft|Inno Setup|WiX|InstallShield/i],
  ['Unity game', /UnityPlayer|unity default resources/i],
];

export default {
  name: 'pe',
  about: 'Windows .exe/.dll: how it was built and from what (header facts only; no code interpretation)',
  detect(t) {
    if (t.kind !== 'file' || !t.head || t.head.subarray(0, 2).toString() !== 'MZ') return 0;
    return ['.exe', '.dll', '.sys', '.node'].includes(t.ext) ? 80 : 50;
  },
  async run(t) {
    const head = readRange(t.path, 0, Math.min(t.size, 2 * 1024 * 1024));
    const peOff = head.readUInt32LE(0x3c);
    const facts = {}, findings = [], unknowns = [];

    if (head.length > peOff + 24 && head.readUInt32LE(peOff) === 0x00004550) {
      const machine = head.readUInt16LE(peOff + 4);
      const sectionCount = head.readUInt16LE(peOff + 6);
      const tsRaw = head.readUInt32LE(peOff + 8);
      const optMagic = head.readUInt16LE(peOff + 24);
      const subsystem = head.readUInt16LE(peOff + 24 + 68);   // same offset in 32-bit and 64-bit images
      facts.architecture = MACHINES[machine] || `0x${machine.toString(16)}`;
      facts.kind = optMagic === 0x20b ? '64-bit image' : '32-bit image';
      facts.sections = sectionCount;
      facts.subsystem = SUBSYS[subsystem] || subsystem;
      // The timestamp is self-reported and often zeroed for reproducible builds, so it is a hint only.
      if (tsRaw > 0x40000000 && tsRaw < 0x80000000) facts.buildTimestampUTC = new Date(tsRaw * 1000).toISOString();
      findings.push({ what: `${facts.architecture} ${facts.kind}, ${facts.subsystem}, ${sectionCount} sections`, evidence: 'PE header' });
    } else {
      unknowns.push('MZ present but the PE header was not where expected; the file may be packed or a DOS-era binary.');
    }

    const strs = strings(head, 5);
    const built = [];
    for (const [name, re] of TELLS) if (strs.some((s) => re.test(s.text))) built.push(name);
    if (built.length) findings.push({ what: `built with / from: ${built.join(', ')}`, evidence: 'embedded toolchain strings' });

    // DLL names the program relies on — a rough sketch of what it does, from readable text.
    const dlls = [...new Set(strs.map((s) => s.text).filter((x) => /^[\w.-]{3,40}\.dll$/i.test(x)))].slice(0, 40);
    if (dlls.length) findings.push({ what: `mentions ${dlls.length} DLLs: ${dlls.slice(0, 15).join(', ')}${dlls.length > 15 ? ' …' : ''}`, evidence: 'readable strings' });

    const guesses = [];
    if (built.includes('Electron / Chromium')) guesses.push('This is an Electron app. Its real code is JavaScript in a resources/app.asar next to the .exe — scan that with the asar adapter, not this one.');
    if (built.includes('.NET')) guesses.push('A .NET program: its code is bytecode that tools like ILSpy decompile cleanly back to C#. A .NET adapter would do this; not built yet.');
    if (built.includes('installer')) guesses.push('This is an installer wrapper, not the app. Run it (in a safe place) or extract it to get the real files inside.');

    unknowns.push('What the machine code does is not read here. For native programs that genuinely need it, run the real REA once (`npx -y rea-agents@latest`) with Ghidra, or add a Ghidra adapter to this gun.');

    return {
      kind: 'Windows program / library (PE)',
      summary: `${facts.architecture || 'PE'} ${facts.subsystem || ''}, ${human(t.size)}.${built.length ? ' Built with ' + built.join(', ') + '.' : ''}`,
      facts, findings, guesses, unknowns,
      next: built.includes('Electron / Chromium') ? ['Find resources/app.asar beside this file and scan it.'] : ['Grep the strings dump for feature words, URLs, or settings keys.'],
      inventory: dlls.map((d) => `dll: ${d}`),
    };
  },
};
