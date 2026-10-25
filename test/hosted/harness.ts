import { createHash, randomBytes } from "node:crypto";
import type { BlockSignal, LogEvent } from "../../src/hosted/log.js";
import { createRidersHost, type GrantProps } from "../../src/hosted/riders.js";
import { createWorker } from "../../src/hosted/worker.js";
import type { Clock } from "../../src/rouvy/clock.js";
import { fakeNetwork, json, type RecordedRequest } from "../fakes.js";
import { AUTH_DATA, fakeClock, REFRESH, refreshes, rouvySessionOpened } from "../server-harness.js";

export const ORIGIN = "https://mcp.example.com";
export const MCP_URL = `${ORIGIN}/mcp`;
export const SIGN_IN = "identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
/** The address Cloudflare stamps on every request a client sends: it must never be logged. */
export const CLIENT_IP = "203.0.113.7";
const REDIRECT_URI = "https://client.example.com/callback";

type Routes = Parameters<typeof fakeNetwork>[0];

/** Workers KV, in memory: what the provider uses of it. */
export function fakeKV() {
  const entries = new Map<string, { value: string; metadata?: unknown }>();
  const kv = {
    async get(key: string, options?: "json" | { type?: string }) {
      const entry = entries.get(key);
      if (!entry) return null;
      const type = typeof options === "string" ? options : options?.type;
      return type === "json" ? JSON.parse(entry.value) : entry.value;
    },
    async put(key: string, value: string, options?: { metadata?: unknown }) {
      entries.set(key, { value, metadata: options?.metadata });
    },
    async delete(key: string) {
      entries.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      const keys = [...entries]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, { metadata }]) => ({ name, metadata }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  };
  return { kv, entries };
}

let signIns = 0;

/**
 * Firebase's answer to a good email and password. Each sign-in gets its own refresh token,
 * `refresh-for-<uid>~<n>`, as two Grants of one rider would.
 */
export function signedIn(uid: string, email: string) {
  return () =>
    json({ localId: uid, email, idToken: `id-token-${uid}`, refreshToken: `refresh-for-${uid}~${++signIns}`, registered: true });
}

/** securetoken answering for whichever uid the refresh token names, whichever sign-in it came from. */
function refreshesAnySignIn(clock: Clock) {
  const refresh = refreshes(clock);
  return (request: RecordedRequest) => {
    const body = new URLSearchParams(request.body);
    body.set("refresh_token", (body.get("refresh_token") ?? "").replace(/~\d+$/, ""));
    return refresh({ body: body.toString() });
  };
}

/**
 * The Worker as deployed, in Node: the real OAuth provider over an in-memory KV, its Durable
 * Object binding answered by one in-process riders host, and a fake network behind both.
 */
export const OPERATOR = { name: "Test Operator", contact: "privacy@operator.example" };

export function hostedWorker({
  allowList,
  routes = {},
  operator = OPERATOR,
}: { allowList?: string; routes?: Routes; operator?: { name: string; contact: string } } = {}) {
  const clock = fakeClock();
  const allRoutes: Routes = { [REFRESH]: refreshesAnySignIn(clock), [AUTH_DATA]: rouvySessionOpened, ...routes };
  const network = fakeNetwork(allRoutes);
  // When each request reached the network, in virtual time.
  const clockReadings: number[] = [];
  const timedFetch: typeof globalThis.fetch = (input, init) => {
    clockReadings.push(clock.now());
    return network.fetch(input, init);
  };
  const { kv, entries } = fakeKV();
  // Every line the Worker and the Durable Object logged, as Workers Logs would keep it.
  const logs: string[] = [];
  const log = (event: LogEvent) => logs.push(JSON.stringify(event));
  // The Durable Object's own storage, in memory.
  const storage = new Map<string, unknown>();
  const store = {
    get: async <T>(key: string) => storage.get(key) as T | undefined,
    put: async (key: string, value: unknown) => void storage.set(key, value),
  };
  const host = createRidersHost({ fetch: timedFetch, clock, log, store });
  const jurisdictions: string[] = [];
  // How many `/mcp` requests the Worker has handed to the Durable Object so far.
  let delivered = 0;
  const env = {
    OAUTH_KV: kv,
    PUBLIC_URL: ORIGIN,
    ALLOW_LIST: allowList,
    OPERATOR_NAME: operator.name,
    OPERATOR_CONTACT: operator.contact,
    RIDERS: {
      jurisdiction(name: string) {
        jurisdictions.push(name);
        return {
          idFromName: (objectName: string) => objectName,
          get: () => ({
            serve(request: Request, props: GrantProps) {
              delivered++;
              return host.serve(request, props);
            },
            health: () => host.health(),
            recordBlockSignal: (kind: BlockSignal) => host.recordBlockSignal(kind),
          }),
        };
      },
    },
  };
  const worker = createWorker({ fetch: timedFetch, log });
  // Work the Worker hands to `waitUntil`, settled before a test reads what it did.
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise), passThroughOnException() {}, props: {} };

  async function fetch(path: string, init?: RequestInit): Promise<Response> {
    const request = new Request(new URL(path, ORIGIN), init);
    request.headers.set("cf-connecting-ip", CLIENT_IP);
    const response = await worker.fetch!(request as never, env as never, ctx as never);
    await Promise.all(pending.splice(0));
    return response;
  }

  /** Resolves once the Durable Object has received `count` requests in all. */
  async function reachedDurableObject(count: number) {
    while (delivered < count) await new Promise((resolve) => setTimeout(resolve, 1));
  }

  return {
    fetch,
    network: { ...network, routes: allRoutes },
    kv: entries,
    jurisdictions,
    clock,
    clockReadings,
    reachedDurableObject,
    refreshTokenRotations: () => host.refreshTokenRotations(),
    logs,
    /** The events logged so far, parsed. */
    events: () => logs.map((line) => JSON.parse(line) as LogEvent),
  };
}

type Worker = ReturnType<typeof hostedWorker>;

/** A public client registered through DCR, as Cursor (or claude.ai without CIMD) does. */
export async function registerClient(worker: Worker, clientName = "Test client"): Promise<string> {
  const response = await worker.fetch("/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  if (response.status !== 201) throw new Error(`registration failed: ${response.status} ${await response.text()}`);
  return ((await response.json()) as { client_id: string }).client_id;
}

/** Opens the sign-in page the way a client sends the rider there. */
export async function openSignIn(worker: Worker, clientId: string) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "client-state",
    resource: MCP_URL,
  });
  const page = await worker.fetch(`/authorize?${query}`);
  return { page, verifier, clientId };
}

type SignInPage = Awaited<ReturnType<typeof openSignIn>>;

/** Both consent boxes ticked, as a rider who agrees posts them. */
export const CONSENTED = { accept_risk: "on", consent_health: "on" };

/** Fills the sign-in form on a page and submits it from the same browser. */
export async function submitSignIn(worker: Worker, { page }: Pick<SignInPage, "page">, fields: Record<string, string>) {
  const html = await page.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  if (!handle) throw new Error(`no form on the page:\n${html}`);
  const cookie = page.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return worker.fetch("/authorize", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    body: new URLSearchParams({ handle, ...fields }),
  });
}

/** What the client holds after the code exchange. */
export interface ClientTokens {
  accessToken: string;
  refreshToken: string;
  clientId: string;
}

function tokenRequest(worker: Worker, clientId: string, fields: Record<string, string>) {
  return worker.fetch("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, resource: MCP_URL, ...fields }),
  });
}

/** Trades the code the sign-in redirected with for tokens, as the client would. */
export async function exchangeCode(worker: Worker, signIn: SignInPage, redirect: Response): Promise<ClientTokens> {
  const location = new URL(redirect.headers.get("location") ?? "");
  const code = location.searchParams.get("code");
  if (!code) throw new Error(`no code in ${location}`);
  const response = await tokenRequest(worker, signIn.clientId, {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: signIn.verifier,
  });
  if (response.status !== 200) throw new Error(`token exchange failed: ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { access_token: string; refresh_token: string };
  return { accessToken: body.access_token, refreshToken: body.refresh_token, clientId: signIn.clientId };
}

/** The client's refresh, as it does after `/mcp` answers 401. */
export function refresh(worker: Worker, { refreshToken, clientId }: ClientTokens): Promise<Response> {
  return tokenRequest(worker, clientId, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/** The whole flow for an allow-listed rider: register, sign in, exchange the code. */
export async function connect(worker: Worker, email: string): Promise<ClientTokens> {
  const signIn = await openSignIn(worker, await registerClient(worker));
  const redirect = await submitSignIn(worker, signIn, { email, password: "correct horse", ...CONSENTED });
  if (redirect.status !== 302) throw new Error(`sign-in failed: ${redirect.status} ${await redirect.text()}`);
  return exchangeCode(worker, signIn, redirect);
}

/** The access token of a freshly connected rider. */
export async function connectRider(worker: Worker, email: string): Promise<string> {
  return (await connect(worker, email)).accessToken;
}

/** One MCP request over Streamable HTTP; by default at the 2025 era claude.ai falls back to. */
export async function mcpRequest(
  worker: Worker,
  token: string | undefined,
  method: string,
  params: unknown = {},
  protocolVersion = "2025-11-25",
) {
  return worker.fetch("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": protocolVersion,
      // The 2026 era repeats the method (and a tool's name) in headers, and checks they match the body.
      ...(protocolVersion >= "2026" ? { "mcp-method": method } : {}),
      ...(protocolVersion >= "2026" && method === "tools/call" ? { "mcp-name": (params as { name: string }).name } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}
