#!/usr/bin/env node
// Packages `dist-electron/` into a single gzipped JSON manifest ready to be
// uploaded via the admin panel. The server then encrypts + signs it.
//
//   Usage: node scripts/build-bundle.mjs [--out=bundle.json.gz]
//
// Output is a single binary file containing:
//   gzip( JSON.stringify({ version, files: { "path": "<base64>" } }) )
//
// Upload that file as-is in the admin "Upload Bundle" form. The server reads
// its bytes, AES-GCM encrypts them with the master key, RSA-signs the
// ciphertext, and stores both. The shell reverses the process on the client.
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, resolve, sep } from "node:path";

const root = resolve(process.cwd(), "dist-electron");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const outFile = outArg ? outArg.slice(6) : "bundle.bin";

try {
  statSync(root);
} catch {
  console.error("dist-electron/ not found. Run: npm run build:electron first.");
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = {};
for (const full of walk(root)) {
  const rel = relative(root, full).split(sep).join("/");
  files[rel] = readFileSync(full).toString("base64");
}

const version = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
const manifest = { version, files };
const gz = gzipSync(Buffer.from(JSON.stringify(manifest), "utf8"));
writeFileSync(outFile, gz);

console.log(`Wrote ${outFile}`);
console.log(`  version: ${version}`);
console.log(`  files:   ${Object.keys(files).length}`);
console.log(`  size:    ${(gz.length / 1024).toFixed(1)} KB`);