// Bundles worker.ts ourselves (wrangler then deploys it with no_bundle), so the build can say
// exactly what it had to change for the M1 code to run on Workers. SHIM=0 builds it unchanged.
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const shim = process.env.SHIM !== "0";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** src/constants.ts reads package.json from disk at import time; Workers has no such file. */
const constantsShim = {
  name: "constants-shim",
  setup(b) {
    b.onLoad({ filter: /src[\\/]constants\.ts$/ }, (args) => ({
      loader: "ts",
      contents: readFileSync(args.path, "utf8")
        .replace(/^import \{ readFileSync \} from "node:fs";\n/m, "")
        .replace(/const packageJson = [\s\S]*?\};\n/, `const packageJson = { version: ${JSON.stringify(version)} };\n`),
    }));
  },
};

await build({
  entryPoints: [new URL("./worker.ts", import.meta.url).pathname],
  outfile: new URL("./dist/worker.js", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  mainFields: ["module", "main"],
  conditions: ["workerd", "worker", "import"],
  external: ["node:*", "cloudflare:*"],
  loader: { ".fit": "binary", ".data": "text" },
  plugins: shim ? [constantsShim] : [],
  metafile: false,
  logLevel: "info",
});
console.log(`built dist/worker.js (constants shim: ${shim ? "on" : "off"})`);
