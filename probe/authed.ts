import type { Credentials } from "../src/credentials/types.js";
import { createRouvyClient } from "../src/rouvy/client.js";
import { systemClock } from "../src/rouvy/clock.js";
import { createSessionManager } from "../src/rouvy/session-manager.js";

/**
 * The maintainer's own account, once: a securetoken refresh + `auth.data` (what the hosted server
 * does per grant), then one list page, one detail and its Activity file. Reports only statuses,
 * timings and counts; never ids, tokens or bodies. Uses a refresh token rather than a password
 * login, so no host spends one of Rouvy's rate-limited login POSTs.
 */
export async function authedReads(fetch: typeof globalThis.fetch, credentials: Credentials) {
  let stored = credentials;
  let rotated = false;
  const provider = {
    load: async () => stored,
    save: async (next: Credentials) => {
      rotated = true;
      stored = next;
    },
  };
  const sessions = createSessionManager(fetch, provider, systemClock);
  const rouvy = createRouvyClient(fetch, sessions, systemClock);
  const steps: Record<string, unknown>[] = [];

  async function step<T>(name: string, work: () => Promise<T>, describe: (value: T) => Record<string, unknown>) {
    const start = Date.now();
    try {
      const value = await work();
      steps.push({ name, ok: true, wallMs: Date.now() - start, ...describe(value) });
      return value;
    } catch (error) {
      // RouvyError messages are written to carry no tokens, ids or bodies (spec §8).
      steps.push({ name, ok: false, wallMs: Date.now() - start, error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  }

  await step("session", () => sessions.current(), () => ({}));
  const rows = await step("listPage0", () => rouvy.listActivitiesPage(0), (r) => ({ rows: r.length }));
  const withFile = rows?.[0];
  if (withFile) {
    await step("detail", () => rouvy.getActivity(withFile.id), (d) => ({ hasExportLink: d.exportLink != null }));
    await step("activityFile", () => rouvy.getActivityFile(withFile.id), (f) => ({ records: f.records.length }));
  }
  return { steps, refreshTokenRotated: rotated };
}
