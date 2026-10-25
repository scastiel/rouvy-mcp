import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../scripts/check-health.mjs", import.meta.url));

const PASSING_CHECKS = [
  { name: "anonymous GET of the Activity list", ok: true, detail: "202, redirect to sign-in" },
  { name: "Firebase sign-in with the pinned key and made-up credentials", ok: true, detail: "Firebase answered HTTP 400" },
];

const NO_SIGNALS = { cloudflare: 0, auth_data_refused: 0, persisting: false };

let server: Server | undefined;
afterEach(() => server?.close());

/** A stand-in for the Worker's `/health`, answering `status` and `body`. */
async function fakeHealth(status: number, body: unknown): Promise<string> {
  server = createServer((_, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/health`;
}

/**
 * Runs the workflow's step as the workflow does: its exit code, the report it leaves for the
 * issue, and the step outputs the issue's verdict reads.
 */
async function checkHealth(url: string) {
  const dir = await mkdtemp(join(tmpdir(), "health-"));
  const report = join(dir, "report.md");
  const outputs = join(dir, "outputs");
  const env = { ...process.env, HEALTH_URL: url, HEALTH_REPORT: report, GITHUB_OUTPUT: outputs };
  const exitCode = await new Promise<number>((resolve) => {
    execFile(process.execPath, [SCRIPT], { env }, (error) => resolve(error ? Number(error.code ?? 1) : 0));
  });
  return { exitCode, report: await readFile(report, "utf8"), outputs: await readFile(outputs, "utf8").catch(() => "") };
}

describe("the canary workflow's /health check", () => {
  it("passes when every Worker-side check passes and no block persists", async () => {
    const url = await fakeHealth(200, { ok: true, checks: PASSING_CHECKS, blockSignals: NO_SIGNALS });

    const { exitCode, report, outputs } = await checkHealth(url);

    expect(exitCode).toBe(0);
    expect(outputs).toContain("persisting=false");
    expect(report).toContain("✅ **Worker: anonymous GET of the Activity list**: 202, redirect to sign-in");
  });

  it("fails, with the failing check in the report, when /health reports a failing check", async () => {
    const checks = [{ ...PASSING_CHECKS[0], ok: false, detail: "Cloudflare answered 403 with an HTML page" }, PASSING_CHECKS[1]];
    const url = await fakeHealth(503, { ok: false, checks, blockSignals: NO_SIGNALS });

    const { exitCode, report } = await checkHealth(url);

    expect(exitCode).toBe(1);
    expect(report).toContain("❌ **Worker: anonymous GET of the Activity list**: Cloudflare answered 403 with an HTML page");
  });

  it("fails when /health reports hard block signals persisting for over an hour", async () => {
    const blockSignals = { cloudflare: 3, auth_data_refused: 0, persisting: true };
    const url = await fakeHealth(503, { ok: false, checks: PASSING_CHECKS, blockSignals });

    const { exitCode, report, outputs } = await checkHealth(url);

    expect(exitCode).toBe(1);
    expect(outputs).toContain("persisting=true");
    expect(report).toMatch(/❌ \*\*Worker: hard block signals in the last 24 h\*\*: 3 Cloudflare, 0 auth\.data refused, over more than an hour/);
  });

  it("fails when /health doesn't answer with its report", async () => {
    const url = await fakeHealth(502, "<html>Bad gateway</html>");

    const { exitCode, report } = await checkHealth(url);

    expect(exitCode).toBe(1);
    expect(report).toMatch(/❌ \*\*Worker: \/health\*\*: HTTP 502, not a health report/);
  });

  it("fails when /health can't be reached", async () => {
    const url = await fakeHealth(200, {});
    server!.close();

    const { exitCode, report } = await checkHealth(url);

    expect(exitCode).toBe(1);
    expect(report).toMatch(/❌ \*\*Worker: \/health\*\*: request failed/);
  });
});
