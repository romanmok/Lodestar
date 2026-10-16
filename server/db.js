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
  db.exec('CREATE TABLE IF NOT EXISTS maps (id TEXT PRIMARY KEY, name TEXT NOT NULL, saved_at TEXT NOT NULL, record TEXT NOT NULL)');
  const listStmt = db.prepare('SELECT record FROM maps ORDER BY saved_at DESC, id');
  const getMapStmt = db.prepare('SELECT record FROM maps WHERE id = ?');
  const putMapStmt = db.prepare(
    'INSERT INTO maps (id, name, saved_at, record) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, saved_at = excluded.saved_at, record = excluded.record');
  const delMapStmt = db.prepare('DELETE FROM maps WHERE id = ?');
  return {
    raw: db,
    listMaps() { return listStmt.all().map((r) => JSON.parse(r.record)); },
    getMap(id) {
      const row = getMapStmt.get(id);
      return row ? JSON.parse(row.record) : undefined;
    },
    putMap(record) {
      putMapStmt.run(record.id, record.name, record.savedAt || new Date().toISOString(), JSON.stringify(record));
    },
    deleteMap(id) { delMapStmt.run(id); },
    kvGet(key) {
      const row = getStmt.get(key);
      return row ? JSON.parse(row.value) : undefined;
    },
    kvSet(key, value) { setStmt.run(key, JSON.stringify(value)); },
    close() { db.close(); },
  };
}
