/**
 * A request a tool can't answer as asked, found only once the Activity file is in hand (so the
 * input schema couldn't catch it). Its message names the fix and never carries an Activity id.
 */
export class InputError extends Error {
  override name = "InputError";
}
