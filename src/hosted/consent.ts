import type { GrantProps } from "./riders.js";

/**
 * The consent wording a new Grant is given under (spec-m3 §9). 1 is M2's read-only wording, which
 * Grants carried without saying; 2 covers Workout writes. The next consent change bumps it again.
 */
export const CONSENT_VERSION = 2;

/** Whether a Grant was given under the current wording. Older or unmarked Grants are ended on their next request. */
export function consentIsCurrent(props: Pick<GrantProps, "consentVersion">, current = CONSENT_VERSION): boolean {
  return (props.consentVersion ?? 1) >= current;
}
