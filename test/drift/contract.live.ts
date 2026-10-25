import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { createFileCredentialsProvider, defaultCredentialsPath } from "../../src/credentials/file.js";
import { withUserAgent } from "../../src/http.js";
import { createRouvyClient } from "../../src/rouvy/client.js";
import { systemClock } from "../../src/rouvy/clock.js";
import { createPushback } from "../../src/rouvy/pushback.js";
import { createRequestQueue } from "../../src/rouvy/request-queue.js";
import { createSessionManager } from "../../src/rouvy/session-manager.js";
import { windowStats } from "../../src/stats/window.js";
import { loadActivityFile } from "../../src/tools/activity-file-analysis.js";

/**
 * The maintainer's pre-release check, with their own `npx -y rouvy-mcp login`: the real Rouvy still
 * matches our schemas, and our NP still agrees with Rouvy's. Same client, same politeness as the server.
 * A drifted payload fails with the client's own "Rouvy changed its API: <route> no longer has <field>".
 */
const credentials = createFileCredentialsProvider(
  defaultCredentialsPath({ env: process.env, platform: process.platform, homedir: homedir() }),
);
const politeFetch = withUserAgent(createRequestQueue(createPushback(globalThis.fetch, systemClock), systemClock));
const rouvy = createRouvyClient(politeFetch, createSessionManager(politeFetch, credentials, systemClock), systemClock);

/** How many of the newest Activities to look through for one with power and an Activity file. */
const CANDIDATES = 3;

describe("contract with the live Rouvy", () => {
  it("a list page matches the schema", async () => {
    const rows = await rouvy.listActivitiesPage(0);

    expect(rows.length, "the account needs at least one Activity").toBeGreaterThan(0);
  });

  it("the newest Activity's detail matches the schema", async () => {
    const [newest] = await rouvy.listActivitiesPage(0);

    await rouvy.getActivity(newest!.id);
  });

  it("an Activity file parses, and our whole-ride NP lands within 2% of Rouvy's", async () => {
    const id = await activityWithPowerAndFile();
    const { activity } = await rouvy.getActivity(id);
    const { records, options, durationSec } = await loadActivityFile(rouvy, id);

    const ours = windowStats(records, 0, durationSec, options).np_w!;
    const theirs = activity.total!.NP!;

    console.log(`Activity ${id}: our NP ${ours} W, Rouvy's ${theirs} W`);
    expect(Math.abs(ours - theirs) / theirs).toBeLessThan(0.02);
  });
});

async function activityWithPowerAndFile(): Promise<string> {
  const rows = (await rouvy.listActivitiesPage(0)).slice(0, CANDIDATES);
  for (const { id } of rows) {
    const { activity, exportLink } = await rouvy.getActivity(id);
    if (activity.total?.NP && exportLink) return id;
  }
  throw new Error(`None of the ${rows.length} newest Activities has both an NP and an Activity file: ride with power first.`);
}
