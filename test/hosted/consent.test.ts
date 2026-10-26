import { describe, expect, it } from "vitest";
import { CONSENT_VERSION, consentIsCurrent } from "../../src/hosted/consent.js";

describe("a Grant's consent", () => {
  it("is version 2 since Workout writes (spec-m3 §9)", () => {
    expect(CONSENT_VERSION).toBe(2);
  });

  it.each([
    ["an M2 Grant, which carries no version", {}, false],
    ["a Grant under the read-only wording", { consentVersion: 1 }, false],
    ["a Grant under the Workout wording", { consentVersion: 2 }, true],
    ["a Grant from a newer build", { consentVersion: 3 }, true],
  ])("is current or not for %s", (_, props, current) => {
    expect(consentIsCurrent(props)).toBe(current);
  });
});
