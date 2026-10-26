import { readFileSync } from "node:fs";
import type { RecordedRequest } from "./fakes.js";
import {
  turboStream,
  WORKOUT_DETAIL_ROUTE,
  WORKOUT_LIST_ROUTE,
  workoutFixtures,
  type WorkoutDetailPayload,
} from "./server-harness.js";

export const CREATOR_ROUTE = "routes/_main.workouts.create";
export const CREATOR = "riders.rouvy.com/workouts/create.data";
export const CREATE = "riders.rouvy.com/workouts/create";
export const edit = (workoutId: string) => `riders.rouvy.com/workouts/${workoutId}/edit`;
export const remove = (workoutId: string) => `riders.rouvy.com/workouts/${workoutId}.data`;
/** The route Rouvy's creator pre-fills in the fake library. */
export const DEFAULT_ROUTE = "200002";

/** A create form body Rouvy accepted with a 302 on 2026-10-26, redacted (name, description, route). */
export const fixtureCreateForm = () =>
  readFileSync(new URL("./fixtures/workout-create-form.txt", import.meta.url), "utf8").trim();

/** The page Rouvy re-renders for a rejected form post (a name over 200 characters), redacted. */
export const fixtureRejectedPage = () =>
  new Response(readFileSync(new URL("./fixtures/workout-rejected.html", import.meta.url), "utf8"), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/** What a successful form post answers: a redirect to the Workout's page, with a relative `Location`. */
export const formSaved = (workoutId: string) =>
  new Response(null, { status: 302, headers: { location: `/workouts/${workoutId}` } });

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/**
 * Rouvy's Workout routes as observed on 2026-10-26, in memory: the creator's loader, the `created`
 * list (newest first), details (still served after a delete), and the create, edit and delete
 * posts, which store what they're sent. Starts with the redacted fixture Workout, owned by `uid`.
 *
 * `intercept` answers a request first when it returns a Response: a failure, say.
 */
export async function fakeWorkoutLibrary({
  uid = "uid-1",
  intercept = () => undefined,
}: { uid?: string; intercept?: (request: RecordedRequest) => Response | undefined } = {}) {
  const fixtures = await workoutFixtures(uid);
  const workouts = new Map<string, WorkoutDetailPayload>([[fixtures.detail.workout.id, fixtures.detail]]);
  let listed = [fixtures.detail.workout.id];
  let nextId = 100777;

  function save(id: string, form: URLSearchParams, previous?: WorkoutDetailPayload) {
    const segments = JSON.parse(form.get("segments") ?? "[]") as Record<string, unknown>[];
    const tags = (form.get("tags") ?? "").split(",").filter(Boolean);
    const routeId = form.get("recommendedRouteId")!;
    const detail = structuredClone(previous ?? fixtures.detail);
    Object.assign(detail.workout, {
      id,
      name: form.get("name"),
      description: form.get("description"),
      // Rouvy keeps a Workout's tags when an edit sends none.
      trainingEffects: tags.length === 0 && previous ? previous.workout.trainingEffects : tags,
      access: form.get("access"),
      recommendedRoute: { id: routeId, name: `Route ${routeId}`, thumbnail: "https://example.invalid/route.png" },
      segments: segments.map(({ primaryStart, primaryEnd, primaryType, ...rest }) => ({
        ...rest,
        type: primaryType,
        valueStart: primaryStart,
        valueEnd: primaryEnd,
      })),
      instructions: JSON.parse(form.get("instructions") ?? "[]"),
      duration: segments.reduce((sum, s) => sum + (s.duration as number), 0),
    });
    workouts.set(id, detail);
  }

  function handle(path: string, request: RecordedRequest): Response | Promise<Response> | undefined {
    const intercepted = intercept(request);
    if (intercepted) return intercepted;
    if (request.method === "GET") {
      if (path === "/workouts/create.data") {
        return turboStream({ [CREATOR_ROUTE]: { data: { route: { id: DEFAULT_ROUTE, name: "Fixture default route" } } } });
      }
      if (path === "/workouts/collections/created.data") {
        const overviews = listed.map((id) => {
          const { createdBy, description, access, instructions, ...overview } = workouts.get(id)!.workout;
          return overview;
        });
        const list = { ...fixtures.list, collection: { ...fixtures.list.collection, itemsCount: overviews.length, workouts: overviews } };
        return turboStream({ [WORKOUT_LIST_ROUTE]: { data: list } });
      }
      const read = /^\/workouts\/(\d+)\.data$/.exec(path);
      if (read) {
        const detail = workouts.get(read[1]!);
        return detail ? turboStream({ [WORKOUT_DETAIL_ROUTE]: { data: detail } }) : new Response("Not Found", { status: 404 });
      }
    }
    if (request.method === "POST") {
      const form = new URLSearchParams(request.body);
      if (path === "/workouts/create") {
        const id = String(nextId++);
        save(id, form);
        listed = [id, ...listed];
        return formSaved(id);
      }
      const edited = /^\/workouts\/(\d+)\/edit$/.exec(path);
      if (edited && workouts.has(edited[1]!)) {
        save(edited[1]!, form, workouts.get(edited[1]!));
        return formSaved(edited[1]!);
      }
      const deleted = /^\/workouts\/(\d+)\.data$/.exec(path);
      if (deleted && form.get("id") === deleted[1]) {
        listed = listed.filter((id) => id !== deleted[1]);
        return turboStream({ SingleFetchRedirect: { redirect: "/workouts", status: 302 } }, 202);
      }
    }
    return undefined;
  }

  /** fakeNetwork routes: `base` first, then every riders.rouvy.com path through the library. */
  const routes = (base: Record<string, Handler>) =>
    new Proxy(base, {
      get(target, key) {
        if (typeof key !== "string") return undefined;
        if (key in target) return target[key];
        if (!key.startsWith("riders.rouvy.com/")) return undefined;
        const path = key.slice("riders.rouvy.com".length);
        return (request: RecordedRequest) => {
          const response = handle(path, request);
          if (!response) throw new Error(`the fake Workout library has no ${request.method} ${path}`);
          return response;
        };
      },
    });

  return {
    routes,
    workouts,
    listed: () => listed,
    /** Puts a Workout in the library, listed or not (a catalogue Workout, a deleted one…). */
    add(detail: WorkoutDetailPayload, { listed: isListed = true } = {}) {
      workouts.set(detail.workout.id, detail);
      if (isListed) listed = [detail.workout.id, ...listed];
    },
  };
}
