import { rm } from "node:fs/promises";
import type { CommandContext } from "./context.js";

export async function logout({ credentialsPath, terminal }: CommandContext): Promise<number> {
  try {
    // Straight to the file, without parsing it: a corrupt file must go too.
    await rm(credentialsPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    terminal.print("Not logged in to Rouvy. Nothing to do.");
    return 0;
  }
  terminal.print(`Logged out: removed ${credentialsPath}.`);
  // Firebase has no client-side revoke, so a copied refresh token keeps working until the password changes.
  terminal.print("To revoke these credentials everywhere, change your Rouvy password.");
  return 0;
}
