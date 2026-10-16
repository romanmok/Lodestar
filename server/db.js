import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const getStmt = db.prepare('SELECT value FROM kv WHERE key = ?');
  const setStmt = db.prepare(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  return {
    raw: db,
    kvGet(key) {
      const row = getStmt.get(key);
      return row ? JSON.parse(row.value) : undefined;
    },
    kvSet(key, value) { setStmt.run(key, JSON.stringify(value)); },
    close() { db.close(); },
  };
}
