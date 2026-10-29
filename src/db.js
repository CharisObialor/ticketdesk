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
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    impl = {
      async query(sql, params = []) {
        const stmt = db.prepare(sql);
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
    impl.dialect = 'sqlite';
  } else {
    const mysql = require('mysql2/promise');
    const pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      connectionLimit: 10,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: true,
      multipleStatements: true,
    });
    impl = {
      async query(sql, params = []) {
        const [rows] = await pool.query(sql, params.map(norm));
        return rows;
      },
      async exec(sql) {
        await pool.query(sql);
      },
    };
    await impl.exec(schema.mysql);
    impl.hasColumn = async (table, column) => {
      const [rows] = await pool.query(
        'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
        [table, column]
      );
      return Number(rows[0].n) > 0;
    };
    impl.dialect = 'mysql';
  }
  for (const [table, column, mysqlType, sqliteType] of schema.columns) {
    if (!(await impl.hasColumn(table, column))) {
      await impl.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${impl.dialect === 'sqlite' ? sqliteType : mysqlType}`);
      console.log(`[db] added column ${table}.${column}`);
    }
  }
}

const query = (sql, params) => impl.query(sql, params);
const one = async (sql, params) => (await impl.query(sql, params))[0] || null;
// Builds "?, ?, ?" for IN (...) lists.
const inList = (arr) => arr.map(() => '?').join(', ');

const dialect = () => impl.dialect;

module.exports = { init, query, one, inList, dialect };
