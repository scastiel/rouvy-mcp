import { USER_AGENT } from "./constants.js";

/** Wraps `fetch` so every request, to any host, carries the project's honest user agent. */
export function withUserAgent(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("user-agent", USER_AGENT);
    return fetch(input, { ...init, headers });
  };
}
