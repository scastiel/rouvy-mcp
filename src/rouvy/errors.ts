import { LOGIN_COMMAND } from "../constants.js";

const ISSUES_URL = "https://github.com/scastiel/rouvy-mcp/issues";

/**
 * A failure a tool reports to the MCP client (spec §8). The message names the fix
 * and never carries a token, an Activity id or a response body.
 */
export class RouvyError extends Error {
  override name = "RouvyError";
}

/** No Session could be opened. Terminal when the stored login is dead, rather than Rouvy or Firebase having a moment. */
class NotLoggedInError extends RouvyError {
  constructor(readonly terminal: boolean) {
    super(`Not logged in to Rouvy (or the login expired). Run \`${LOGIN_COMMAND}\` in a terminal, then retry.`);
  }
}

export function notLoggedIn({ terminal }: { terminal: boolean }): RouvyError {
  return new NotLoggedInError(terminal);
}

/** Whether a failure is "no Session could be opened", terminal or not. */
export function isNotLoggedIn(error: unknown): boolean {
  return error instanceof NotLoggedInError;
}

/**
 * Whether a failure means the rider's login is over (spec-m2 §6): the hosted server ends the
 * Grant then. Anything else, an unavailable Rouvy included, is worth trying again later.
 */
export function isTerminalAuthFailure(error: unknown): boolean {
  return error instanceof NotLoggedInError && error.terminal;
}

class RouvyUnavailableError extends RouvyError {}

/** A 5xx (with its status) or a network error (without one). */
export function rouvyUnavailable(status?: number): RouvyError {
  const detail = status === undefined ? "it can't be reached" : `HTTP ${status}`;
  return new RouvyUnavailableError(`Rouvy is unavailable right now (${detail}). Try later.`);
}

/** Whether a request failed with a 5xx or a network error: on a POST, nobody knows if it was saved. */
export function isRouvyUnavailable(error: unknown): boolean {
  return error instanceof RouvyUnavailableError;
}

/** How a Workout write failed, as the operator sees it (spec-m3 §8). */
export type WriteOutcome = "write_rejected" | "outcome_unknown" | "delete_not_confirmed";

/** A Workout write that failed, so a tool call can report its own outcome category. */
export class WriteError extends RouvyError {
  constructor(
    message: string,
    readonly outcome: WriteOutcome,
  ) {
    super(message);
  }
}

/** Rouvy answered the form post without saving: a 200 re-rendering the form, or an unexpected redirect. */
export function writeRejected(detail?: string): RouvyError {
  return new WriteError(
    detail ? `Rouvy rejected the write: ${detail}` : "Rouvy didn't accept the Workout. Nothing was saved.",
    "write_rejected",
  );
}

/** Rouvy answered the delete, but a fresh `created` list still has the Workout. */
export function deleteNotConfirmed(): RouvyError {
  return new WriteError(
    "Rouvy answered but the Workout is still in your library. Call list_workouts to check before trying again.",
    "delete_not_confirmed",
  );
}

/** A 5xx, network error or timeout on a POST: it may or may not have been saved, and is never retried. */
export function outcomeUnknown(): RouvyError {
  return new WriteError(
    "Rouvy may or may not have saved this. Call list_workouts before trying again.",
    "outcome_unknown",
  );
}

export function blockedByBotProtection(until: number): RouvyError {
  // Rounded up to the minute, so trying again at the time shown is never still blocked.
  const at = new Date(Math.ceil(until / 60_000) * 60_000).toISOString().slice(11, 16);
  return new RouvyError(
    `Request blocked by Rouvy's bot protection. Try again after ${at} UTC; report it at ${ISSUES_URL} if it persists.`,
  );
}

export function rateLimited(seconds: number): RouvyError {
  return new RouvyError(`Rouvy rate limited this server. Try again in ${Math.max(1, seconds)} s.`);
}

export function activityNotFound(): RouvyError {
  return new RouvyError("Activity not found. Use an id returned by list_activities.");
}

/** Rouvy has no Activity file for this Activity (none offered, or 403/404 at the export URL). Not drift. */
export function noActivityFile(): RouvyError {
  return new RouvyError(
    "No Activity file for this Activity: intervals, window stats, streams and export aren't available. " +
      "get_activity still works.",
  );
}

/** The ownership check failed (spec-m3 §6.3): never says whether the Workout exists. */
export function workoutNotFound(): RouvyError {
  return new RouvyError("No Workout with this id in your library. Use an id returned by list_workouts.");
}

/** A Workout with watts, W/kg or other targets (from an imported file), which M3 doesn't map. */
export function unsupportedWorkout(): RouvyError {
  return new RouvyError("This Workout has targets other than % FTP: rouvy-mcp reads only % FTP Workouts for now.");
}

export function apiChanged(route: string, field: string): RouvyError {
  return new RouvyError(
    `Rouvy changed its API: ${route} no longer has ${field}. ` +
      `Update rouvy-mcp (restart your MCP client) or report it at ${ISSUES_URL}.`,
  );
}
