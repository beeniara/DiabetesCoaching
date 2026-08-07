import * as SQLite from "expo-sqlite";

// The device database is the source of truth for the first release.
export async function openLocalStore() {
  const db = await SQLite.openDatabaseAsync("diabetes-coaching.db");
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS glucose_readings (
      id TEXT PRIMARY KEY NOT NULL,
      measured_at TEXT NOT NULL,
      value_mmol_l REAL NOT NULL,
      context TEXT NOT NULL,
      note TEXT
    );
    CREATE TABLE IF NOT EXISTS medication_reminders (
      id TEXT PRIMARY KEY NOT NULL,
      medicine_name TEXT NOT NULL,
      hour INTEGER NOT NULL,
      minute INTEGER NOT NULL,
      notification_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS shelf_messages (
      id TEXT PRIMARY KEY NOT NULL,
      created_at TEXT NOT NULL,
      role TEXT NOT NULL,
      local_image_uri TEXT,
      payload_json TEXT
    );
  `);
  return db;
}
