import { writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { runCanary } from "./canary.js";

/**
 * The daily account-free canary, against the real Rouvy. `CANARY_REPORT` names a file to write
 * a Markdown report to, which the scheduled workflow turns into an issue on failure.
 */
it("Rouvy still answers the way rouvy-mcp expects", async () => {
  const checks = await runCanary(globalThis.fetch);

  const report = checks.map((check) => `- ${check.ok ? "✅" : "❌"} **${check.name}**: ${check.detail}`).join("\n");
  console.log(report);
  if (process.env.CANARY_REPORT) await writeFile(process.env.CANARY_REPORT, report + "\n");
  expect(checks.filter((check) => !check.ok)).toEqual([]);
});
