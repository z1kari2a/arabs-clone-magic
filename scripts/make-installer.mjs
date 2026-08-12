// Turns the packaged app folder into a single Windows Setup .exe.
//
//   npm run make:installer
//
// Output: electron-release/ERP-Setup-<version>.exe
//
// The folder produced by `npm run make:win` is a valid program, but it is a
// folder: the customer has to copy 350 MB somewhere sensible, find ERP.exe
// inside it, and make their own shortcut — and Windows never learns the app
// exists. This wraps it the way commercial software ships: one file to run,
// Program Files install, Start-menu and desktop shortcuts, and an entry in
// "Programs and Features".
//
// Requires NSIS (makensis). Ubuntu/Debian: `sudo apt-get install nsis`.
// Windows: https://nsis.sourceforge.io — then add makensis.exe to PATH.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve();
const APP_DIR = path.join(ROOT, "electron-release", "ERP-win32-x64");
const NSI = path.join(ROOT, "scripts", "installer.nsi");
const ICON = path.join(ROOT, "build", "icon.ico");

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const OUT_FILE = path.join(ROOT, "electron-release", `ERP-Setup-${pkg.version}.exe`);

// ------------------------------------------------------------------- checks

if (!existsSync(path.join(APP_DIR, "ERP.exe"))) {
  throw new Error(
    `no packaged app at ${path.relative(ROOT, APP_DIR)} — run \`npm run make:win\` first`,
  );
}
if (!existsSync(ICON)) throw new Error("build/icon.ico is missing — run: npm run icon");

const makensis = await which("makensis");
if (!makensis) {
  throw new Error(
    "makensis was not found on PATH.\n" +
      "  Linux:   sudo apt-get install nsis\n" +
      "  Windows: install NSIS from https://nsis.sourceforge.io and add it to PATH",
  );
}

// ------------------------------------------------------------------ compile

// Defines are passed in rather than hardcoded in the .nsi so the script stays
// build-machine agnostic. NSIS source paths use forward slashes — makensis on
// Linux treats a backslash as part of the filename.
const args = [
  "-V2",
  `-DAPP_DIR=${APP_DIR.split(path.sep).join("/")}`,
  `-DAPP_ICON=${ICON.split(path.sep).join("/")}`,
  `-DAPP_VERSION=${pkg.version}`,
  `-DOUT_FILE=${OUT_FILE.split(path.sep).join("/")}`,
  NSI,
];

console.log(`• compressing ${path.relative(ROOT, APP_DIR)} (this takes a few minutes)`);
await run(makensis, args);

if (!existsSync(OUT_FILE)) throw new Error("makensis finished but the installer is missing");

const { size } = await stat(OUT_FILE);
const payload = await dirSize(APP_DIR);
console.log(`\n✓ ${path.relative(ROOT, OUT_FILE)}`);
console.log(`  ${mb(size)}  (from ${mb(payload)} of program files)`);
console.log("  send this single file to the customer — running it installs the program.");

// ------------------------------------------------------------------ helpers

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`)),
    );
  });
}

async function which(bin) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const name of [bin, `${bin}.exe`]) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
