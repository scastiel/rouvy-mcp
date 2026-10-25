import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { firebaseError, json, rouvySessionOpened } from "../fakes.js";
import {
  activityRow,
  AUTH_DATA,
  detail,
  fakeIdToken,
  fixtureDetail,
  LIST,
  listPage,
  REFRESH,
  ROUTE_ACTIVITY,
} from "../server-harness.js";
import {
  CONSENTED,
  connect,
  connectRider,
  hostedWorker,
  MCP_URL,
  mcpRequest,
  openSignIn,
  ORIGIN,
  refresh,
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

  it("says it's unofficial and links to the privacy notice and to self-hosting", async () => {
    const worker = hostedWorker();
    const { page } = await openSignIn(worker, await registerClient(worker));

    const html = await page.text();

    expect(html).toContain("Test client wants to read your Rouvy rides");
    expect(html).toContain("client.example.com");
    expect(html).toContain("Unofficial, not affiliated with Rouvy");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="https://github.com/scastiel/rouvy-mcp#self-host-on-cloudflare"');
  });

  it("shows a client name containing HTML as text", async () => {
    const worker = hostedWorker();
    const { page } = await openSignIn(worker, await registerClient(worker, '<img src=x onerror="alert(1)">'));

    const html = await page.text();

    expect(html).not.toContain("<img");
    expect(html).toContain("&#60;img src=x onerror=&#34;alert(1)&#34;&#62; wants to read your Rouvy rides");
  });

  it("asks for consent again, boxes unticked, when a rider who already connected signs in again", async () => {
    const worker = hostedWorker({
      allowList: "rider@example.com",
      routes: { [SIGN_IN]: signedIn("uid-1", "rider@example.com") },
    });
    const clientId = await registerClient(worker);
    const first = await openSignIn(worker, clientId);
    const connected = await submitSignIn(worker, first, { email: "rider@example.com", password: "pw", ...CONSENTED });
    expect(connected.status).toBe(302);

    const { page } = await openSignIn(worker, clientId);
    const html = await page.text();

    expect(page.status).toBe(200);
    expect(html).toContain('<input name="accept_risk" type="checkbox" required>');
    expect(html).toContain('<input name="consent_health" type="checkbox" required>');
    expect(html).not.toContain("checked");
  });

  it("turns away an email that isn't on the allow-list without asking Firebase", async () => {
    const worker = hostedWorker({
      allowList: "rider@example.com",
      routes: { [SIGN_IN]: signedIn("uid-1", "stranger@example.com") },
    });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "stranger@example.com", password: "a guess", ...CONSENTED });

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("This instance is invite-only");
    expect(html).toContain("#self-host-on-cloudflare");
    expect(response.headers.get("location")).toBeNull();
    expect(worker.network.requests).toHaveLength(0);
  });

  it("is invite-only for everyone while the allow-list secret isn't set", async () => {
    const worker = hostedWorker({ routes: { [SIGN_IN]: signedIn("uid-1", "rider@example.com") } });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "rider@example.com", password: "pw", ...CONSENTED });

    expect(await response.text()).toContain("This instance is invite-only");
    expect(worker.network.requests).toHaveLength(0);
  });

  it("checks the allow-list again on the email Firebase signed in", async () => {
    const worker = hostedWorker({
      allowList: "Rider@Example.com",
      routes: { [SIGN_IN]: signedIn("uid-1", "someone-else@example.com") },
    });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "rider@example.com", password: "pw", ...CONSENTED });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("This instance is invite-only");
  });

  it("shows M1's plain message for a wrong password, never Firebase's answer, and lets the rider retry", async () => {
    const worker = hostedWorker({
      allowList: "rider@example.com",
      routes: { [SIGN_IN]: () => firebaseError("INVALID_LOGIN_CREDENTIALS : rider@example.com") },
    });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "rider@example.com", password: "wrong", ...CONSENTED });
    const html = await response.clone().text();

    expect(html).toContain("Wrong email or password.");
    expect(html).not.toContain("INVALID_LOGIN_CREDENTIALS");
    expect(html).not.toContain('value="wrong"');
    // A fresh form, so the rider can try again.
    expect((await submitSignIn(worker, { page: response }, { email: "rider@example.com", password: "again", ...CONSENTED })).status).toBe(200);
  });
});

describe("consent on the sign-in page", () => {
  it("words the risk box around Rouvy's terms and the Hard stop, and the health box as Art. 9 explicit consent", async () => {
    const worker = hostedWorker();
    const { page } = await openSignIn(worker, await registerClient(worker));

    const html = await page.text();
    const label = (name: string) => new RegExp(`<input name="${name}"[^>]*>\\s*<span>(.*?)</span>`, "s").exec(html)?.[1] ?? "";

    expect(label("accept_risk")).toContain("§7.c");
    expect(label("accept_risk")).toContain("§14.a.vi");
    expect(label("accept_risk")).toContain("Hard stop");
    expect(label("consent_health")).toContain("explicit consent");
    expect(label("consent_health")).toContain("GDPR Art. 9(2)(a)");
  });

  it("says who runs the instance the rider is handing their Rouvy login to", async () => {
    const worker = hostedWorker();
    const { page } = await openSignIn(worker, await registerClient(worker));

    expect(await page.text()).toContain("Unofficial, not affiliated with Rouvy. Run by Test Operator.");
  });

  it.each([
    ["neither box", {}],
    ["only the risk box", { accept_risk: "on" }],
    ["only the health-data box", { consent_health: "on" }],
  ])("refuses to connect with %s ticked, without asking Firebase", async (_, boxes) => {
    const worker = hostedWorker({
      allowList: "rider@example.com",
      routes: { [SIGN_IN]: signedIn("uid-1", "rider@example.com") },
    });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "rider@example.com", password: "pw", ...boxes });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Tick both boxes to connect.");
    expect(worker.network.requests).toHaveLength(0);
  });

  it("tells a rider who isn't on the allow-list that it's invite-only before asking for the boxes", async () => {
    const worker = hostedWorker({ allowList: "rider@example.com" });
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { email: "stranger@example.com", password: "pw" });

    expect(await response.text()).toContain("This instance is invite-only");
  });
});

describe("the privacy notice", () => {
  it("is served at the /privacy the sign-in page links to", async () => {
    const worker = hostedWorker();

    const response = await worker.fetch("/privacy");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Privacy");
  });

  it("names this instance's operator as controller and Law 25 person in charge, with their contact address", async () => {
    const worker = hostedWorker({ operator: { name: "Ada <Operator>", contact: "privacy@ada.example" } });

    const html = await (await worker.fetch("/privacy")).text();

    expect(html).toContain("Ada &#60;Operator&#62;");
    expect(html).not.toContain("<Operator>");
    expect(html).toContain('<a href="mailto:privacy@ada.example">privacy@ada.example</a>');
    expect(html).toMatch(/person in charge of the protection of personal information/i);
  });

  it("has the twelve sections of the Art. 13 notice, in order", async () => {
    const html = await (await hostedWorker().fetch("/privacy")).text();

    const headings = [...html.matchAll(/<h2>(.*?)<\/h2>/g)].map(([, heading]) => heading);

    expect(headings).toEqual([
      "1. Who is responsible",
      "2. Person in charge under Québec's Law 25",
      "3. What it's for",
      "4. Legal basis",
      "5. Who receives your data",
      "6. Where it's kept",
      "7. How long it's kept",
      "8. Your rights, and how to disconnect",
      "9. Complaints",
      "10. No automated decisions",
      "11. If Rouvy objects: the Hard stop",
      "12. EU Data Act",
    ]);
  });

  it("states the bases, recipients and retention the instance actually runs with", async () => {
    const html = await (await hostedWorker().fetch("/privacy")).text();

    for (const fact of [
      "Art. 6(1)(a)",
      "Art. 9(2)(a)",
      "Cloudflare",
      "processor",
      "European Union",
      "30 days",
      "7 days",
      "30 minutes",
      "No ride data is stored",
      "Commission d'accès à l'information",
      "24 hours",
      "duties of its Art. 6",
    ]) {
      expect(html).toContain(fact);
    }
  });

  it("lists the three ways to disconnect, and erasure on request", async () => {
    const html = await (await hostedWorker().fetch("/privacy")).text();

    expect(html).toMatch(/remove the connector/i);
    expect(html).toMatch(/change your Rouvy password/i);
    expect(html).toMatch(/write to/i);
    expect(html).toMatch(/erase/i);
  });
});

describe("cancelling on the sign-in page", () => {
  it("sends the rider back to the client with access_denied, without asking Firebase", async () => {
    const worker = hostedWorker();
    const signIn = await openSignIn(worker, await registerClient(worker));

    const response = await submitSignIn(worker, signIn, { action: "cancel" });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe("https://client.example.com/callback");
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("client-state");
    expect(worker.network.requests).toHaveLength(0);
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

const RIDER = "rider@example.com";

type HostedWorker = ReturnType<typeof hostedWorker>;

/** One allow-listed rider, uid-1, with one Activity. */
function workerWithRider(routes: NonNullable<Parameters<typeof hostedWorker>[0]>["routes"] = {}) {
  return hostedWorker({
    allowList: RIDER,
    routes: { [SIGN_IN]: signedIn("uid-1", RIDER), [LIST]: () => listPage([activityRow("a00")]), ...routes },
  });
}

const listActivities = (worker: HostedWorker, token: string) =>
  mcpRequest(worker, token, "tools/call", { name: "list_activities", arguments: { limit: 1 } });

/** The Session renewals sent since the `since`-th request. */
const renewals = (worker: HostedWorker, since: number) =>
  worker.network.requests.slice(since).filter((r) => r.url.host === "securetoken.googleapis.com");

/** securetoken handing back idTokens that expire in 10 minutes, so a call 6 minutes later renews. */
function shortLivedIdTokens(worker: HostedWorker, refreshToken: (presented: string) => Response | string) {
  worker.network.routes[REFRESH] = (request) => {
    const answer = refreshToken(new URLSearchParams(request.body).get("refresh_token") ?? "");
    if (answer instanceof Response) return answer;
    return json({ id_token: fakeIdToken("uid-1", worker.clock.now() + 10 * 60_000), refresh_token: answer, user_id: "uid-1" });
  };
}

describe("a Grant", () => {
  it.each(["INVALID_REFRESH_TOKEN", "TOKEN_EXPIRED", "USER_NOT_FOUND", "USER_DISABLED"])(
    "ends when Firebase answers %s: /mcp answers 401 and the client's refresh gets invalid_grant",
    async (answer) => {
      const worker = workerWithRider();
      const tokens = await connect(worker, RIDER);
      worker.network.routes[REFRESH] = () => firebaseError(answer);

      const response = await listActivities(worker, tokens.accessToken);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
      const refreshed = await refresh(worker, tokens);
      expect(refreshed.status).toBe(400);
      expect(await refreshed.json()).toMatchObject({ error: "invalid_grant" });
      expect((await listActivities(worker, tokens.accessToken)).status).toBe(401);
    },
  );

  it.each([
    ["Firebase says TOO_MANY_ATTEMPTS_TRY_LATER", REFRESH, () => firebaseError("TOO_MANY_ATTEMPTS_TRY_LATER")],
    ["Firebase answers a 5xx", REFRESH, () => new Response(null, { status: 503 })],
    ["Rouvy refuses auth.data despite a fresh idToken", AUTH_DATA, () => new Response(null, { status: 202 })],
  ])("lives on when %s: the rider gets a 'try again later' tool error", async (_, route, failure) => {
    const worker = workerWithRider();
    const tokens = await connect(worker, RIDER);
    const working = worker.network.routes[route]!;
    worker.network.routes[route] = failure;

    const failed = await listActivities(worker, tokens.accessToken);

    expect(failed.status).toBe(200);
    const { result } = (await failed.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Try (again )?later\.$/);
    expect(result.content[0]!.text).not.toContain("npx");
    worker.network.routes[route] = working;
    const retried = await listActivities(worker, tokens.accessToken);
    expect(JSON.stringify(await retried.json())).toContain("a00");
    expect((await refresh(worker, tokens)).status).toBe(200);
  });
});

describe("a rider's tool calls", () => {
  it("run one after the other: the second waits for the first, so one Session serves both", async () => {
    const worker = workerWithRider({
      [detail(ROUTE_ACTIVITY)]: () => new Response(fixtureDetail("route"), { headers: { "content-type": "text/x-script" } }),
    });
    const token = await connectRider(worker, RIDER);
    const signInRequests = worker.network.requests.length;
    // Rouvy is slow to open the first call's Session: the second call arrives meanwhile.
    let openSession!: () => void;
    const slow = new Promise<void>((resolve) => (openSession = resolve));
    worker.network.routes[AUTH_DATA] = async () => (await slow, rouvySessionOpened());

    const responses = Promise.all([
      listActivities(worker, token),
      mcpRequest(worker, token, "tools/call", { name: "get_activity", arguments: { activity_id: ROUTE_ACTIVITY } }),
    ]);
    await worker.reachedDurableObject(2);
    openSession();

    expect((await responses).map((r) => r.status)).toEqual([200, 200]);
    const sent = worker.network.requests.slice(signInRequests).map((r) => r.url.host + r.url.pathname);
    expect(sent).toEqual([REFRESH, AUTH_DATA, LIST, detail(ROUTE_ACTIVITY)]);
  });
});

describe("a rider's instance", () => {
  async function renewalsAfterIdle(idleMs: number) {
    const worker = workerWithRider();
    const token = await connectRider(worker, RIDER);
    const signInRequests = worker.network.requests.length;

    await listActivities(worker, token);
    worker.clock.advance(idleMs);
    const response = await listActivities(worker, token);

    expect(JSON.stringify(await response.json())).toContain("a00");
    return renewals(worker, signInRequests).length;
  }

  it("is kept while the rider is active: their live Session serves the next call", async () => {
    expect(await renewalsAfterIdle(29 * 60_000)).toBe(1);
  });

  it("is gone after 30 minutes idle: the next call opens a new Session", async () => {
    expect(await renewalsAfterIdle(30 * 60_000)).toBe(2);
  });

  it("keeps a refresh token Firebase rotated, and counts the rotation", async () => {
    const worker = workerWithRider();
    const token = await connectRider(worker, RIDER);
    let issued = 0;
    shortLivedIdTokens(worker, () => `rotated-${++issued}`);
    const signInRequests = worker.network.requests.length;

    await listActivities(worker, token);
    worker.clock.advance(6 * 60_000);
    await listActivities(worker, token);

    expect(new URLSearchParams(renewals(worker, signInRequests)[1]!.body).get("refresh_token")).toBe("rotated-1");
    expect(worker.refreshTokenRotations()).toBe(2);
  });

  it("keeps each Grant's rotated refresh token when the rider alternates between two clients", async () => {
    const worker = workerWithRider();
    const tokens = [await connectRider(worker, RIDER), await connectRider(worker, RIDER)];
    // Firebase rotates each refresh token once, and the old one stops working.
    const dead = new Set<string>();
    shortLivedIdTokens(worker, (presented) => {
      if (dead.has(presented)) return firebaseError("INVALID_REFRESH_TOKEN");
      if (presented.endsWith("-rotated")) return presented;
      dead.add(presented);
      return `${presented}-rotated`;
    });

    for (const token of [tokens[0]!, tokens[1]!, tokens[0]!]) {
      const response = await listActivities(worker, token);
      expect(response.status).toBe(200);
      worker.clock.advance(6 * 60_000);
    }
  });
});
