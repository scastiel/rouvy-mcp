import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { writePrivateFile } from "../private-file.js";
import type { Credentials, CredentialsProvider } from "./types.js";

export interface CredentialsPathContext {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
  homedir: string;
}

/** `%APPDATA%\rouvy-mcp\credentials.json` on Windows, `$XDG_CONFIG_HOME/rouvy-mcp/credentials.json` elsewhere. */
export function defaultCredentialsPath({ env, platform, homedir }: CredentialsPathContext): string {
  const configDir =
    platform === "win32"
      ? (env.APPDATA ?? join(homedir, "AppData", "Roaming"))
      : env.XDG_CONFIG_HOME || join(homedir, ".config");
  return join(configDir, "rouvy-mcp", "credentials.json");
}

/** Stores the rider's Credentials as JSON in a local file only the user can read. */
export function createFileCredentialsProvider(path: string): CredentialsProvider {
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
      return parseCredentials(text);
    },
    async save(credentials) {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writePrivateFile(path, JSON.stringify(credentials, null, 2) + "\n");
    },
  };
}

/**
 * A half-written or hand-edited file counts as not logged in. Never rethrows: a JSON.parse
 * error quotes the text around the problem, which would leak part of the refresh token.
 */
function parseCredentials(text: string): Credentials | null {
  let value: { refreshToken?: unknown; uid?: unknown; email?: unknown };
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value?.refreshToken !== "string" || typeof value.uid !== "string") return null;
  return {
    refreshToken: value.refreshToken,
    uid: value.uid,
    ...(typeof value.email === "string" && { email: value.email }),
  };
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}
