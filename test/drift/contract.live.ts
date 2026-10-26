import { homedir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFileCredentialsProvider, defaultCredentialsPath } from "../../src/credentials/file.js";
import { createRider } from "../../src/server.js";
import { windowStats } from "../../src/stats/window.js";
import { loadActivityFile } from "../../src/tools/activity-file-analysis.js";
import { createWorkout } from "../../src/tools/create-workout.js";
import { deleteWorkout } from "../../src/tools/delete-workout.js";
import { updateWorkout } from "../../src/tools/update-workout.js";
import { toWorkoutResult } from "../../src/tools/workout-shape.js";

/**
 * The maintainer's pre-release check, with their own `npx -y rouvy-mcp login`: the real Rouvy still
 * matches our schemas, and our NP still agrees with Rouvy's. Same client, same politeness as the server.
 * A drifted payload fails with the client's own "Rouvy changed its API: <route> no longer has <field>".
 *
 * `npm run contract:live -- --writes` also creates, edits and deletes a throwaway Workout (spec-m3 §10).
 * Without it, the run can't write a Workout, even by mistake.
 */
const WRITES = process.env.ROUVY_MCP_CONTRACT_WRITES === "1";
const credentials = createFileCredentialsProvider(
  defaultCredentialsPath({ env: process.env, platform: process.platform, homedir: homedir() }),
);
// The server's own polite fetch, allow-list included.
const { rouvy, workouts: writer } = createRider({
  credentials,
  fetch: WRITES ? globalThis.fetch : withoutWorkoutWrites(globalThis.fetch),
});

/** Refuses every Workout write route: only the login, refresh and Session posts go out. */
function withoutWorkoutWrites(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (request.method !== "GET" && url.host === "riders.rouvy.com") {
      return Promise.reject(new Error("contract:live without --writes never writes a Workout"));
    }
    return fetch(input, init);
  };
}

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

    // Never the Activity id (spec §2): only the two numbers.
    console.log(`Whole-ride NP: ours ${ours} W, Rouvy's ${theirs} W`);
    expect(Math.abs(ours - theirs) / theirs).toBeLessThan(0.02);
  });

  it("list_workouts and get_workout read the rider's own Workouts", async () => {
    const { workouts } = await rouvy.listWorkouts();
    expect(workouts.length, "the account needs at least one Workout of its own").toBeGreaterThan(0);

    // Through the ownership check, and mapped as get_workout returns it: a non-% FTP Workout fails here too.
    const result = toWorkoutResult(await rouvy.getOwnedWorkout(workouts[0]!.id));

    expect(result.steps.length).toBe(workouts[0]!.segments.length);
    expect(result.rider_ftp_w).toBeGreaterThan(0);
  });
});

/** Every Workout this check creates is named so, and only those it created are ever deleted. */
const PREFIX = "rouvy-mcp contract — delete me";

describe.runIf(WRITES)("contract with the live Rouvy: Workout writes (--writes)", () => {
  const contractWorkouts = async () => {
    await rouvy.dropWorkoutList();
    return (await rouvy.listWorkouts()).workouts.filter((w) => w.name.startsWith(PREFIX));
  };
  let before = new Set<string>();

  beforeAll(async () => {
    before = new Set((await contractWorkouts()).map((w) => w.id));
  });

  // Runs even when a step fails midway: whatever this run created goes, whatever was there stays.
  afterAll(async () => {
    for (const { id } of (await contractWorkouts()).filter((w) => !before.has(w.id))) {
      await writer.delete(id).catch((error) => console.log(`Cleanup: a delete failed (${error.message})`));
    }
    const left = (await contractWorkouts()).filter((w) => !before.has(w.id));
    expect(left, `${left.length} "${PREFIX}" Workout(s) left: delete them in Rouvy's web app`).toHaveLength(0);
  });

  it("creates, edits and deletes a Workout through the tools' own code", async () => {
    const created = await createWorkout(writer, {
      name: PREFIX,
      description: "Created by rouvy-mcp's pre-release check. Safe to delete.",
      tags: ["vo2-max", "warm-up"],
      steps: [
        { type: "ramp", duration_sec: 120, from_ftp_pct: 45, to_ftp_pct: 75 },
        {
          type: "repeat",
          times: 2,
          steps: [
            { type: "steady", duration_sec: 60, ftp_pct: 115, cadence: { min_rpm: 95, max_rpm: 105 } },
            { type: "free_ride", duration_sec: 30 },
          ],
        },
      ],
      cues: [{ at_sec: 120, text: "Go" }],
    });
    expect(created).toMatchObject({ name: PREFIX, tags: ["vo2-max", "warm-up"], visibility: "private", duration_sec: 300 });
    expect(created.steps).toHaveLength(5);
    expect(created.cues).toEqual([{ at_sec: 120, text: "Go", show_sec: 15 }]);

    const edited = await updateWorkout(writer, {
      workout_id: created.id,
      name: `${PREFIX} (edited)`,
      steps: [{ type: "steady", duration_sec: 300, ftp_pct: 60 }],
    });
    expect(edited).toMatchObject({ name: `${PREFIX} (edited)`, tags: created.tags, route: created.route, cues: created.cues });
    expect(edited.steps).toEqual([{ type: "steady", duration_sec: 300, ftp_pct: 60 }]);

    const deleted = await deleteWorkout(writer, { workout_id: created.id });
    expect(deleted).toMatchObject({ deleted: created.id, name: `${PREFIX} (edited)` });
    expect((await contractWorkouts()).map((w) => w.id)).not.toContain(created.id);
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
