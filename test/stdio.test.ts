import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = new URL("..", import.meta.url).pathname;

/** Starts the built bin as an MCP client would, sends one raw JSON-RPC request and returns the first answer. */
async function ask(request: Record<string, unknown>) {
  const config = mkdtempSync(join(tmpdir(), "rouvy-mcp-stdio-"));
  const bin = spawn(process.execPath, [join(repoRoot, "dist/bin.js")], {
    env: { ...process.env, XDG_CONFIG_HOME: config, APPDATA: config, ROUVY_MCP_EXPORT_DIR: "" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  try {
    const lines = createInterface({ input: bin.stdout });
    bin.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, ...request })}\n`);
    for await (const line of lines) return JSON.parse(line);
    throw new Error("The bin closed stdout without answering.");
  } finally {
    bin.kill();
    rmSync(config, { recursive: true, force: true });
  }
}

describe("the stdio bin", () => {
  // The bin is what riders run: test the build, not the sources.
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], { cwd: repoRoot, stdio: "ignore" });
  }, 60_000);

  it("answers server/discover at 2026-07-28", async () => {
    const answer = await ask({
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });

    expect(answer.error).toBeUndefined();
    expect(answer.result.supportedVersions).toContain("2026-07-28");
    expect(answer.result.capabilities.tools).toBeDefined();
  });

  it("still accepts a legacy initialize at 2025-11-25", async () => {
    const answer = await ask({
      method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0.0.0" } },
    });

    expect(answer.error).toBeUndefined();
    expect(answer.result.protocolVersion).toBe("2025-11-25");
    expect(answer.result.serverInfo.name).toBe("rouvy-mcp");
  });
});
