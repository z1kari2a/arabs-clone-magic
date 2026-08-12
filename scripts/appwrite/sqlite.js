// Loads better-sqlite3, working around the ABI split between plain Node and
// Electron.
//
// better-sqlite3 is a native module: one compiled binary per ABI. This repo
// installs the binary that matches the *Electron* runtime the desktop app
// ships (see scripts/fetch-sqlite-prebuild.mjs), so requiring it from a plain
// `node` process fails with NODE_MODULE_VERSION mismatch. Rather than force the
// user to keep two copies, a CLI that needs SQLite re-executes itself under
// Electron's bundled Node (ELECTRON_RUN_AS_NODE=1), which has the matching ABI.

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const RELAUNCH_FLAG = "ERP_SYNC_ELECTRON_RELAUNCH";

/** @returns {{ok: true, Database: any} | {ok: false, reason: string, abiMismatch: boolean}} */
export function loadSqlite() {
  try {
    const Database = require("better-sqlite3");
    // require() alone proves nothing: better-sqlite3 dlopen()s its binding
    // lazily inside the constructor, so the ABI mismatch only shows up here.
    new Database(":memory:").close();
    return { ok: true, Database };
  } catch (err) {
    const message = String(err?.message ?? err);
    const abiMismatch =
      err?.code === "ERR_DLOPEN_FAILED" ||
      /NODE_MODULE_VERSION|was compiled against a different Node\.js version/.test(message);
    return { ok: false, reason: message, abiMismatch };
  }
}

/**
 * Re-runs the current script under Electron's Node and forwards its exit code.
 * Returns false when relaunching is not possible (already relaunched, or no
 * Electron installed) so the caller can report the real problem.
 */
export function relaunchUnderElectron() {
  if (process.env[RELAUNCH_FLAG]) return false;

  let electronPath;
  try {
    electronPath = require("electron");
  } catch {
    return false;
  }
  if (typeof electronPath !== "string") return false;

  const result = spawnSync(electronPath, [process.argv[1], ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", [RELAUNCH_FLAG]: "1" },
  });
  if (result.error) return false;
  process.exit(result.status ?? 1);
}

export const ABI_HELP =
  "better-sqlite3's compiled binary does not match this Node runtime.\n" +
  "  • easiest: run the command again on Node 22+ (the app's Electron runtime is used automatically when available)\n" +
  "  • or:      ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron scripts/sync.js\n" +
  "  • or:      npm rebuild better-sqlite3   (rebuilds for plain Node — then re-run\n" +
  "             `npm run sqlite:prebuild` before building the desktop app again)";
