import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURE_WORKOUT, text } from "./server-harness.js";
import { fixtureRejectedPage, isPost, libraryRider as rider } from "./workout-library.js";

/** What an edit of the fixture Workout sends when nothing changes: its read fields under their write names. */
const fixtureEditForm = () => readFileSync(new URL("./fixtures/workout-edit-form.txt", import.meta.url), "utf8").trim();

const EDIT = `/workouts/${FIXTURE_WORKOUT}/edit`;

type Client = Awaited<ReturnType<typeof rider>>["client"];
const getWorkout = async (client: Client, workout_id = FIXTURE_WORKOUT) =>
  JSON.parse(text(await client.callTool({ name: "get_workout", arguments: { workout_id } })));

describe("update_workout", () => {
  it("changes only the name: Steps, Cues, tags, visibility and route are kept", async () => {
    const { client, library, posts, rouvy } = await rider();
    library.workouts.get(FIXTURE_WORKOUT)!.workout.trainingEffects = ["endurance"];
    library.workouts.get(FIXTURE_WORKOUT)!.workout.instructions = [{ text: "Easy", showDuration: 15, durationFromStart: 60 }];
    const before = await getWorkout(client);

    const result = await client.callTool({ name: "update_workout", arguments: { workout_id: FIXTURE_WORKOUT, name: "Z2 long" } });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({ ...before, name: "Z2 long" });
    const form = new URLSearchParams(posts()[0]!.body);
    expect(form.get("tags")).toBe("endurance");
    expect(form.get("recommendedRouteId")).toBe("200001");
    // GET first (the list is still cached from get_workout), one POST, then a fresh read-back.
    expect(rouvy().slice(2)).toEqual([
      `GET /workouts/${FIXTURE_WORKOUT}.data`,
      `POST ${EDIT}`,
      "GET /workouts/collections/created.data",
      `GET /workouts/${FIXTURE_WORKOUT}.data`,
    ]);
  });

  it("replaces every Step when steps are given, and keeps the Cues left out", async () => {
    const { client, library } = await rider();
    library.workouts.get(FIXTURE_WORKOUT)!.workout.instructions = [{ text: "Easy", showDuration: 15, durationFromStart: 60 }];

    const result = await client.callTool({
      name: "update_workout",
      arguments: {
        workout_id: FIXTURE_WORKOUT,
        steps: [{ type: "repeat", times: 2, steps: [{ type: "steady", duration_sec: 300, ftp_pct: 95 }] }],
      },
    });

    const saved = JSON.parse(text(result));
    expect(saved.steps).toEqual([
      { type: "steady", duration_sec: 300, ftp_pct: 95 },
      { type: "steady", duration_sec: 300, ftp_pct: 95 },
    ]);
    expect(saved.cues).toEqual([{ at_sec: 60, text: "Easy", show_sec: 15 }]);
    expect(saved.duration_sec).toBe(600);
  });

  it("round-trips a get_workout result unchanged, sending the edit form as Rouvy stores the Workout", async () => {
    const { client, posts } = await rider();
    const before = await getWorkout(client);
    const { id, ...asRead } = before;

    const result = await client.callTool({ name: "update_workout", arguments: { workout_id: id, ...asRead } });

    expect(JSON.parse(text(result))).toEqual(before);
    expect(posts()[0]!.body).toBe(fixtureEditForm());
  });

  it("checks Cues against the Workout's real length once it's read", async () => {
    const { client, posts } = await rider();

    const result = await client.callTool({
      name: "update_workout",
      arguments: { workout_id: FIXTURE_WORKOUT, cues: [{ at_sec: 5400, text: "After the end" }] },
    });

    expect(text(result)).toBe("Invalid Workout:\n- cues[0].at_sec: before the end of the Workout (5400 s)");
    expect(posts()).toHaveLength(0);
  });

  it("makes no request at all when a given field is invalid", async () => {
    const { client, network, calls } = await rider();

    const result = await client.callTool({
      name: "update_workout",
      arguments: { workout_id: FIXTURE_WORKOUT, name: "", steps: [{ type: "steady", duration_sec: 60, ftp_pct: 301 }] },
    });

    expect(text(result)).toBe(
      "Invalid Workout:\n- name: 1 to 200 characters\n- steps[0].ftp_pct: an integer from 0 to 300 (% FTP)",
    );
    expect(network.requests).toHaveLength(0);
    expect(calls.at(-1)).toMatchObject({ tool: "update_workout", outcome: "invalid_input" });
  });

  it("says Rouvy can't clear tags instead of silently keeping them", async () => {
    const { client, library, posts } = await rider();
    library.workouts.get(FIXTURE_WORKOUT)!.workout.trainingEffects = ["endurance"];

    const result = await client.callTool({ name: "update_workout", arguments: { workout_id: FIXTURE_WORKOUT, tags: [] } });

    expect(text(result)).toMatch(/can't remove every tag/);
    expect(posts()).toHaveLength(0);
  });

  describe("only ever writes the rider's own Workouts", () => {
    it.each([
      ["a catalogue Workout", (lib: Awaited<ReturnType<typeof rider>>["library"]) => {
        const catalogue = structuredClone(lib.workouts.get(FIXTURE_WORKOUT)!);
        catalogue.workout.id = "2684186";
        catalogue.workout.createdBy.firebaseUid = "coach";
        lib.add(catalogue, { listed: false });
        return "2684186";
      }],
      ["someone else's Workout, even listed", (lib: Awaited<ReturnType<typeof rider>>["library"]) => {
        lib.workouts.get(FIXTURE_WORKOUT)!.workout.createdBy.firebaseUid = "someone-else";
        return FIXTURE_WORKOUT;
      }],
      ["a deleted Workout Rouvy still serves", (lib: Awaited<ReturnType<typeof rider>>["library"]) => {
        const deleted = structuredClone(lib.workouts.get(FIXTURE_WORKOUT)!);
        deleted.workout.id = "100500";
        lib.add(deleted, { listed: false });
        return "100500";
      }],
    ])("%s is not found, and nothing is posted", async (_, setUp) => {
      const { client, library, posts } = await rider();
      const workout_id = setUp(library);

      const result = await client.callTool({ name: "update_workout", arguments: { workout_id, name: "Mine now" } });

      expect(text(result)).toMatch(/No Workout with this id in your library/);
      expect(posts()).toHaveLength(0);
    });
  });

  it("is 'outcome unknown' on a 5xx, with no second POST", async () => {
    const { client, posts, calls } = await rider((r) => (isPost(EDIT)(r) ? new Response("oops", { status: 503 }) : undefined));

    const result = await client.callTool({ name: "update_workout", arguments: { workout_id: FIXTURE_WORKOUT, name: "Z2 long" } });

    expect(text(result)).toMatch(/may or may not have saved this/);
    expect(posts()).toHaveLength(1);
    expect(calls.at(-1)).toMatchObject({ outcome: "outcome_unknown" });
  });

  it("reports a rejected form, and a redirect to another Workout, as 'Rouvy rejected the write'", async () => {
    const rejected = await rider((r) => (isPost(EDIT)(r) ? fixtureRejectedPage() : undefined));
    const elsewhere = await rider((r) =>
      isPost(EDIT)(r) ? new Response(null, { status: 302, headers: { location: "/workouts/999" } }) : undefined,
    );

    const first = await rejected.client.callTool({ name: "update_workout", arguments: { workout_id: FIXTURE_WORKOUT, name: "x" } });
    const second = await elsewhere.client.callTool({ name: "update_workout", arguments: { workout_id: FIXTURE_WORKOUT, name: "x" } });

    expect(text(first)).toBe("Rouvy rejected the write: name: String must contain at most 200 character(s)");
    expect(text(second)).toBe("Rouvy didn't accept the Workout. Nothing was saved.");
  });

  it("is destructive, and warns about Workouts synced from other apps", async () => {
    const { client } = await rider();

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "update_workout");

    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toMatch(/synced from another app/);
  });
});
