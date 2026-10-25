#!/usr/bin/env node
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createNodeTerminal } from "./cli/node-terminal.js";
import { runCli } from "./cli/run.js";
import { createFileCredentialsProvider, defaultCredentialsPath } from "./credentials/file.js";
import { createServer } from "./server.js";
import { createDirectoryStorage } from "./storage/directory.js";

const credentialsPath = defaultCredentialsPath({ env: process.env, platform: process.platform, homedir: homedir() });
const args = process.argv.slice(2);

if (args.length === 0) {
  // MCP over stdio: stdout belongs to the protocol, so nothing else may print there.
  // serveStdio answers both protocol eras: server/discover (2026-07-28) and the legacy initialize.
  const credentials = createFileCredentialsProvider(credentialsPath);
  const storage = exportStorage(process.env.ROUVY_MCP_EXPORT_DIR);
  serveStdio(() => createServer({ credentials, storage }));
} else {
  process.exitCode = await runCli(args, {
    fetch: globalThis.fetch,
    credentialsPath,
    terminal: createNodeTerminal(),
  });
}

/**
 * Opt-in: no folder, no export tool. A relative path would depend on wherever the MCP client
 * starts the server, so it leaves the tool off too, with a word on stderr.
 */
function exportStorage(dir: string | undefined) {
  if (!dir) return undefined;
  if (!isAbsolute(dir)) {
    console.error("rouvy-mcp: ROUVY_MCP_EXPORT_DIR must be an absolute path; export_activity_file is off.");
    return undefined;
  }
  return createDirectoryStorage(dir);
}
