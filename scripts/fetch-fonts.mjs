// Re-downloads the Cairo webfont that the desktop build ships locally.
//
// The .exe has to render Arabic correctly on a machine with no internet, so
// electron-app/index.html must NOT link fonts.googleapis.com. This script pulls
// the same files Google would serve and rewrites the @font-face rules to point
// at electron-app/fonts/. Run it only when you want to refresh the font:
//
//   node scripts/fetch-fonts.mjs
//
// The output (electron-app/fonts.css + electron-app/fonts/*.woff2) is committed,
// so a normal build never touches the network.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const CSS_URL = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap";

// Google returns woff2 only when the request looks like a modern browser;
// a default Node user-agent gets legacy ttf.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const outDir = path.resolve("electron-app/fonts");
const cssOut = path.resolve("electron-app/fonts.css");

const css = await fetch(CSS_URL, { headers: { "User-Agent": UA } }).then((r) => {
  if (!r.ok) throw new Error(`Google Fonts returned ${r.status}`);
  return r.text();
});

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const blocks = [...css.matchAll(/\/\* (\S+) \*\/\s*@font-face \{(.*?)\}/gs)];
if (blocks.length === 0) throw new Error("no @font-face blocks in the Google CSS");

/** remote url -> local filename */
const downloaded = new Map();
const faces = [];

for (const [, subset, body] of blocks) {
  const url = body.match(/url\((https:\/\/[^)]+)\)/)[1];
  if (!downloaded.has(url)) {
    // Cairo is a variable font: Google serves ONE file per subset and reuses it
    // for every weight, so key the download by subset rather than by weight.
    const name = `cairo-${subset}.woff2`;
    const buf = Buffer.from(await fetch(url).then((r) => r.arrayBuffer()));
    await writeFile(path.join(outDir, name), buf);
    downloaded.set(url, name);
  }
  faces.push(
    `/* ${subset} */\n@font-face {${body.replace(url, `./fonts/${downloaded.get(url)}`)}}`,
  );
}

const header = `/* Cairo, self-hosted for the desktop build.
   The .exe must render correctly with no network at all, so it cannot
   depend on fonts.googleapis.com. Regenerate with: npm run fonts:fetch */
`;
await writeFile(cssOut, header + faces.join("\n") + "\n");

console.log(`fonts: ${faces.length} @font-face rules, ${downloaded.size} files -> ${outDir}`);
