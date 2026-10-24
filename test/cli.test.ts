import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli/run.js";
import { createFileCredentialsProvider } from "../src/credentials/file.js";
import { fakeNetwork, fakeTerminal, firebaseError, json, rouvySessionOpened } from "./fakes.js";

const SIGN_IN = "identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
const AUTH_DATA = "account.rouvy.com/resources/auth.data";
const REFRESH = "securetoken.googleapis.com/v1/token";

let root: string;
let credentialsPath: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "rouvy-mcp-cli-"));
  credentialsPath = join(root, "rouvy-mcp", "credentials.json");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function signedIn() {
  return json({
    kind: "identitytoolkit#VerifyPasswordResponse",
    localId: "uid-123",
    email: "rider@example.com",
    idToken: "id-token-secret",
    refreshToken: "refresh-token-secret",
    expiresIn: "3600",
    registered: true,
  });
}

describe("status", () => {
  it("reports who is logged in and that a refresh succeeds, keeping a rotated refresh token", async () => {
    await createFileCredentialsProvider(credentialsPath).save({
      refreshToken: "old-refresh-secret",
      uid: "uid-123",
      email: "rider@example.com",
    });
    const network = fakeNetwork({
      [REFRESH]: () =>
        json({
          id_token: "new-id-secret",
          refresh_token: "rotated-refresh-secret",
          user_id: "uid-123",
          expires_in: "3600",
          token_type: "Bearer",
        }),
      [AUTH_DATA]: rouvySessionOpened,
    });
    const { terminal, output } = fakeTerminal();

    const exitCode = await runCli(["status"], { fetch: network.fetch, credentialsPath, terminal });

    expect(exitCode).toBe(0);
    expect(output()).toContain("rider@example.com");
    expect(output()).toContain("uid-123");
    expect(output()).toMatch(/refresh: ok/i);
    expect(output()).not.toMatch(/secret|c2Vzc2lvbg/);
    expect(new URLSearchParams(network.requests[0]?.body)).toEqual(
      new URLSearchParams({ grant_type: "refresh_token", refresh_token: "old-refresh-secret" }),
    );
    expect(new URLSearchParams(network.requests[1]?.body).get("idToken")).toBe("new-id-secret");
    expect(await createFileCredentialsProvider(credentialsPath).load()).toEqual({
      refreshToken: "rotated-refresh-secret",
      uid: "uid-123",
      email: "rider@example.com",
    });
  });
});

describe("status when things are wrong", () => {
  it("says how to log in when there are no credentials", async () => {
    const { terminal, output } = fakeTerminal();

    const exitCode = await runCli(["status"], { fetch: fakeNetwork({}).fetch, credentialsPath, terminal });

    expect(exitCode).toBe(1);
    expect(output()).toContain("Not logged in");
    expect(output()).toContain("npx -y rouvy-mcp login");
  });

  it.each([
    { what: "not JSON", content: '{"refreshToken": "half-written-secret' },
    { what: "missing the refresh token", content: '{"uid": "uid-123"}' },
  ])("treats a credentials file that is $what as not logged in, quoting none of it", async ({ content }) => {
    await mkdir(join(root, "rouvy-mcp"), { recursive: true });
    await writeFile(credentialsPath, content);
    const { terminal, output } = fakeTerminal();

    const exitCode = await runCli(["status"], { fetch: fakeNetwork({}).fetch, credentialsPath, terminal });

    expect(exitCode).toBe(1);
    expect(output()).toContain("Not logged in");
    expect(output()).not.toContain("secret");
  });

  it("reports a failed refresh without printing tokens", async () => {
    await createFileCredentialsProvider(credentialsPath).save({ refreshToken: "dead-refresh-secret", uid: "uid-123" });
    const network = fakeNetwork({ [REFRESH]: () => firebaseError("TOKEN_EXPIRED dead-refresh-secret") });
    const { terminal, output } = fakeTerminal();

    const exitCode = await runCli(["status"], { fetch: network.fetch, credentialsPath, terminal });

    expect(exitCode).toBe(1);
    expect(output()).toContain("uid-123");
    expect(output()).toMatch(/refresh: failed/i);
    expect(output()).toContain("The login has expired.");
    expect(output()).not.toContain("Login failed");
    expect(output()).toContain("npx -y rouvy-mcp login");
    expect(output()).not.toContain("secret");
  });
});

describe("logout", () => {
  it("removes the credentials file", async () => {
    await createFileCredentialsProvider(credentialsPath).save({ refreshToken: "rt", uid: "uid-123" });
    const { terminal, output } = fakeTerminal();

    const exitCode = await runCli(["logout"], { fetch: fakeNetwork({}).fetch, credentialsPath, terminal });

    expect(exitCode).toBe(0);
    await expect(readFile(credentialsPath)).rejects.toThrow(/ENOENT/);
    expect(output()).toContain("Logged out");
    expect(output()).toMatch(/change your Rouvy password/i);
  });

  it("removes a corrupt credentials file too", async () => {
    await mkdir(join(root, "rouvy-mcp"), { recursive: true });
    await writeFile(credentialsPath, "not json at all");
    const { terminal, output } = fakeTerminal();

    const exitCode = await runCli(["logout"], { fetch: fakeNetwork({}).fetch, credentialsPath, terminal });

    expect(exitCode).toBe(0);
    await expect(readFile(credentialsPath)).rejects.toThrow(/ENOENT/);
    expect(output()).toContain("Logged out");
  });

  it("is fine when already logged out", async () => {
    const { terminal, output } = fakeTerminal();

    const exitCode = await runCli(["logout"], { fetch: fakeNetwork({}).fetch, credentialsPath, terminal });

    expect(exitCode).toBe(0);
    expect(output()).toContain("Not logged in");
  });
});

describe("login", () => {
  it("saves only the refresh token, uid and email, and says who is logged in", async () => {
    const network = fakeNetwork({ [SIGN_IN]: signedIn, [AUTH_DATA]: rouvySessionOpened });
    const { terminal, output } = fakeTerminal({ email: "rider@example.com", password: "hunter2" });

    const exitCode = await runCli(["login"], { fetch: network.fetch, credentialsPath, terminal });

    expect(exitCode).toBe(0);
    expect(JSON.parse(await readFile(credentialsPath, "utf8"))).toEqual({
      refreshToken: "refresh-token-secret",
      uid: "uid-123",
      email: "rider@example.com",
    });
    expect(output()).toContain("Logged in to Rouvy as rider@example.com");
  });

  it.each([
    { code: "INVALID_LOGIN_CREDENTIALS", message: "Wrong email or password." },
    { code: "INVALID_PASSWORD", message: "Wrong email or password." },
    { code: "EMAIL_NOT_FOUND", message: "Wrong email or password." },
    {
      code: "TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled",
      message: "Too many login attempts. Try again later.",
    },
    { code: "USER_DISABLED", message: "This Rouvy account is disabled." },
  ])("turns Firebase's $code into a plain message, echoing nothing back", async ({ code, message }) => {
    const network = fakeNetwork({
      // Firebase can echo the submitted password back in a failed response.
      [SIGN_IN]: () => firebaseError(`${code} hunter2`),
    });
    const { terminal, output } = fakeTerminal({ email: "rider@example.com", password: "hunter2" });

    const exitCode = await runCli(["login"], { fetch: network.fetch, credentialsPath, terminal });

    expect(exitCode).toBe(1);
    expect(output()).toContain(message);
    expect(output()).not.toContain("hunter2");
    expect(output()).not.toContain(code.split(" ")[0]);
    await expect(readFile(credentialsPath)).rejects.toThrow(/ENOENT/);
  });

  it("saves nothing when Rouvy refuses to open a session", async () => {
    const network = fakeNetwork({
      [SIGN_IN]: signedIn,
      [AUTH_DATA]: () => new Response("rouvy says no, id-token-secret", { status: 400 }),
    });
    const { terminal, output } = fakeTerminal({ email: "rider@example.com", password: "hunter2" });

    const exitCode = await runCli(["login"], { fetch: network.fetch, credentialsPath, terminal });

    expect(exitCode).toBe(1);
    expect(output()).toContain("Rouvy did not open a session");
    expect(output()).not.toMatch(/secret|rouvy says no/);
    await expect(readFile(credentialsPath)).rejects.toThrow(/ENOENT/);
  });

  it("sends the project user agent on every request", async () => {
    const network = fakeNetwork({ [SIGN_IN]: signedIn, [AUTH_DATA]: rouvySessionOpened });
    const { terminal } = fakeTerminal({ email: "rider@example.com", password: "hunter2" });

    await runCli(["login"], { fetch: network.fetch, credentialsPath, terminal });

    expect(network.requests.map((r) => r.url.host)).toEqual(["identitytoolkit.googleapis.com", "account.rouvy.com"]);
    for (const request of network.requests) {
      expect(request.headers.get("user-agent")).toMatch(
        /^rouvy-mcp\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/scastiel\/rouvy-mcp\)$/,
      );
    }
  });
});
