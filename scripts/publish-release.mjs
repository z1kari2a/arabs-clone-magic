// Publishes the built installer to GitHub Releases, where the app looks for it.
//
//   npm run make:setup          # build ERP-Setup-<version>.exe first
//   npm run release:publish     # then this
//
// Two files go up, and both matter:
//
//   ERP-Setup-<version>.exe   the installer itself
//   latest.yml                the manifest electron-updater reads
//
// latest.yml is what makes an update happen at all: the app fetches it, compares
// its `version` with the running one, downloads the file it names, and refuses
// the download unless the sha512 matches. electron-builder writes this file as
// part of its own pipeline; this project builds its installer with NSIS
// directly (see make-installer.mjs), so it is written here instead.
//
// The tag MUST be v<version> — that is where electron-updater's GitHub provider
// looks for latest.yml, and a tag it cannot parse as a version (v1.0.0-oneclick,
// say) is read as a pre-release and skipped.
//
// Flags:
//   --dry-run        write latest.yml and stop — touches nothing else
//   --no-upload      also refresh release/, but do not publish to GitHub
//   --notes="…"      release notes (default: the newest commit's subject)
//   --keep-release   leave release/ERP-Desktop-Windows alone

import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

const ROOT = path.resolve();
const OUT_DIR = path.join(ROOT, "electron-release");
const SHIP_DIR = path.join(ROOT, "release", "ERP-Desktop-Windows");

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag) => argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);

const DRY_RUN = has("--dry-run");
const NO_UPLOAD = has("--no-upload");
const KEEP_RELEASE = has("--keep-release");

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const version = pkg.version;
const tag = `v${version}`;
const setupName = `ERP-Setup-${version}.exe`;
const setupPath = path.join(OUT_DIR, setupName);
const manifestPath = path.join(OUT_DIR, "latest.yml");

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `package.json version is "${version}" — the updater compares plain x.y.z versions, ` +
      "so publish a release without a pre-release suffix.",
  );
}

if (!existsSync(setupPath)) {
  throw new Error(
    `${path.relative(ROOT, setupPath)} does not exist — run \`npm run make:setup\` first.\n` +
      "(If you bumped the version after building, build again: the file name carries the version.)",
  );
}

// --------------------------------------------------------------- latest.yml

const bytes = await readFile(setupPath);
// base64, not hex: this is the encoding builder-util-runtime compares against
// after the download, and a hex digest here fails every update with a checksum
// error that says nothing about why.
const sha512 = createHash("sha512").update(bytes).digest("base64");
const size = bytes.length;

const manifest = [
  `version: ${version}`,
  "files:",
  `  - url: ${setupName}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${setupName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${new Date().toISOString()}'`,
  "",
].join("\n");

await writeFile(manifestPath, manifest);
console.log(`• latest.yml   ${version}, ${mb(size)}, sha512 ${sha512.slice(0, 12)}…`);

// ------------------------------------------------------- keep release/ in sync

// The repository ships the current installer under release/ (tracked with Git
// LFS). Keeping exactly one there is the convention: two versions double what
// every clone has to pull.
if (!KEEP_RELEASE && !DRY_RUN) {
  const stale = (await readdir(SHIP_DIR)).filter(
    (name) => /^ERP-Setup-.*\.exe$/.test(name) && name !== setupName,
  );
  for (const name of stale) {
    await rm(path.join(SHIP_DIR, name));
    console.log(`• removed     release/ERP-Desktop-Windows/${name}`);
  }
  await copyFile(setupPath, path.join(SHIP_DIR, setupName));
  console.log(`• copied      release/ERP-Desktop-Windows/${setupName}`);
  await refreshShipReadme();
}

// That folder's README states the file name, the size and a SHA-256 the customer
// is told to verify against. Left to a human they go stale silently, and a
// published hash that does not match the published file is worse than no hash.
async function refreshShipReadme() {
  const file = path.join(SHIP_DIR, "README.md");
  if (!existsSync(file)) return;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const text = (await readFile(file, "utf8"))
    .replace(/ERP-Setup-\d+\.\d+\.\d+\.exe/g, setupName)
    .replace(/^(\| الحجم \| ).*( \|)$/m, `$1${Math.round(size / 1024 / 1024)} ميغابايت$2`)
    .replace(/^(\| الإصدار \| ).*( \|)$/m, `$1${version}$2`)
    .replace(/^(\| SHA-256 \| `).*(` \|)$/m, `$1${sha256}$2`);
  await writeFile(file, text);
  console.log(`• updated     release/ERP-Desktop-Windows/README.md (sha256 ${sha256.slice(0, 12)}…)`);
}

if (DRY_RUN || NO_UPLOAD) {
  console.log(`\n${DRY_RUN ? "--dry-run" : "--no-upload"}: nothing uploaded.`);
  console.log(`  publishing would create ${tag} with ${setupName} + latest.yml`);
  process.exit(0);
}

// ------------------------------------------------------------------ upload

if (!(await which("gh"))) {
  throw new Error(
    "the GitHub CLI (gh) is not installed — install it, or upload " +
      `${path.relative(ROOT, setupPath)} and ${path.relative(ROOT, manifestPath)} ` +
      `to a release tagged ${tag} by hand.`,
  );
}

try {
  await exec("gh", ["auth", "status"]);
} catch {
  throw new Error("gh is not signed in — run: gh auth login");
}

const notes = value("--notes") ?? (await exec("git", ["log", "-1", "--pretty=%s"])).stdout.trim();

const exists = await releaseExists(tag);
if (exists) {
  console.log(`• release ${tag} already exists — replacing its files`);
  await run("gh", ["release", "upload", tag, setupPath, manifestPath, "--clobber"]);
} else {
  console.log(`• creating release ${tag}`);
  await run("gh", [
    "release",
    "create",
    tag,
    setupPath,
    manifestPath,
    "--title",
    `ERP ${version}`,
    "--notes",
    notes,
    "--latest",
  ]);
}

console.log(`\n✓ ${tag} published`);
console.log("  installed copies will offer this update within a few hours,");
console.log("  or immediately from «مساعدة → التحقق من وجود تحديث».");

// ----------------------------------------------------------------- helpers

async function releaseExists(name) {
  try {
    await exec("gh", ["release", "view", name, "--json", "tagName"]);
    return true;
  } catch {
    return false;
  }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
    );
  });
}

async function which(bin) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (existsSync(path.join(dir, bin))) return path.join(dir, bin);
  }
  return null;
}

function mb(n) {
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
