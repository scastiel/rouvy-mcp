import { LOGIN_COMMAND } from "../constants.js";

const ISSUES_URL = "https://github.com/scastiel/rouvy-mcp/issues";

/**
 * A failure a tool reports to the MCP client (spec §8). The message names the fix
 * and never carries a token, an Activity id or a response body.
 */
export class RouvyError extends Error {
  override name = "RouvyError";
}

export function notLoggedIn(): RouvyError {
  return new RouvyError(
    `Not logged in to Rouvy (or the login expired). Run \`${LOGIN_COMMAND}\` in a terminal, then retry.`,
  );
}

export function rouvyUnavailable(status: number): RouvyError {
  return new RouvyError(`Rouvy is unavailable right now (HTTP ${status}). Try later.`);
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

export function apiChanged(route: string, field: string): RouvyError {
  return new RouvyError(
    `Rouvy changed its API: ${route} no longer has ${field}. ` +
      `Update rouvy-mcp (restart your MCP client) or report it at ${ISSUES_URL}.`,
  );
}
