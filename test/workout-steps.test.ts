import { describe, expect, it } from "vitest";
import { encodeForm, formErrors, workoutIdIn } from "../src/rouvy/workout-writes.js";
import { toWorkoutForm } from "../src/tools/workout-input.js";
import { flattenSteps, toSegments, workoutProblems, type InputStep, type WorkoutContent } from "../src/workouts/steps.js";
import { fixtureCreateForm, fixtureRejectedPage } from "./workout-library.js";

const workout = (overrides: Partial<WorkoutContent> = {}): WorkoutContent => ({
  name: "Sweet spot",
  tags: [],
  visibility: "private",
  steps: [{ type: "steady", duration_sec: 600, ftp_pct: 90 }],
  cues: [],
  ...overrides,
});

describe("repeat", () => {
  it("is flattened in order, times × its Steps", () => {
    const steps: InputStep[] = [
      { type: "steady", duration_sec: 300, ftp_pct: 55 },
      {
        type: "repeat",
        times: 3,
        steps: [
          { type: "steady", duration_sec: 60, ftp_pct: 120 },
          { type: "free_ride", duration_sec: 30 },
        ],
      },
      { type: "ramp", duration_sec: 120, from_ftp_pct: 60, to_ftp_pct: 40 },
    ];

    expect(flattenSteps(steps).map((s) => `${s.type}/${s.duration_sec}`)).toEqual([
      "steady/300",
      "steady/60",
      "free_ride/30",
      "steady/60",
      "free_ride/30",
      "steady/60",
      "free_ride/30",
      "ramp/120",
    ]);
  });
});

describe("Steps to Rouvy segments", () => {
  it("maps steady, ramp and free ride, with and without cadence", () => {
    expect(
      toSegments([
        { type: "steady", duration_sec: 300, ftp_pct: 60, cadence: { min_rpm: 85, max_rpm: 95 } },
        { type: "ramp", duration_sec: 120, from_ftp_pct: 60, to_ftp_pct: 90 },
        { type: "free_ride", duration_sec: 60 },
      ]),
    ).toEqual([
      { duration: 300, intervalType: "CONSTANT", primaryStart: 60, primaryEnd: 60, primaryType: "FTP", secondaryMin: 85, secondaryMax: 95, secondaryType: "CADENCE" },
      { duration: 120, intervalType: "RAMP", primaryStart: 60, primaryEnd: 90, primaryType: "FTP", secondaryMin: null, secondaryMax: null, secondaryType: null },
      { duration: 60, intervalType: "FREE_RIDE", primaryStart: 0, primaryEnd: 0, primaryType: "FTP", secondaryMin: null, secondaryMax: null, secondaryType: null },
    ]);
  });

  it("produces, field for field and in order, the form body Rouvy accepted", () => {
    const form = toWorkoutForm({
      name: "Fixture Workout",
      description: "Fixture description",
      tags: ["endurance", "threshold"],
      visibility: "private",
      steps: [
        { type: "steady", duration_sec: 300, ftp_pct: 60, cadence: { min_rpm: 85, max_rpm: 95 } },
        { type: "ramp", duration_sec: 120, from_ftp_pct: 60, to_ftp_pct: 90 },
        { type: "free_ride", duration_sec: 60 },
      ],
      cues: [{ at_sec: 10, text: "Settle in" }],
    });

    expect(encodeForm(form, "200002").toString()).toBe(fixtureCreateForm());
  });

  it("sends no tags as an empty field, as Rouvy's creator does", () => {
    expect(encodeForm(toWorkoutForm(workout()), "1").get("tags")).toBe("");
  });

  it("sends public only when asked", () => {
    expect(toWorkoutForm(workout()).access).toBe("PRIVATE");
    expect(toWorkoutForm(workout({ visibility: "public" })).access).toBe("PUBLIC");
  });
});

describe("validation", () => {
  it("accepts a sound Workout", () => {
    expect(workoutProblems(workout({ tags: ["endurance", "threshold", "cadence"], cues: [{ at_sec: 599, text: "Done", show_sec: 1 }] }))).toEqual([]);
  });

  it.each<[string, Partial<WorkoutContent>, string]>([
    ["an empty name", { name: "" }, "name: 1 to 200 characters"],
    ["a name over 200 characters", { name: "x".repeat(201) }, "name: 1 to 200 characters"],
    ["more than 3 tags", { tags: ["endurance", "threshold", "cadence", "recovery"] }, "tags: at most 3 tags"],
    ["an unknown tag", { tags: ["zone-2"] }, "tags[0]: one of mental-health, endurance"],
    ["no Steps", { steps: [] }, "steps: at least one Step"],
    ["a duration under 1 s", { steps: [{ type: "steady", duration_sec: 0, ftp_pct: 90 }] }, "steps[0].duration_sec: an integer number of seconds, at least 1"],
    ["a fractional duration", { steps: [{ type: "steady", duration_sec: 30.5, ftp_pct: 90 }] }, "steps[0].duration_sec"],
    ["less than 30 s in all", { steps: [{ type: "steady", duration_sec: 29, ftp_pct: 90 }] }, "steps: at least 30 s in all (these last 29 s)"],
    ["% FTP above 300", { steps: [{ type: "steady", duration_sec: 60, ftp_pct: 301 }] }, "steps[0].ftp_pct: an integer from 0 to 300 (% FTP)"],
    ["a negative ramp start", { steps: [{ type: "ramp", duration_sec: 60, from_ftp_pct: -1, to_ftp_pct: 50 }] }, "steps[0].from_ftp_pct"],
    ["a fractional ramp end", { steps: [{ type: "ramp", duration_sec: 60, from_ftp_pct: 50, to_ftp_pct: 60.5 }] }, "steps[0].to_ftp_pct"],
    ["a cadence above 300 rpm", { steps: [{ type: "free_ride", duration_sec: 60, cadence: { min_rpm: 90, max_rpm: 301 } }] }, "steps[0].cadence.max_rpm: 0 to 300 rpm"],
    ["a negative cadence", { steps: [{ type: "free_ride", duration_sec: 60, cadence: { min_rpm: -1, max_rpm: 90 } }] }, "steps[0].cadence.min_rpm"],
    ["min_rpm above max_rpm", { steps: [{ type: "free_ride", duration_sec: 60, cadence: { min_rpm: 100, max_rpm: 90 } }] }, "steps[0].cadence: min_rpm can't be above max_rpm"],
    ["a repeat once", { steps: [{ type: "repeat", times: 1, steps: [{ type: "steady", duration_sec: 60, ftp_pct: 90 }] }] }, "steps[0].times: an integer, at least 2"],
    ["an empty repeat", { steps: [{ type: "steady", duration_sec: 60, ftp_pct: 90 }, { type: "repeat", times: 2, steps: [] }] }, "steps[1].steps: at least one Step"],
    [
      "a repeat inside a repeat",
      { steps: [{ type: "repeat", times: 2, steps: [{ type: "repeat", times: 2, steps: [{ type: "steady", duration_sec: 60, ftp_pct: 90 }] }] }] },
      "steps[0].steps[0].type: a repeat can't contain another repeat",
    ],
    ["a Step inside a repeat", { steps: [{ type: "repeat", times: 2, steps: [{ type: "steady", duration_sec: 60, ftp_pct: 350 }] }] }, "steps[0].steps[0].ftp_pct"],
    ["a Cue at the end", { cues: [{ at_sec: 600, text: "Done" }] }, "cues[0].at_sec: before the end of the Workout (600 s)"],
    ["a Cue before the start", { cues: [{ at_sec: -1, text: "Go" }] }, "cues[0].at_sec"],
    ["an empty Cue", { cues: [{ at_sec: 0, text: "  " }] }, "cues[0].text: not empty"],
    ["a Cue shown for 0 s", { cues: [{ at_sec: 0, text: "Go", show_sec: 0 }] }, "cues[0].show_sec: an integer number of seconds, at least 1"],
  ])("rejects %s", (_, overrides, expected) => {
    expect(workoutProblems(workout(overrides))).toEqual([expect.stringContaining(expected)]);
  });

  it("counts a repeat's Steps toward the total that Cues must fit in", () => {
    const steps: InputStep[] = [{ type: "repeat", times: 3, steps: [{ type: "steady", duration_sec: 20, ftp_pct: 90 }] }];

    expect(workoutProblems(workout({ steps, cues: [{ at_sec: 59, text: "Last" }] }))).toEqual([]);
    expect(workoutProblems(workout({ steps, cues: [{ at_sec: 60, text: "Late" }] }))).toEqual([expect.stringContaining("(60 s)")]);
  });

  it("lists every problem at once, each with its path", () => {
    const content = workout({
      name: "",
      steps: [
        { type: "steady", duration_sec: 60, ftp_pct: 400 },
        { type: "repeat", times: 2, steps: [{ type: "ramp", duration_sec: 0, from_ftp_pct: 50, to_ftp_pct: 50 }] },
      ],
      cues: [{ at_sec: 0, text: "" }],
    });

    expect(() => toWorkoutForm(content)).toThrow(
      "Invalid Workout:\n" +
        "- name: 1 to 200 characters\n" +
        "- steps[0].ftp_pct: an integer from 0 to 300 (% FTP)\n" +
        "- steps[1].steps[0].duration_sec: an integer number of seconds, at least 1\n" +
        "- cues[0].text: not empty",
    );
  });
});

describe("reading Rouvy's answer to a form post", () => {
  it.each([
    ["/workouts/4697626", "4697626"],
    ["https://riders.rouvy.com/workouts/4697626", "4697626"],
    ["/workouts", undefined],
    ["/workouts/4697626/edit", undefined],
    ["/workouts/4697626?error=1", undefined],
    ["https://account.rouvy.com/sign-in?redirectTo=%2Fworkouts%2Fcreate", undefined],
    ["https://example.com/workouts/1", undefined],
  ])("takes the Workout id from Location %s", (location, id) => {
    expect(workoutIdIn(location)).toBe(id);
  });

  it("decodes the validation message from the re-rendered form, and only that", async () => {
    expect(await formErrors(fixtureRejectedPage())).toBe("name: String must contain at most 200 character(s)");
  });

  it("gives up quietly on a page it can't read", async () => {
    expect(await formErrors(new Response("<html>Oops</html>"))).toBeUndefined();
    expect(await formErrors(new Response('<script>x.streamController.enqueue("not turbo");</script>'))).toBeUndefined();
  });
});
