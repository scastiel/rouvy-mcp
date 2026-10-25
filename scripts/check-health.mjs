// The Worker side of the daily canary (docs/spec-m2.md §9): asks the Public instance's /health,
// which runs the same account-free checks from the Worker's own egress and counts the hard block
// signals. Writes a Markdown report to HEALTH_REPORT, in the canary's format, for the drift issue,
// and exits 1 when anything fails.
//
//   HEALTH_URL=https://example.workers.dev/health node scripts/check-health.mjs
import { writeFile } from "node:fs/promises";

const url = process.env.HEALTH_URL;
if (!url) {
  console.error("HEALTH_URL is not set");
  process.exit(2);
}

const lines = [];
const line = (ok, name, detail) => lines.push(`- ${ok ? "✅" : "❌"} **Worker: ${name}**: ${detail}`);
let ok = false;

try {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const health = await response.json().catch(() => undefined);
  if (!Array.isArray(health?.checks) || typeof health.blockSignals !== "object") {
    line(false, "/health", `HTTP ${response.status}, not a health report`);
  } else {
    for (const check of health.checks) line(check.ok, check.name, check.detail);
    const { cloudflare, auth_data_refused: authDataRefused, persisting } = health.blockSignals;
    const spread = persisting ? "over more than an hour: a block" : "not persisting";
    line(!persisting, "hard block signals in the last 24 h", `${cloudflare} Cloudflare, ${authDataRefused} auth.data refused, ${spread}`);
    ok = response.ok && health.ok === true;
  }
} catch (error) {
  line(false, "/health", `request failed: ${error.message}`);
}

const report = lines.join("\n");
console.log(report);
if (process.env.HEALTH_REPORT) await writeFile(process.env.HEALTH_REPORT, report + "\n");
process.exit(ok ? 0 : 1);
