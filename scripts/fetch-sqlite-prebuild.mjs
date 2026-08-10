// Downloads a prebuilt better_sqlite3.node for a given target.
//
// better-sqlite3 is the only native module in the desktop app. Building it from
// source needs a C++ toolchain for the *target* platform, which a Linux build
// machine does not have for Windows — so we fetch the binary the project
// publishes on GitHub instead. Two separate targets matter:
//
//   * electron / win32-x64 — what actually ships inside ERP.exe
//   * node    / linux-x64  — lets us run electron/db.cjs under plain node here,
//                            i.e. smoke-test the storage layer before shipping
//
// Usage:
//   node scripts/fetch-sqlite-prebuild.mjs                    # electron win32-x64
//   node scripts/fetch-sqlite-prebuild.mjs --runtime=node --platform=linux
//
// Binaries land in .cache/better-sqlite3/ and are copied into place by
// scripts/make-win.mjs; nothing here mutates node_modules unless --install.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);

// Electron and Node each have their own ABI numbering; a binary built for one
// will not load in the other, and the number changes with every major release.
// Keep this table in step with the `electron` devDependency.
const ELECTRON_ABI = { 42: 146, 41: 145, 40: 143, 39: 140, 38: 139, 37: 136, 36: 135, 35: 133 };
const NODE_ABI = { 24: 137, 22: 127, 20: 115 };

const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
const version = pkg.dependencies["better-sqlite3"].replace(/^[^\d]*/, "");

const runtime = args.runtime ?? "electron";
const platform = args.platform ?? (runtime === "electron" ? "win32" : process.platform);
const arch = args.arch ?? "x64";

function abiFor(runtimeName) {
  if (runtimeName === "node") {
    const major = Number(process.versions.node.split(".")[0]);
    const abi = NODE_ABI[major];
    if (!abi) throw new Error(`unknown node ABI for v${major} — add it to NODE_ABI`);
    return abi;
  }
  const major = Number(pkg.devDependencies.electron.replace(/^[^\d]*/, "").split(".")[0]);
  const abi = ELECTRON_ABI[major];
  if (!abi) throw new Error(`unknown electron ABI for v${major} — add it to ELECTRON_ABI`);
  return abi;
}

const abi = abiFor(runtime);
const asset = `better-sqlite3-v${version}-${runtime}-v${abi}-${platform}-${arch}.tar.gz`;
const url = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${version}/${asset}`;

const cacheDir = path.resolve(".cache/better-sqlite3");
const nodeFile = path.join(cacheDir, `${runtime}-v${abi}-${platform}-${arch}.node`);

if (existsSync(nodeFile) && !args.force) {
  console.log(`cached  ${path.relative(process.cwd(), nodeFile)}`);
} else {
  await mkdir(cacheDir, { recursive: true });
  console.log(`fetching ${asset}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `${res.status} ${res.statusText} for ${url}\n` +
        `better-sqlite3 ${version} may not publish a ${runtime}-v${abi}-${platform}-${arch} build; ` +
        `check https://github.com/WiseLibs/better-sqlite3/releases/tag/v${version}`,
    );
  }
  const tgz = Buffer.from(await res.arrayBuffer());
  const tmp = path.join(cacheDir, asset);
  await writeFile(tmp, tgz);
  // The tarball is prebuild-install's layout: build/Release/better_sqlite3.node
  await run("tar", ["-xzf", tmp, "-C", cacheDir, "build/Release/better_sqlite3.node"]);
  await copyFile(path.join(cacheDir, "build/Release/better_sqlite3.node"), nodeFile);
  console.log(`saved   ${path.relative(process.cwd(), nodeFile)}`);
}

const sha = createHash("sha256")
  .update(await readFile(nodeFile))
  .digest("hex")
  .slice(0, 16);
console.log(`sha256  ${sha}…  (${runtime} abi ${abi}, ${platform}-${arch})`);

if (args.install) {
  // Only useful for the host platform — puts the binary where `require()` looks.
  const dest = path.resolve("node_modules/better-sqlite3/build/Release/better_sqlite3.node");
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(nodeFile, dest);
  console.log(`installed into node_modules/better-sqlite3/build/Release/`);
}

export { nodeFile };
