import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";

const LOCAL_SERVER_TOKEN_KEY = "diabetes-coaching.local-server-token";

export type LocalServerSettingsRecord = {
  baseUrl: string;
  apiKey: string;
  preferredMode: "mock" | "validate" | "gpt";
};

export async function ensureLocalServerSettingsTable(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_server_settings (
      id TEXT PRIMARY KEY NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      preferred_mode TEXT NOT NULL
    );
  `);
}

export async function getLocalServerSettings(db: SQLite.SQLiteDatabase): Promise<LocalServerSettingsRecord | null> {
  await ensureLocalServerSettingsTable(db);
  const rows = await db.getAllAsync<{
    base_url: string;
    api_key: string;
    preferred_mode: "mock" | "validate" | "gpt";
  }>("SELECT base_url, api_key, preferred_mode FROM local_server_settings WHERE id = 'default' LIMIT 1");
  if (rows.length === 0) return null;
  let apiKey = "";
  try {
    apiKey = await SecureStore.getItemAsync(LOCAL_SERVER_TOKEN_KEY) ?? "";
    if (!apiKey && rows[0].api_key) {
      apiKey = rows[0].api_key;
      await SecureStore.setItemAsync(LOCAL_SERVER_TOKEN_KEY, apiKey);
      await db.runAsync("UPDATE local_server_settings SET api_key = '' WHERE id = 'default'");
    }
  } catch {
    apiKey = "";
  }
  return {
    baseUrl: rows[0].base_url,
    apiKey,
    preferredMode: rows[0].preferred_mode
  };
}

export async function saveLocalServerSettings(db: SQLite.SQLiteDatabase, settings: LocalServerSettingsRecord) {
  await ensureLocalServerSettingsTable(db);
  if (settings.apiKey) {
    await SecureStore.setItemAsync(LOCAL_SERVER_TOKEN_KEY, settings.apiKey);
  } else {
    await SecureStore.deleteItemAsync(LOCAL_SERVER_TOKEN_KEY);
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO local_server_settings (id, base_url, api_key, preferred_mode)
     VALUES ('default', ?, ?, ?)`,
    settings.baseUrl,
    "",
    settings.preferredMode
  );
}

export async function clearLocalServerSettings(db: SQLite.SQLiteDatabase) {
  await ensureLocalServerSettingsTable(db);
  await SecureStore.deleteItemAsync(LOCAL_SERVER_TOKEN_KEY);
  await db.runAsync("DELETE FROM local_server_settings WHERE id = 'default'");
}
