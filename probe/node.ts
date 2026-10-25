// Node entry point, for long-lived hosts (Fly.io, a VPS) and for the home baseline.
//   tsx node.ts checks          account-free checks
//   tsx node.ts bench           CPU workloads, timed
//   tsx node.ts authed          needs ROUVY_REFRESH_TOKEN and ROUVY_UID (or the local credentials file)
//   tsx node.ts all             all three, checks first; authed only if they all pass
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createFileCredentialsProvider, defaultCredentialsPath } from "../src/credentials/file.js";
import { withUserAgent } from "../src/http.js";
import { systemClock } from "../src/rouvy/clock.js";
import { createRequestQueue } from "../src/rouvy/request-queue.js";
import { authedReads } from "./authed.js";
import { benchActivityFile, benchDetail, timed } from "./bench.js";
import { accountFreeChecks } from "./checks.js";

const politeFetch = withUserAgent(createRequestQueue(globalThis.fetch, systemClock));
const command = process.argv[2] ?? "all";
const report: Record<string, unknown> = { host: process.env.PROBE_HOST ?? "unnamed", at: new Date().toISOString(), node: process.version };

if (command === "checks" || command === "all") report.checks = await accountFreeChecks(politeFetch);

if (command === "bench" || command === "all") {
  const detail = await readFile(new URL("./inputs/synthetic-detail.data", import.meta.url), "utf8");
  const fit = await readFile(new URL("./inputs/synthetic-1h.fit", import.meta.url));
  // The first run is cold (JIT); later ones show what a warm isolate or process pays.
  const runs = Number(process.env.PROBE_RUNS ?? 5);
  const detailMs: number[] = [];
  const activityFileMs: number[] = [];
  let last: Record<string, unknown> = {};
  for (let run = 0; run < runs; run++) {
    const d = await timed(() => benchDetail(detail));
    const f = await timed(() => benchActivityFile(fit.buffer.slice(fit.byteOffset, fit.byteOffset + fit.byteLength)));
    detailMs.push(d.ms);
    activityFileMs.push(f.ms);
    last = { detail: d, activityFile: f };
  }
  report.bench = { ...last, detailMs, activityFileMs };
}

const checksPassed = !report.checks || (report.checks as { ok: boolean }[]).every((check) => check.ok);
if (command === "authed" || (command === "all" && checksPassed && process.env.PROBE_AUTHED === "1")) {
  const credentials = process.env.ROUVY_REFRESH_TOKEN
    ? { refreshToken: process.env.ROUVY_REFRESH_TOKEN, uid: process.env.ROUVY_UID ?? "" }
    : await createFileCredentialsProvider(defaultCredentialsPath({ env: process.env, platform: process.platform, homedir: homedir() })).load();
  report.authed = credentials ? await authedReads(politeFetch, credentials) : { error: "no credentials" };
}

console.log(JSON.stringify(report, null, 2));
