// Loads Appwrite credentials from .env.appwrite at the repo root.
// Credentials are NEVER hard-coded here — everything comes from process.env
// after dotenv has populated it. .env.appwrite is gitignored.

import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..");
const ENV_FILE = resolve(ROOT, ".env.appwrite");

let loaded = false;

function loadEnvFile() {
  if (loaded) return;
  loaded = true;
  if (!existsSync(ENV_FILE)) {
    throw new Error(
      `.env.appwrite not found at ${ENV_FILE}\n` +
        `Copy .env.appwrite.example to .env.appwrite and fill in the values.`,
    );
  }
  const result = config({ path: ENV_FILE, quiet: true });
  if (result.error) throw result.error;
}

function required(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing ${name} in .env.appwrite — set it before running this script.`);
  }
  return value;
}

/**
 * @returns {{endpoint:string, projectId:string, databaseId:string, apiKey:string,
 *            sqlitePath:string|null, scope:string}}
 */
export function getConfig() {
  loadEnvFile();
  return {
    endpoint: required("APPWRITE_ENDPOINT"),
    projectId: required("APPWRITE_PROJECT_ID"),
    databaseId: required("APPWRITE_DATABASE_ID"),
    apiKey: required("APPWRITE_API_KEY"),
    sqlitePath: (process.env.APPWRITE_SQLITE_PATH ?? "").trim() || null,
    // Namespaces every synced document. Two machines/customers sharing one
    // Appwrite database would otherwise collide on the unique natural keys
    // (supplier code, PO number, ...) — same collision the erp_backups
    // migration warns about on the Supabase side.
    scope: (process.env.APPWRITE_SYNC_SCOPE ?? "").trim() || "default",
  };
}

/** Config for schema setup only — no SQLite needed. */
export function getServerConfig() {
  const c = getConfig();
  return {
    endpoint: c.endpoint,
    projectId: c.projectId,
    databaseId: c.databaseId,
    apiKey: c.apiKey,
  };
}
