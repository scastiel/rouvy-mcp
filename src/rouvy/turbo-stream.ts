import { decode, type DecodePlugin } from "turbo-stream";

/** React Router's redirect marker inside a single-fetch payload. */
export interface SingleFetchRedirect {
  redirect: string;
  status?: number;
}

const plugins: DecodePlugin[] = [
  (type, ...values) => (type === "SingleFetchRedirect" ? { value: { SingleFetchRedirect: values[0] } } : undefined),
];

/** Decodes a turbo-stream v2 body, waiting for every deferred value. */
export async function decodeSingleFetch(body: ReadableStream<Uint8Array>): Promise<unknown> {
  const { value, done } = await decode(body, { plugins });
  const resolved = await resolveDeferred(value);
  await done;
  return resolved;
}

export function asRedirect(value: unknown): SingleFetchRedirect | undefined {
  const redirect = (value as { SingleFetchRedirect?: SingleFetchRedirect } | null)?.SingleFetchRedirect;
  return typeof redirect?.redirect === "string" ? redirect : undefined;
}

async function resolveDeferred(value: unknown): Promise<unknown> {
  const settled = await value;
  if (Array.isArray(settled)) return Promise.all(settled.map(resolveDeferred));
  if (settled && typeof settled === "object" && Object.getPrototypeOf(settled) === Object.prototype) {
    const entries = await Promise.all(Object.entries(settled).map(async ([k, v]) => [k, await resolveDeferred(v)]));
    return Object.fromEntries(entries);
  }
  return settled;
}
