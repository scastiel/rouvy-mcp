/**
 * Every request other than a GET that rouvy-mcp may ever send (spec-m3 §6.1): the three Workout
 * write routes, plus the login, refresh and Session POSTs (spec-m1 §4). Activities, Rider settings
 * and the profile stay read-only by construction.
 */
export const ALLOWED_WRITES: readonly { method: "POST"; host: string; path: RegExp }[] = [
  { method: "POST", host: "riders.rouvy.com", path: /^\/workouts\/create$/ },
  { method: "POST", host: "riders.rouvy.com", path: /^\/workouts\/\d+\/edit$/ },
  { method: "POST", host: "riders.rouvy.com", path: /^\/workouts\/\d+\.data$/ },
  { method: "POST", host: "identitytoolkit.googleapis.com", path: /^\/v1\/accounts:signInWithPassword$/ },
  { method: "POST", host: "securetoken.googleapis.com", path: /^\/v1\/token$/ },
  { method: "POST", host: "account.rouvy.com", path: /^\/resources\/auth\.data$/ },
];

/** A request that isn't a GET and isn't on the allow-list: a bug, refused before it goes out. */
export class RefusedRequestError extends Error {
  override name = "RefusedRequestError";
}

export function isAllowedRequest(method: string, url: URL): boolean {
  const upper = method.toUpperCase();
  if (upper === "GET" || upper === "HEAD") return true;
  return ALLOWED_WRITES.some(
    (allowed) => allowed.method === upper && allowed.host === url.host && url.protocol === "https:" && allowed.path.test(url.pathname),
  );
}

/** Wraps `fetch` so a non-GET request off the allow-list throws before anything is sent. */
export function withAllowList(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const method = init?.method ?? request?.method ?? "GET";
    const url = new URL(request?.url ?? String(input));
    if (!isAllowedRequest(method, url)) {
      // Only the origin and path: a query string could carry a key.
      return Promise.reject(new RefusedRequestError(`rouvy-mcp refuses to send ${method} ${url.origin}${url.pathname}`));
    }
    return fetch(input, init);
  };
}
