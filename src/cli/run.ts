import { AuthError } from "../auth/errors.js";
import { createFileCredentialsProvider } from "../credentials/file.js";
import { withUserAgent } from "../http.js";
import { login } from "./login.js";
import { logout } from "./logout.js";
import { status } from "./status.js";
import type { Terminal } from "./terminal.js";

export interface CliDeps {
  fetch: typeof globalThis.fetch;
  credentialsPath: string;
  terminal: Terminal;
}

/** Runs one CLI subcommand and returns the process exit code. */
export async function runCli(args: string[], deps: CliDeps): Promise<number> {
  const context = {
    ...deps,
    fetch: withUserAgent(deps.fetch),
    credentials: createFileCredentialsProvider(deps.credentialsPath),
  };
  try {
    switch (args[0]) {
      case "login":
        return await login(context);
      case "logout":
        return await logout(context);
      case "status":
        return await status(context);
      default:
        deps.terminal.printError(
          "Usage: rouvy-mcp            serve MCP over stdio (what MCP clients run)\n" +
            "       rouvy-mcp <login | logout | status>",
        );
        return 2;
    }
  } catch (error) {
    // Only our own messages are shown: anything else could carry a token or a response body.
    deps.terminal.printError(error instanceof AuthError ? error.message : "Something went wrong talking to Rouvy. Try again later.");
    return 1;
  }
}
