import { AuthError } from "../auth/errors.js";
import { renewSession } from "../auth/session.js";
import { LOGIN_COMMAND } from "../constants.js";
import type { CommandContext } from "./context.js";

export async function status({ fetch, credentials, terminal }: CommandContext): Promise<number> {
  const stored = await credentials.load();
  if (!stored) {
    terminal.printError(`Not logged in to Rouvy. Run \`${LOGIN_COMMAND}\` in a terminal.`);
    return 1;
  }
  terminal.print(`Logged in to Rouvy as ${stored.email ?? "(unknown email)"} (uid ${stored.uid}).`);

  try {
    await renewSession(fetch, credentials, stored);
  } catch (error) {
    const reason = error instanceof AuthError ? error.message : "unexpected error.";
    terminal.printError(`Session refresh: failed (${reason}) Run \`${LOGIN_COMMAND}\` to log in again.`);
    return 1;
  }
  terminal.print("Session refresh: OK.");
  return 0;
}
