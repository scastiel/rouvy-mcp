/**
 * A request a tool can't answer as asked, that the input schema can't catch: one comparing two
 * fields, or one that needs the Activity file in hand. Its message names the fix and never
 * carries an Activity id.
 */
export class InputError extends Error {
  override name = "InputError";
}
