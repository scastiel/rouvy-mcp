import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { firebaseError } from "../fakes.js";
import { activityRow, LIST, listPage, REFRESH } from "../server-harness.js";
import {
  connectRider,
  hostedWorker,
  MCP_URL,
  mcpRequest,
  openSignIn,
  ORIGIN,
  registerClient,
  SIGN_IN,
  signedIn,
  submitSignIn,
} from "./harness.js";

describe("discovery", () => {
  it("names the MCP URL as the resource and this origin as its authorization server", async () => {
    const worker = hostedWorker();

    const metadata = await (await worker.fetch("/.well-known/oauth-protected-resource/mcp")).json();

    expect(metadata).toMatchObject({ resource: MCP_URL, authorization_servers: [ORIGIN] });
  });

  it("offers both CIMD (claude.ai) and dynamic registration (clients without CIMD), without scopes", async () => {
    const worker = hostedWorker();

    const metadata = (await (await worker.fetch("/.well-known/oauth-authorization-server")).json()) as Record<string, unknown>;

    expect(metadata).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/authorize`,
      registration_endpoint: `${ORIGIN}/register`,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ["S256"],
    });
    expect(metadata.scopes_supported).toBeUndefined();
  });
});

describe("the sign-in page", () => {
  it("asks for the rider's Rouvy email and password", async () => {
    const worker = hostedWorker();
    const { page } = await openSignIn(worker, await registerClient(worker));

    const html = await page.text();

    expect(page.status).toBe(200);
    expect(html).toContain('name="email"');
    expect(html).toContain('type="password"');
  });

  it("turns away an email that isn't on the allow-list without asking Firebase", async () => {
    const worker = hostedWorker({
      allowList: "rider@example.com",
      routes: { [SIGN_IN]: signedIn("uid-1", "stranger@example.com") },
    });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "stranger@example.com", password: "a guess" });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("This instance is invite-only");
    expect(html).toContain("#self-host-on-cloudflare");
    expect(worker.network.requests).toHaveLength(0);
  });

  it("is invite-only for everyone while the allow-list secret isn't set", async () => {
    const worker = hostedWorker({ routes: { [SIGN_IN]: signedIn("uid-1", "rider@example.com") } });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "rider@example.com", password: "pw" });

    expect(await response.text()).toContain("This instance is invite-only");
    expect(worker.network.requests).toHaveLength(0);
  });

  it("checks the allow-list again on the email Firebase signed in", async () => {
    const worker = hostedWorker({
      allowList: "Rider@Example.com",
      routes: { [SIGN_IN]: signedIn("uid-1", "someone-else@example.com") },
    });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "rider@example.com", password: "pw" });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("This instance is invite-only");
  });

  it("shows M1's plain message for a wrong password, never Firebase's answer, and lets the rider retry", async () => {
    const worker = hostedWorker({
      allowList: "rider@example.com",
      routes: { [SIGN_IN]: () => firebaseError("INVALID_LOGIN_CREDENTIALS : rider@example.com") },
    });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "rider@example.com", password: "wrong" });
    const html = await response.clone().text();

    expect(html).toContain("Wrong email or password.");
    expect(html).not.toContain("INVALID_LOGIN_CREDENTIALS");
    expect(html).not.toContain('value="wrong"');
    // A fresh form, so the rider can try again.
    expect((await submitSignIn(worker, { page: response }, { email: "rider@example.com", password: "again" })).status).toBe(200);
  });
});

describe("an allow-listed rider", () => {
  const RIDER = "rider@example.com";

  function workerWithRiders(list = () => listPage([activityRow("a00")])) {
    return hostedWorker({
      allowList: `${RIDER}, second@example.com`,
      routes: {
        [SIGN_IN]: async (request) => {
          const email = JSON.parse(request.body).email as string;
          return signedIn(email === RIDER ? "uid-1" : "uid-2", email)();
        },
        [LIST]: list,
      },
    });
  }

  it("signs in and lists their Activities", async () => {
    const worker = workerWithRiders();
    const token = await connectRider(worker, RIDER);

    const response = await mcpRequest(worker, token, "tools/call", { name: "list_activities", arguments: { limit: 1 } });

    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain("a00");
    expect(worker.jurisdictions).toEqual(["eu"]);
  });

  it("is served to an SDK v2 client over stateless HTTP, with JSON answers and no stream", async () => {
    const worker = workerWithRiders();
    const token = await connectRider(worker, RIDER);
    const exchanges: { method: string; status: number; type: string | null }[] = [];
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: async (url, init) => {
        const response = await worker.fetch(String(url), init);
        exchanges.push({ method: init?.method ?? "GET", status: response.status, type: response.headers.get("content-type") });
        return response;
      },
    });
    const client = new Client({ name: "test", version: "0.0.0" });

    await client.connect(transport);
    const result = await client.callTool({ name: "list_activities", arguments: { limit: 1 } });

    expect(JSON.stringify(result)).toContain("a00");
    for (const exchange of exchanges) {
      if (exchange.method === "GET") expect(exchange.status).toBe(405);
      else expect(exchange.status === 202 || exchange.type?.startsWith("application/json")).toBe(true);
    }
    await client.close();
  });

  it("answers server/discover and tool calls at 2026-07-28, which claude.ai tries first", async () => {
    const worker = workerWithRiders();
    const token = await connectRider(worker, RIDER);
    const _meta = {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientInfo": { name: "test", version: "0.0.0" },
      "io.modelcontextprotocol/clientCapabilities": {},
    };

    const discover = await mcpRequest(worker, token, "server/discover", { _meta }, "2026-07-28");
    const call = await mcpRequest(
      worker,
      token,
      "tools/call",
      { name: "list_activities", arguments: { limit: 1 }, _meta },
      "2026-07-28",
    );

    expect(discover.status).toBe(200);
    expect(((await discover.json()) as { result: { supportedVersions: string[] } }).result.supportedVersions).toContain(
      "2026-07-28",
    );
    expect(call.status).toBe(200);
    expect(JSON.stringify(await call.json())).toContain("a00");
  });

  it("leaves no Rouvy token in KV that a dump could read", async () => {
    const worker = workerWithRiders();
    await connectRider(worker, RIDER);

    const stored = JSON.stringify([...worker.kv]);

    expect(stored).not.toContain("refresh-for-uid-1");
    expect(stored).not.toContain("id-token-uid-1");
    expect(stored).not.toContain("correct horse");
  });

  it("is told to reconnect, not to run the stdio login command, when the Rouvy sign-in has ended", async () => {
    const worker = workerWithRiders();
    const token = await connectRider(worker, RIDER);
    worker.network.routes[REFRESH] = () => firebaseError("TOKEN_EXPIRED");

    const response = await mcpRequest(worker, token, "tools/call", { name: "list_activities", arguments: {} });
    const body = JSON.stringify(await response.json());

    expect(body).toContain("Reconnect rouvy-mcp in your MCP client");
    expect(body).not.toContain("npx");
  });

  it("can't use GET on the MCP endpoint", async () => {
    const worker = workerWithRiders();
    const token = await connectRider(worker, RIDER);

    const response = await worker.fetch("/mcp", { headers: { authorization: `Bearer ${token}` } });

    expect(response.status).toBe(405);
  });

  it("shares one polite queue with other riders, each with their own Session", async () => {
    const worker = workerWithRiders();
    const tokens = [await connectRider(worker, RIDER), await connectRider(worker, "second@example.com")];
    const signInRequests = worker.network.requests.length;

    const responses = await Promise.all(
      tokens.map((token) => mcpRequest(worker, token, "tools/call", { name: "list_activities", arguments: { limit: 1 } })),
    );

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const sent = worker.network.requests.slice(signInRequests);
    // Each rider renewed their own Session from their own Grant, then listed with its cookie.
    const renewals = sent.filter((r) => r.url.host === "securetoken.googleapis.com").map((r) => r.body);
    expect(renewals).toHaveLength(2);
    expect(renewals).toEqual(
      expect.arrayContaining([expect.stringContaining("refresh-for-uid-1"), expect.stringContaining("refresh-for-uid-2")]),
    );
    expect(sent.filter((r) => r.url.host === "riders.rouvy.com")).toHaveLength(2);
    // One queue: every request started at least 1 s after the previous one.
    const starts = worker.clockReadings.slice(-sent.length);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(1_000);
  });

  it("keeps one live Session when connected from two clients (two Grants)", async () => {
    const worker = workerWithRiders();
    const tokens = [await connectRider(worker, RIDER), await connectRider(worker, RIDER)];
    const signInRequests = worker.network.requests.length;

    for (const token of [...tokens, ...tokens]) {
      const response = await mcpRequest(worker, token, "tools/call", { name: "list_activities", arguments: { limit: 1 } });
      expect(JSON.stringify(await response.json())).toContain("a00");
    }

    const renewals = worker.network.requests.slice(signInRequests).filter((r) => r.url.host === "securetoken.googleapis.com");
    expect(renewals).toHaveLength(1);
  });

  it("isn't offered export_activity_file: there's no export folder on the hosted server", async () => {
    const worker = workerWithRiders();
    const token = await connectRider(worker, RIDER);

    const response = await mcpRequest(worker, token, "tools/list");
    const names = ((await response.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);

    expect(names).toContain("list_activities");
    expect(names).not.toContain("export_activity_file");
  });
});

describe("the hosted MCP endpoint", () => {
  it("answers a request without a token with 401 and where to find the authorization server", async () => {
    const worker = hostedWorker();

    const response = await mcpRequest(worker, undefined, "tools/list");

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );
  });
});
