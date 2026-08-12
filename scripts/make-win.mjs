// One command turns this repo into a runnable Windows program.
//
//   npm run make:win
//
// Output: electron-release/ERP-win32-x64/ERP.exe (plus its runtime files).
//
// Everything the standalone desktop build needs that a plain `electron-packager`
// invocation gets wrong is handled here:
//
//   1. package.json `main` points at electron/shell-main.cjs — that is the
//      LICENSE SHELL product, not this one. The copy inside the package is
//      rewritten to electron/main.cjs so the .exe boots the real app.
//   2. better-sqlite3 is native. Packager copies whatever is in node_modules,
//      which on a Linux build machine is a Linux binary (or nothing at all).
//      The matching electron/win32-x64 prebuild is injected instead.
//   3. `dependencies` holds the whole React/Radix tree, all of it already
//      bundled into dist-electron. Shipping it again would bloat the package,
//      so node_modules is filtered down to what the main process actually
//      requires at runtime.
//   4. Icon and version metadata are stamped onto the .exe (needs wine when
//      building from Linux — see below).

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import packager from "@electron/packager";

const run = promisify(execFile);

const ROOT = path.resolve();
const OUT_DIR = path.join(ROOT, "electron-release");
const APP_NAME = "ERP";

// Windows is the product; `--platform=linux` stays available because the old
// electron:build:linux script offered it, and it is a cheap way to sanity-check
// the packaged layout on the build machine itself.
const TARGET = process.argv.find((a) => a.startsWith("--platform="))?.split("=")[1] ?? "win32";
const isWin = TARGET === "win32";

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const electronVersion = pkg.devDependencies.electron.replace(/^[^\d]*/, "");

// ---------------------------------------------------------------- wine check

// @electron/packager shells out to rcedit (a Windows .exe) to set the icon and
// version strings. Off Windows that needs wine. Ubuntu installs the binary
// outside PATH, so look there before giving up.
function ensureRcedit() {
  if (!isWin || process.platform === "win32") return true;
  const onPath = process.env.PATH.split(path.delimiter).some(
    (d) => existsSync(path.join(d, "wine64")) || existsSync(path.join(d, "wine")),
  );
  if (onPath) return true;
  for (const dir of ["/usr/lib/wine", "/usr/lib64/wine", "/opt/wine-stable/bin"]) {
    if (existsSync(path.join(dir, "wine64")) || existsSync(path.join(dir, "wine"))) {
      process.env.PATH = `${dir}${path.delimiter}${process.env.PATH}`;
      return true;
    }
  }
  return false;
}

const canBrand = ensureRcedit();
if (!canBrand) {
  console.warn(
    "\n!! wine not found — the .exe will build, but keeps the default Electron\n" +
      "!! icon and no version metadata. Install wine, or run this on Windows,\n" +
      "!! to brand it.\n",
  );
}

// ------------------------------------------------------------------- prepare

console.log("• building the renderer (dist-electron/)");
await run("npm", ["run", "build:electron"], { cwd: ROOT, maxBuffer: 1 << 26 });

console.log(`• fetching the ${TARGET}-x64 better-sqlite3 prebuild`);
await run("node", [path.join("scripts", "fetch-sqlite-prebuild.mjs"), `--platform=${TARGET}`], {
  cwd: ROOT,
});

const ELECTRON_ABI = { 42: 146, 41: 145, 40: 143, 39: 140, 38: 139, 37: 136, 36: 135, 35: 133 };
const abi = ELECTRON_ABI[Number(electronVersion.split(".")[0])];
const prebuilt = path.join(ROOT, ".cache/better-sqlite3", `electron-v${abi}-${TARGET}-x64.node`);
if (!existsSync(prebuilt)) throw new Error(`missing prebuild: ${prebuilt}`);

const iconPath = path.join(ROOT, "build/icon.ico");
if (isWin && !existsSync(iconPath))
  throw new Error("build/icon.ico is missing — run: npm run icon");

// -------------------------------------------------------------- what to ship

// The only modules the MAIN process requires at runtime; everything the
// renderer uses is already compiled into dist-electron. better-sqlite3 locates
// its .node through `bindings`, which in turn pulls in file-uri-to-path — npm
// hoists both to the top level, so dropping them would break
// `require("better-sqlite3")` inside the packaged app. prebuild-install and its
// large tree are install-time only and stay out.
const KEEP_MODULES = ["better-sqlite3", "bcryptjs", "bindings", "file-uri-to-path"];

// Paths arrive as "/electron/main.cjs" — repo-root-relative with a leading slash.
const ignore = [
  new RegExp(`^/node_modules/(?!(${KEEP_MODULES.join("|")})($|/))`),
  /^\/src($|\/)/,
  /^\/public($|\/)/,
  /^\/docs($|\/)/,
  /^\/supabase($|\/)/,
  /^\/scripts($|\/)/,
  // build/ is packaging input, except the icon itself: main.cjs passes it to
  // BrowserWindow so the window and taskbar show the app's icon rather than
  // Electron's default.
  /^\/build\/(?!icon\.ico$)/,
  /^\/electron-app($|\/)/,
  /^\/electron-shell($|\/)/,
  /^\/electron-release($|\/)/,
  /^\/shell-release($|\/)/,
  /^\/dist($|\/)/,
  // Every root-level dotfile. This is the rule that keeps .env out of the
  // package — packager copies it happily otherwise, and a .env shipped to a
  // customer machine hands them whatever credentials it holds. Also covers
  // .git, .output, .cache, .lovable, .claude, .wrangler, .tanstack.
  /^\/\.[^/]+($|\/)/,
  // The license-shell product has its own entry point and preload; the
  // standalone build must not carry them.
  /^\/electron\/shell-/,
  /^\/(bun\.lock|package-lock\.json|tsconfig\.json|components\.json|bunfig\.toml)$/,
  /^\/(vite|eslint)\..*$/,
  /^\/(AGENTS|README)\.md$/,
];

// ------------------------------------------------------------------- package

console.log(`• packaging for ${TARGET}-x64`);
const [appPath] = await packager({
  dir: ROOT,
  name: APP_NAME,
  executableName: APP_NAME,
  platform: TARGET,
  arch: "x64",
  out: OUT_DIR,
  overwrite: true,
  electronVersion,
  appVersion: pkg.version,
  icon: isWin && canBrand ? iconPath : undefined,
  prune: false, // `ignore` above already trims node_modules far harder
  ignore,
  win32metadata: {
    CompanyName: pkg.author ?? "Fikra Digital",
    ProductName: "ERP",
    FileDescription: "ERP — نظام المشتريات",
    OriginalFilename: `${APP_NAME}.exe`,
    InternalName: APP_NAME,
  },
  afterCopy: [
    async (buildPath, _electronVersion, _platform, _arch, done) => {
      try {
        // (1) point Electron at the standalone entry, not the license shell
        const pkgPath = path.join(buildPath, "package.json");
        const copied = JSON.parse(await readFile(pkgPath, "utf8"));
        copied.main = "electron/main.cjs";
        copied.name = APP_NAME.toLowerCase();
        copied.productName = "ERP";
        // devDependencies in a shipped package.json only confuse tooling.
        delete copied.devDependencies;
        delete copied.scripts;
        await writeFile(pkgPath, JSON.stringify(copied, null, 2));

        // (2) drop in the Windows native binary
        const dest = path.join(
          buildPath,
          "node_modules/better-sqlite3/build/Release/better_sqlite3.node",
        );
        await mkdir(path.dirname(dest), { recursive: true });
        await copyFile(prebuilt, dest);

        // better-sqlite3 ships its full C sources (~5 MB of amalgamation) that
        // are only needed to compile it, never to run it.
        await rm(path.join(buildPath, "node_modules/better-sqlite3/deps"), {
          recursive: true,
          force: true,
        });
        await rm(path.join(buildPath, "node_modules/better-sqlite3/src"), {
          recursive: true,
          force: true,
        });

        done();
      } catch (err) {
        done(err);
      }
    },
  ],
});

// -------------------------------------------------------------------- verify

const exe = path.join(appPath, isWin ? `${APP_NAME}.exe` : APP_NAME);
if (!existsSync(exe)) throw new Error(`packager finished but ${exe} is missing`);

const mustExist = [
  "resources/app/electron/main.cjs",
  "resources/app/electron/preload.cjs",
  "resources/app/electron/splash.html",
  "resources/app/electron/db.cjs",
  "resources/app/build/icon.ico",
  "resources/app/dist-electron/index.html",
  "resources/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
  ...KEEP_MODULES.map((m) => `resources/app/node_modules/${m}/package.json`),
];
const missing = mustExist.filter((rel) => !existsSync(path.join(appPath, rel)));
if (missing.length) throw new Error(`packaged app is incomplete:\n  ${missing.join("\n  ")}`);

const shipped = JSON.parse(
  await readFile(path.join(appPath, "resources/app/package.json"), "utf8"),
);
if (shipped.main !== "electron/main.cjs") {
  throw new Error(`packaged main is "${shipped.main}", expected electron/main.cjs`);
}

// A .env inside a customer's install folder is a credential leak, so refuse to
// call the build good if one slipped through the ignore rules.
const leaked = (await readdir(path.join(appPath, "resources/app"))).filter((n) =>
  n.startsWith("."),
);
if (leaked.length) {
  throw new Error(`dotfiles leaked into the package: ${leaked.join(", ")}`);
}

async function dirSize(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`\n✓ ${path.relative(ROOT, exe)}`);
console.log(`  size: ${mb(await dirSize(appPath))}${canBrand ? "" : "  (unbranded — no wine)"}`);
if (isWin) {
  console.log(
    `  copy the whole ${path.basename(appPath)} folder to the Windows machine and run ${APP_NAME}.exe`,
  );
}
