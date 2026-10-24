import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileCredentialsProvider, defaultCredentialsPath } from "../src/credentials/file.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rouvy-mcp-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("file credentials provider", () => {
  it("saves credentials to a 0600 file in a 0700 directory and loads them back", async () => {
    const path = join(root, "rouvy-mcp", "credentials.json");
    const provider = createFileCredentialsProvider(path);

    await provider.save({ refreshToken: "rt-1", uid: "uid-1", email: "rider@example.com" });

    expect(await provider.load()).toEqual({ refreshToken: "rt-1", uid: "uid-1", email: "rider@example.com" });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, "rouvy-mcp"))).mode & 0o777).toBe(0o700);
  });

  it("keeps the file at 0600 when overwriting one with looser permissions", async () => {
    const path = join(root, "credentials.json");
    await writeFile(path, "{}", { mode: 0o644 });
    const provider = createFileCredentialsProvider(path);

    await provider.save({ refreshToken: "rt-2", uid: "uid-2" });

    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await provider.load()).toEqual({ refreshToken: "rt-2", uid: "uid-2" });
  });

  it.each([
    {
      where: "XDG_CONFIG_HOME when set",
      env: { XDG_CONFIG_HOME: "/xdg" },
      platform: "linux",
      expected: join("/xdg", "rouvy-mcp", "credentials.json"),
    },
    {
      where: "~/.config by default",
      env: {},
      platform: "darwin",
      expected: join("/home/rider", ".config", "rouvy-mcp", "credentials.json"),
    },
    {
      where: "%APPDATA% on Windows",
      env: { APPDATA: "C:\\Users\\rider\\AppData\\Roaming" },
      platform: "win32",
      expected: join("C:\\Users\\rider\\AppData\\Roaming", "rouvy-mcp", "credentials.json"),
    },
  ] as const)("lives under $where", ({ env, platform, expected }) => {
    expect(defaultCredentialsPath({ env, platform, homedir: "/home/rider" })).toBe(expected);
  });

  it("loads nothing when no one has logged in", async () => {
    const provider = createFileCredentialsProvider(join(root, "rouvy-mcp", "credentials.json"));

    expect(await provider.load()).toBeNull();
  });
});
