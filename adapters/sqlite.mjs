// SQLite databases: the schema (tables, columns, indexes, views), row counts, and a small
// sample of rows per table. Read-only, using Node's built-in SQLite. Many apps keep their
// settings, caches and content in one of these.

import { human } from '../lib/bytes.mjs';

// Loaded only when a database is opened, so an older Node can still run every other adapter.
async function loadSqlite() {
  try { return (await import('node:sqlite')).DatabaseSync; }
  catch { throw new Error(`reading SQLite needs Node 22.5 or newer (this is ${process.version})`); }
}

export default {
  name: 'sqlite',
  about: 'SQLite database: schema, row counts, a few sample rows per table (read-only)',
  detect(t) {
    if (t.kind !== 'file') return 0;
    if (t.head?.subarray(0, 15).toString() === 'SQLite format 3') return 95;
    return ['.sqlite', '.sqlite3', '.db'].includes(t.ext) ? 40 : 0;
  },
  async run(t, ctx) {
    const DatabaseSync = await loadSqlite();
    const db = new DatabaseSync(t.path, { readOnly: true });
    try {
      const objects = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
      const tables = objects.filter((o) => o.type === 'table');
      const findings = [], inventory = [];
      const sampleRows = Number(ctx.opts.rows) || 3;

      for (const tbl of tables) {
        const cols = db.prepare(`PRAGMA table_info("${tbl.name.replace(/"/g, '""')}")`).all();
        let count = '?';
        try { count = db.prepare(`SELECT COUNT(*) c FROM "${tbl.name.replace(/"/g, '""')}"`).get().c; } catch { /* virtual table */ }
        inventory.push(`${tbl.name}  (${cols.length} cols, ${count} rows)`);
        findings.push({ what: `table ${tbl.name}: ${cols.map((c) => `${c.name} ${c.type || ''}`.trim()).join(', ')}`, evidence: `${count} rows` });
      }
      for (const o of objects.filter((x) => x.type !== 'table')) inventory.push(`${o.type}: ${o.name}`);

      // Sample rows for the smaller tables, so the report shows the shape of the data without dumping it.
      const samples = [];
      for (const tbl of tables.slice(0, 40)) {
        try {
          const rows = db.prepare(`SELECT * FROM "${tbl.name.replace(/"/g, '""')}" LIMIT ${sampleRows}`).all();
          if (rows.length) samples.push(`### ${tbl.name}\n` + rows.map((r) => '- ' + Object.entries(r).map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(', ')).join('\n'));
        } catch { /* skip */ }
      }

      return {
        kind: 'SQLite database',
        summary: `${tables.length} tables, ${objects.length - tables.length} other objects (indexes/views/triggers), ${human(t.size)}.`,
        facts: { tables: tables.length, indexes: objects.filter((o) => o.type === 'index').length, views: objects.filter((o) => o.type === 'view').length },
        findings,
        guesses: samples.length ? [`Sample rows (first ${sampleRows} per table):\n\n` + samples.join('\n\n')] : [],
        unknowns: ['Row samples show shape, not the whole data. Query the database directly for specific records. A sibling -wal file (if present) may hold rows not yet merged in.'],
        // Given as code to put in a script file, so the path is never parsed by a shell.
        next: [`Query it yourself from a small script file: \`const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(${JSON.stringify(t.path)}, { readOnly: true }); console.log(d.prepare('SELECT ...').all());\``],
        inventory,
      };
    } finally { db.close(); }
  },
};
