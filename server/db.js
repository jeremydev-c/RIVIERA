import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS enquiries (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
    guests INTEGER NOT NULL DEFAULT 1, message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS nominations (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('king','queen')),
    nominated_by TEXT, reason TEXT, photo TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS votes (
    category TEXT NOT NULL, nominee_id INTEGER NOT NULL, voter TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (category, voter)
  );
  CREATE TABLE IF NOT EXISTS dishes (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('Mains','Sides','Desserts','Drinks')),
    note TEXT, base_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS backs (
    dish_id INTEGER NOT NULL, visitor TEXT NOT NULL, PRIMARY KEY (dish_id, visitor)
  );
  CREATE TABLE IF NOT EXISTS lineup (
    id INTEGER PRIMARY KEY, position INTEGER NOT NULL, name TEXT, role TEXT,
    revealed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY);
`;

// The board as it stood on the previous site, so earlier votes are not lost.
// Champagne stays hidden until the committee decides, because this is a 16+ event.
const SEED_DISHES = [
  ['Ice Cream', 'Desserts', null, 9, 'approved'],
  ['Doughnuts', 'Desserts', 'Coconut glazed', 7, 'approved'],
  ['Nyama Choma', 'Mains', null, 6, 'approved'],
  ['Glazed Ham', 'Mains', null, 4, 'approved'],
  ['Gaks', 'Sides', null, 3, 'approved'],
  ['Champagne', 'Drinks', 'Champagne popping', 2, 'hidden'],
];

export function openDb(dataDir) {
  fs.mkdirSync(path.join(dataDir, 'portraits'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'riviera.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);

  const first = db.prepare("SELECT value FROM settings WHERE key = 'seeded'").get();
  if (!first) {
    const setting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    setting.run('seeded', '1');
    setting.run('stage', 'nominations');
    setting.run('require_codes', '0');
    const dish = db.prepare('INSERT INTO dishes (name, category, note, base_count, status) VALUES (?, ?, ?, ?, ?)');
    SEED_DISHES.forEach((d) => dish.run(...d));
    const act = db.prepare('INSERT INTO lineup (position) VALUES (?)');
    [1, 2, 3, 4].forEach((n) => act.run(n));
  }
  return db;
}

export const getSetting = (db, key) => db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;

export const setSetting = (db, key, value) =>
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
