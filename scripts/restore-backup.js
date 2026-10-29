// Usage: node scripts/restore-backup.js storage/backups/db-20261029-0200.jsonl.gz [--force]
// Restores a backup into the database configured in .env. The database must be empty unless --force is given,
// in which case all existing rows are deleted first. Uploaded files are restored separately by copying
// storage/backups/files/uploads and files/transcripts back into storage/uploads and storage/transcripts.
const fs = require('fs');
const zlib = require('zlib');
const readline = require('readline');
const db = require('../src/db');
const { TABLES } = require('../src/backup');

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file || !fs.existsSync(file)) {
    console.error('Usage: node scripts/restore-backup.js <backup file> [--force]');
    process.exit(1);
  }
  await db.init();
  const counts = await Promise.all(TABLES.map(async (t) => Number((await db.one(`SELECT COUNT(*) AS n FROM ${t}`)).n)));
  if (counts.some((n) => n > 0)) {
    if (flag !== '--force') {
      console.error('The database is not empty. Re-run with --force to delete existing data and restore the backup.');
      process.exit(1);
    }
    for (const t of [...TABLES].reverse()) await db.query(`DELETE FROM ${t}`);
  }

  const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  let header = null;
  let restored = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    if (!header) {
      if (entry.format !== 'ticketdesk-backup') throw new Error('Not a TicketDesk backup file');
      header = entry;
      continue;
    }
    const cols = Object.keys(entry.row);
    await db.query(`INSERT INTO ${entry.table} (${cols.join(', ')}) VALUES (${db.inList(cols)})`, cols.map((c) => entry.row[c]));
    restored++;
  }
  console.log(`Restored ${restored} rows from backup made ${header && header.created_at}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Restore failed:', err.message);
  process.exit(1);
});
