const fs = require('fs');
const path = require('path');
const config = require('./config');
const schema = require('./schema');

// Thin adapter so the app runs on MySQL (cPanel) or SQLite (local testing) with the same SQL.
// query() returns rows for SELECT, or { insertId, affectedRows } for writes.
let impl;

const norm = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

async function init() {
  if (config.db.client === 'sqlite') {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(path.dirname(config.db.sqlitePath), { recursive: true });
    const db = new DatabaseSync(config.db.sqlitePath);
    const statements = new Map();
    // WAL with NORMAL sync is the recommended pairing: durable on app crashes, and far fewer disk flushes per write.
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    impl = {
      async query(sql, params = []) {
        // Compiled statements are kept and reused; the app runs a small, fixed set of queries.
        let stmt = statements.get(sql);
        if (!stmt) {
          stmt = db.prepare(sql);
          if (statements.size > 500) statements.clear();
          statements.set(sql, stmt);
        }
        const args = params.map(norm);
        if (/^\s*(select|with|pragma)/i.test(sql)) return stmt.all(...args);
        const r = stmt.run(...args);
        return { insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) };
      },
      async exec(sql) {
        db.exec(sql);
      },
    };
    await impl.exec(schema.sqlite);
    impl.hasColumn = async (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    impl.hasIndex = async (table, name) => db.prepare(`PRAGMA index_list(${table})`).all().some((i) => i.name === name);
    impl.dialect = 'sqlite';
  } else {
    const mysql = require('mysql2/promise');
    const options = {
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: true,
    };
    // Everyday queries run one statement at a time, so even a mistake in a query could never chain on another
    // (such as a DROP). Only the schema script, run once here, needs several statements per call.
    const pool = mysql.createPool({ ...options, connectionLimit: 10 });
    const setup = await mysql.createConnection({ ...options, multipleStatements: true });
    try {
      await setup.query(schema.mysql);
    } finally {
      await setup.end();
    }
    impl = {
      async query(sql, params = []) {
        const [rows] = await pool.query(sql, params.map(norm));
        return rows;
      },
      async exec(sql) {
        await pool.query(sql);
      },
    };
    impl.hasColumn = async (table, column) => {
      const [rows] = await pool.query(
        'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column]
      );
      return Number(rows[0].n) > 0;
    };
    impl.hasIndex = async (table, name) => {
      const [rows] = await pool.query(
        'SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
        [table, name]
      );
      return Number(rows[0].n) > 0;
    };
    impl.dialect = 'mysql';
  }
  for (const [table, column, mysqlType, sqliteType, backfill] of schema.columns) {
    if (!(await impl.hasColumn(table, column))) {
      await impl.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${impl.dialect === 'sqlite' ? sqliteType : mysqlType}`);
      if (backfill) await impl.exec(backfill);
      console.log(`[db] added column ${table}.${column}`);
    }
  }
  for (const [table, name, cols] of schema.indexes) {
    if (!(await impl.hasIndex(table, name))) {
      await impl.exec(`CREATE INDEX ${name} ON ${table} (${cols})`);
      console.log(`[db] added index ${name}`);
    }
  }
  await optimize();
}

// Refreshes SQLite's table statistics so it keeps choosing good query plans as data grows (MySQL does this itself).
async function optimize() {
  if (impl.dialect === 'sqlite') await impl.exec('PRAGMA optimize = 0x10002');
}

// Counts changes to the reporting tables, so cached dashboard figures know when they may be out of date.
let dataVersion = 0;
const REPORTING_WRITE = /^\s*(insert\s+into|update|delete\s+from)\s+(tickets|messages|ticket_ratings|site_visits|users)\b/i;
const query = (sql, params) => {
  if (REPORTING_WRITE.test(sql)) dataVersion++;
  return impl.query(sql, params);
};
const version = () => dataVersion;
const one = async (sql, params) => (await impl.query(sql, params))[0] || null;
// Builds "?, ?, ?" for IN (...) lists.
const inList = (arr) => arr.map(() => '?').join(', ');

const dialect = () => impl.dialect;
// True once init() has connected; scripts that only load modules never call it.
const ready = () => !!impl;

module.exports = { init, query, one, inList, dialect, ready, optimize, version };
