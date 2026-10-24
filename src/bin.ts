#!/usr/bin/env node
import { homedir } from "node:os";
import { createNodeTerminal } from "./cli/node-terminal.js";
import { runCli } from "./cli/run.js";
import { defaultCredentialsPath } from "./credentials/file.js";

const credentialsPath = defaultCredentialsPath({ env: process.env, platform: process.platform, homedir: homedir() });

process.exitCode = await runCli(process.argv.slice(2), {
  fetch: globalThis.fetch,
  credentialsPath,
  terminal: createNodeTerminal(),
});
