#!/usr/bin/env node
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNodeTerminal } from "./cli/node-terminal.js";
import { runCli } from "./cli/run.js";
import { createFileCredentialsProvider, defaultCredentialsPath } from "./credentials/file.js";
import { createServer } from "./server.js";

const credentialsPath = defaultCredentialsPath({ env: process.env, platform: process.platform, homedir: homedir() });
const args = process.argv.slice(2);

if (args.length === 0) {
  // MCP over stdio: stdout belongs to the protocol, so nothing else may print there.
  const server = createServer({ credentials: createFileCredentialsProvider(credentialsPath) });
  await server.connect(new StdioServerTransport());
} else {
  process.exitCode = await runCli(args, {
    fetch: globalThis.fetch,
    credentialsPath,
    terminal: createNodeTerminal(),
  });
}
