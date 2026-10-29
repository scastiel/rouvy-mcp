import { decode } from "turbo-stream";
import { RIDERS } from "../constants.js";
import type { WriteInstruction, WriteSegment } from "../workouts/steps.js";
import type { RouvyClient } from "./client.js";
import {
  deleteNotConfirmed,
  isRouvyUnavailable,
  outcomeUnknown,
  RouvyError,
  WriteError,
  writeRejected,
} from "./errors.js";
import type { SessionManager } from "./session-manager.js";
import type { WorkoutDetail } from "./workout-schemas.js";


/** Everything Rouvy's Workout form takes but the route, already in Rouvy's terms. */
export interface WorkoutForm {
  name: string;
  description: string;
  tags: readonly string[];
  access: "PRIVATE" | "PUBLIC";
  segments: WriteSegment[];
  instructions: WriteInstruction[];
}

/**
 * The only code that writes to Rouvy (spec-m3 §6), apart from the read client. Every write starts
 * with a GET in the same Session, sends one POST that is never retried, and returns the Workout
 * read back through the ownership check.
 */
export interface WorkoutWriter {
  /** Creates a Workout on `routeId`, or on the creator's default route. */
  create(form: WorkoutForm, routeId?: string): Promise<WorkoutDetail>;
  /**
   * Replaces an owned Workout with the form `edit` builds from its current state, read just before.
   * The route is always kept. Last write wins: Rouvy keeps no version to compare against.
   */
  update(workoutId: string, edit: (current: WorkoutDetail) => WorkoutForm): Promise<WorkoutDetail>;
  /**
   * Removes an owned Workout from the rider's library and checks it's gone from a fresh `created`
   * list. Rouvy's delete is soft: the Workout stays readable by its id. Returns its name.
   */
  delete(workoutId: string): Promise<{ name: string }>;
}

export function createWorkoutWriter(
  fetch: typeof globalThis.fetch,
  sessions: SessionManager,
  rouvy: RouvyClient,
): WorkoutWriter {
  /** One POST. A 5xx or a network error is *outcome unknown*; the polite fetch never retries a POST. */
  async function post(path: string, body: URLSearchParams): Promise<Response> {
    const session = await sessions.current();
    try {
      const response = await fetch(new URL(path, RIDERS), {
        method: "POST",
        headers: { cookie: session.cookieHeader(), "content-type": "application/x-www-form-urlencoded" },
        body,
        redirect: "manual",
      });
      session.keepCookies(response.headers.getSetCookie());
      return response;
    } catch (error) {
      if (isRouvyUnavailable(error)) {
        await rouvy.dropWorkoutList();
        throw outcomeUnknown();
      }
      throw error;
    }
  }

  /** A form post: success is a 3xx to `/workouts/<digits>` (to `expectedId` on an edit), which is returned. */
  async function submit(path: string, form: WorkoutForm, routeId: string, expectedId?: string): Promise<string> {
    const response = await post(path, encodeForm(form, routeId));
    if (response.status >= 300 && response.status < 400) {
      const id = workoutIdIn(response.headers.get("location"));
      if (id && (expectedId === undefined || id === expectedId)) {
        await rouvy.dropWorkoutList();
        return id;
      }
      throw writeRejected();
    }
    throw writeRejected(response.status === 200 ? await formErrors(response) : undefined);
  }

  /** After a write that succeeded, so a failure here must not read as "nothing was saved". */
  async function readBack(workoutId: string): Promise<WorkoutDetail> {
    try {
      return await rouvy.getOwnedWorkout(workoutId);
    } catch (error) {
      if (error instanceof WriteError) throw error;
      throw new RouvyError("Rouvy saved the Workout, but reading it back failed. Call list_workouts to find it.");
    }
  }

  return {
    async create(form, routeId) {
      // GET first: a logged-out Session or a block shows up here, before anything is written.
      const defaultRouteId = await rouvy.getDefaultRouteId();
      await rouvy.listWorkouts();
      const id = await submit("/workouts/create", form, routeId ?? defaultRouteId);
      return readBack(id);
    },
    async update(workoutId, edit) {
      // GET first: the ownership check, and the state every left-out field keeps.
      const current = await rouvy.getOwnedWorkout(workoutId);
      const form = edit(current);
      // A Workout always has a route in Rouvy's creator; without one, the creator's default stands in.
      const routeId = current.recommendedRoute?.id ?? (await rouvy.getDefaultRouteId());
      await submit(`/workouts/${encodeURIComponent(workoutId)}/edit`, form, routeId, workoutId);
      return readBack(workoutId);
    },
    async delete(workoutId) {
      // GET first: the ownership check. It also reads the Workout itself, so the POST never goes out
      // on a Session's very first request, which Rouvy answers with a cookie redirect (also a 202).
      const { name } = await rouvy.getOwnedWorkout(workoutId);
      const response = await post(`/workouts/${encodeURIComponent(workoutId)}.data`, new URLSearchParams({ id: workoutId }));
      await rouvy.dropWorkoutList();
      if (response.status !== 202) throw writeRejected();
      const { workouts } = await rouvy.listWorkouts();
      if (workouts.some((w) => w.id === workoutId)) throw deleteNotConfirmed();
      return { name };
    },
  };
}

/** Rouvy's field order. Tags go in one comma-joined field, as the creator's hidden input sends them. */
export function encodeForm(form: WorkoutForm, routeId: string): URLSearchParams {
  return new URLSearchParams([
    ["name", form.name],
    ["description", form.description],
    ["tags", form.tags.join(",")],
    ["access", form.access],
    ["recommendedRouteId", routeId],
    ["segments", JSON.stringify(form.segments)],
    ["instructions", JSON.stringify(form.instructions)],
  ]);
}

/** `/workouts/<digits>` (or the same on riders.rouvy.com), else undefined. */
export function workoutIdIn(location: string | null): string | undefined {
  if (!location) return undefined;
  const url = new URL(location, RIDERS);
  if (url.origin !== RIDERS || url.search) return undefined;
  return /^\/workouts\/(\d+)$/.exec(url.pathname)?.[1];
}

/**
 * A rejected form post re-renders the creator, with React Router's action data streamed into the
 * page: `{status: "error", error: {<field>: [message]}}` (spec-m3 §3). Only field names and Rouvy's
 * validation messages are kept, never the echoed input.
 */
export async function formErrors(response: Response): Promise<string | undefined> {
  try {
    const html = await response.text();
    const chunks = [...html.matchAll(/streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g)].map((m) => JSON.parse(m[1]!) as string);
    if (chunks.length === 0) return undefined;
    const { value, done } = await decode(new Blob([chunks.join("")]).stream());
    done.catch(() => {});
    const actionData = (await (value as { actionData?: unknown }).actionData) as Record<string, { error?: unknown }> | null;
    const messages = Object.values(actionData ?? {}).flatMap(({ error }) =>
      error && typeof error === "object"
        ? Object.entries(error).flatMap(([field, list]) =>
            Array.isArray(list) ? list.filter((m) => typeof m === "string").map((m) => `${field}: ${m}`) : [],
          )
        : [],
    );
    return messages.length > 0 ? messages.join("; ").slice(0, 500) : undefined;
  } catch {
    return undefined;
  }
}
