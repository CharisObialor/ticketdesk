const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const config = require('./config');
const db = require('./db');
const { uploadsDir, transcriptsDir } = require('./uploads');

const backupDir = path.join(config.storageDir, 'backups');
const filesDir = path.join(backupDir, 'files');
const statusFile = path.join(backupDir, 'last.json');

// Parents before children, so a restore can insert in this order without breaking foreign keys.
const TABLES = [
  'companies',
  'users',
  'tickets',
  'messages',
  'attachments',
  'transcripts',
  'ticket_reads',
  'ticket_ratings',
  'site_visits',
  'saved_replies',
  'chat_groups',
  'chat_members',
  'chat_messages',
  'chat_attachments',
  'notifications',
];

let running = null;

const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

// Streams every table as JSON lines into a gzip file: {"table":"users","row":{...}} per line.
async function dumpDatabase(file) {
  async function* lines() {
    yield JSON.stringify({ format: 'ticketdesk-backup', version: 1, created_at: new Date().toISOString(), tables: TABLES }) + '\n';
    for (const table of TABLES) {
      const rows = await db.query(`SELECT * FROM ${table}`);
      for (const row of rows) yield JSON.stringify({ table, row }) + '\n';
    }
  }
  const tmp = `${file}.part`;
  await pipeline(Readable.from(lines()), zlib.createGzip({ level: 9 }), fs.createWriteStream(tmp));
  await fs.promises.rename(tmp, file);
}

// Copies uploaded files and transcripts that are not in the backup folder yet (they never change once written).
async function mirrorFiles() {
  let copied = 0;
  for (const [src, name] of [
    [uploadsDir, 'uploads'],
    [transcriptsDir, 'transcripts'],
  ]) {
    const dest = path.join(filesDir, name);
    await fs.promises.mkdir(dest, { recursive: true });
    const existing = new Set(await fs.promises.readdir(dest));
    for (const f of await fs.promises.readdir(src)) {
      if (existing.has(f)) continue;
      await fs.promises.copyFile(path.join(src, f), path.join(dest, f));
      copied++;
    }
  }
  return copied;
}

async function prune() {
  const files = (await list()).map((b) => b.name);
  for (const name of files.slice(config.backup.keep)) await fs.promises.unlink(path.join(backupDir, name)).catch(() => {});
}

async function list() {
  await fs.promises.mkdir(backupDir, { recursive: true });
  const names = (await fs.promises.readdir(backupDir)).filter((f) => /^db-\d{8}-\d{4}\.jsonl\.gz$/.test(f)).sort().reverse();
  return Promise.all(
    names.map(async (name) => {
      const st = await fs.promises.stat(path.join(backupDir, name));
      return { name, size: st.size, created_at: st.mtime.toISOString() };
    })
  );
}

async function lastStatus() {
  try {
    return JSON.parse(await fs.promises.readFile(statusFile, 'utf8'));
  } catch {
    return null;
  }
}

// Runs one backup. Concurrent calls share the same run.
function run(reason = 'scheduled') {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    await fs.promises.mkdir(backupDir, { recursive: true });
    const name = `db-${stamp()}.jsonl.gz`;
    let status;
    try {
      await dumpDatabase(path.join(backupDir, name));
      const filesCopied = await mirrorFiles();
      await prune();
      const { size } = await fs.promises.stat(path.join(backupDir, name));
      status = { ok: true, reason, name, size, filesCopied, finished_at: new Date().toISOString(), ms: Date.now() - started };
      console.log(`[backup] ${name} (${Math.round(size / 1024)} KB, ${filesCopied} new files)`);
    } catch (err) {
      status = { ok: false, reason, error: err.message, finished_at: new Date().toISOString() };
      console.error('[backup] failed', err);
    }
    await fs.promises.writeFile(statusFile, JSON.stringify(status, null, 2)).catch(() => {});
    return status;
  })().finally(() => {
    running = null;
  });
  return running;
}

// Called regularly by the job runner: backs up once a day, after the configured hour (server local time).
async function runIfDue() {
  const nowDate = new Date();
  if (nowDate.getHours() < config.backup.hour) return;
  const today = stamp(nowDate).slice(0, 8);
  const latest = (await list())[0];
  if (latest && latest.name.slice(3, 11) === today) return;
  await run('scheduled');
}

module.exports = { run, runIfDue, list, lastStatus, backupDir, TABLES };
