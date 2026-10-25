import { signInWithPassword } from "../auth/firebase.js";
import { openRouvySession } from "../auth/rouvy-session.js";
import type { CommandContext } from "./context.js";

export async function login({ fetch, credentials, terminal }: CommandContext): Promise<number> {
  const email = (await terminal.ask("Rouvy email: ")).trim();
  const password = await terminal.askHidden("Rouvy password: ");

  const tokens = await signInWithPassword(fetch, email, password);
  // Once, to confirm the account works on Rouvy, not just on Firebase.
  await openRouvySession(fetch, tokens);

  await credentials.save({ refreshToken: tokens.refreshToken, uid: tokens.uid, email });
  terminal.print(`Logged in to Rouvy as ${email} (uid ${tokens.uid}).`);
  return 0;
}
