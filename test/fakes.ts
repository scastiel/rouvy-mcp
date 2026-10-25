import { BOGUS_ACTIVITY_ID } from "../src/canary.js";
import type { Terminal } from "../src/cli/terminal.js";
import { ROUVY_FIREBASE_WEB_KEY } from "../src/constants.js";

export interface RecordedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: string;
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/**
 * A stand-in for the network: routes by `host + pathname`, records every request,
 * and fails loudly on anything unexpected.
 */
export function fakeNetwork(routes: Record<string, Handler>) {
  const requests: RecordedRequest[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const recorded: RecordedRequest = {
      url: new URL(request.url),
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    };
    requests.push(recorded);
    const handler = routes[recorded.url.host + recorded.url.pathname];
    if (!handler) throw new Error(`unexpected request to ${recorded.url.host}${recorded.url.pathname}`);
    return handler(recorded);
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function firebaseError(message: string, status = 400): Response {
  return json({ error: { code: status, message, errors: [{ message, reason: "invalid" }] } }, status);
}

/** What `account.rouvy.com/resources/auth.data` answers when the Firebase tokens are good. */
export function rouvySessionOpened(): Response {
  return new Response('[["SingleFetchRedirect",1],{"redirect":"/redirect/riders-portal","status":302}]', {
    status: 202,
    headers: [
      ["content-type", "text/x-script"],
      ["set-cookie", "rouvy_session=c2Vzc2lvbg; Domain=rouvy.com; Path=/; HttpOnly; Secure; SameSite=Lax"],
      ["set-cookie", "rouvysession_tos=1; Domain=rouvy.com; Path=/"],
    ],
  });
}

/** Rouvy's anonymous answer to any `.data` read, as captured on 2026-10-25. */
function signInRedirect(path: string): Response {
  const redirect = `https://account.rouvy.com/sign-in?riders=true&redirectTo=${encodeURIComponent(path)}`;
  return new Response(
    `[["SingleFetchRedirect",1],{"_2":3,"_4":5,"_6":7,"_8":7,"_9":7},"redirect","${redirect}","status",302,"revalidate",false,"reload","replace"]`,
    { status: 202, headers: { "content-type": "text/x-script" } },
  );
}

export function signInPage(key = ROUVY_FIREBASE_WEB_KEY): Response {
  return new Response(`<!DOCTYPE html><html><script>window.ENV={"FIREBASE_API_KEY":"${key}"}</script></html>`, {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

/** What the canary's checks meet today: Rouvy's and Firebase's answers to its account-free requests. */
export function canaryRoutes(): Record<string, Handler> {
  return {
    "riders.rouvy.com/resources/activities-pagination.data": () => signInRedirect("/resources/activities-pagination"),
    [`riders.rouvy.com/activity/${BOGUS_ACTIVITY_ID}.data`]: () => signInRedirect(`/activity/${BOGUS_ACTIVITY_ID}`),
    "identitytoolkit.googleapis.com/v1/accounts:signInWithPassword": () => firebaseError("INVALID_LOGIN_CREDENTIALS"),
    "account.rouvy.com/sign-in": () => signInPage(),
  };
}

export function fakeTerminal(answers: { email?: string; password?: string } = {}) {
  const output: string[] = [];
  const terminal: Terminal = {
    async ask() {
      return answers.email ?? "";
    },
    async askHidden() {
      return answers.password ?? "";
    },
    print(line) {
      output.push(line);
    },
    printError(line) {
      output.push(line);
    },
  };
  return { terminal, output: () => output.join("\n") };
}
