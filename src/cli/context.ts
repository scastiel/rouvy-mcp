import type { CredentialsProvider } from "../credentials/types.js";
import type { Terminal } from "./terminal.js";

/** What every CLI subcommand gets. `fetch` already carries the project user agent. */
export interface CommandContext {
  fetch: typeof globalThis.fetch;
  credentials: CredentialsProvider;
  credentialsPath: string;
  terminal: Terminal;
}
