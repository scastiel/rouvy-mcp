// Writes package.json's version into src/version.ts, so the build carries it and nothing reads
// package.json at runtime (Workers have none). Runs before every build and on `npm version`.
//
//   node scripts/write-version.mjs
import { readFile, writeFile } from "node:fs/promises";

const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await writeFile(
  new URL("../src/version.ts", import.meta.url),
  `// Written by scripts/write-version.mjs from package.json. Don't edit by hand.\nexport const VERSION = ${JSON.stringify(version)};\n`,
);
