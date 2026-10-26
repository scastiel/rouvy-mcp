import { describe, expect, it } from "vitest";
import { FIXTURE_WORKOUT, text } from "./server-harness.js";
import { isPost, libraryRider as rider } from "./workout-library.js";

const DELETE = `/workouts/${FIXTURE_WORKOUT}.data`;

describe("delete_workout", () => {
  it("removes an owned Workout from the library, confirmed by a fresh list", async () => {
    const { client, posts, rouvy } = await rider();
    await client.callTool({ name: "list_workouts", arguments: {} });

    const result = await client.callTool({ name: "delete_workout", arguments: { workout_id: FIXTURE_WORKOUT } });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toEqual({
      deleted: FIXTURE_WORKOUT,
      name: "Fixture Workout 1",
      note: expect.stringMatching(/Rouvy may keep it readable by its id/),
    });
    const [post] = posts();
    expect(post!.body).toBe(`id=${FIXTURE_WORKOUT}`);
    expect(post!.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    // The list was cached by list_workouts: the ownership GET reads the Workout, and the check after
    // the POST bypasses the cache.
    expect(rouvy()).toEqual([
      "GET /workouts/collections/created.data",
      `GET /workouts/${FIXTURE_WORKOUT}.data`,
      `POST ${DELETE}`,
      "GET /workouts/collections/created.data",
    ]);
    const list = JSON.parse(text(await client.callTool({ name: "list_workouts", arguments: {} })));
    expect(list.workouts).toEqual([]);
  });

  it("says the delete isn't confirmed when the Workout is still listed after the 202", async () => {
    const { client, calls } = await rider((r) =>
      isPost(DELETE)(r) ? new Response('[["SingleFetchRedirect",1],{"redirect":"/workouts","status":302}]', { status: 202 }) : undefined,
    );

    const result = await client.callTool({ name: "delete_workout", arguments: { workout_id: FIXTURE_WORKOUT } });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Rouvy answered but the Workout is still in your library/);
    expect(calls.at(-1)).toMatchObject({ tool: "delete_workout", outcome: "delete_not_confirmed" });
  });

  it.each([
    ["a catalogue Workout", "2684186"],
    ["a Workout that doesn't exist", "1"],
  ])("refuses %s as not found, without a POST", async (_, workout_id) => {
    const { client, posts } = await rider();

    const result = await client.callTool({ name: "delete_workout", arguments: { workout_id } });

    expect(text(result)).toMatch(/No Workout with this id in your library/);
    expect(posts()).toHaveLength(0);
  });

  it("refuses someone else's listed Workout, without a POST", async () => {
    const { client, library, posts } = await rider();
    library.workouts.get(FIXTURE_WORKOUT)!.workout.createdBy.firebaseUid = "someone-else";

    const result = await client.callTool({ name: "delete_workout", arguments: { workout_id: FIXTURE_WORKOUT } });

    expect(text(result)).toMatch(/No Workout with this id in your library/);
    expect(posts()).toHaveLength(0);
  });

  it("is 'outcome unknown' on a 5xx, with no second POST", async () => {
    const { client, posts } = await rider((r) => (isPost(DELETE)(r) ? new Response("oops", { status: 500 }) : undefined));

    const result = await client.callTool({ name: "delete_workout", arguments: { workout_id: FIXTURE_WORKOUT } });

    expect(text(result)).toMatch(/may or may not have saved this/);
    expect(posts()).toHaveLength(1);
  });

  it("treats any answer but a 202 as a rejection", async () => {
    const { client } = await rider((r) => (isPost(DELETE)(r) ? new Response("<html></html>", { status: 200 }) : undefined));

    const result = await client.callTool({ name: "delete_workout", arguments: { workout_id: FIXTURE_WORKOUT } });

    expect(text(result)).toMatch(/^Rouvy didn't accept/);
  });

  it("is destructive, and warns about Workouts synced from other apps", async () => {
    const { client } = await rider();

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "delete_workout");

    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toMatch(/synced from another app/);
  });
});

it("all five Workout tools are served", async () => {
  const { client } = await rider();

  const { tools } = await client.listTools();

  expect(tools.map((t) => t.name)).toEqual(
    expect.arrayContaining(["list_workouts", "get_workout", "create_workout", "update_workout", "delete_workout"]),
  );
});
