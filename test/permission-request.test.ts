import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const doc = readFileSync(new URL("../docs/legal/rouvy-permission-request.md", import.meta.url), "utf8");
const email = doc.split("## The email\n")[1]!;

/** The outline the request must follow (spec-m2 §10, as changed by spec-m3 §9). */
describe("the Rouvy permission request", () => {
  it("asks for §29.i written permission", () => {
    expect(email).toContain("§29.i");
    expect(email).toMatch(/written permission/i);
  });

  it("says how to recognise the instance", () => {
    expect(email).toContain("rouvy-mcp/<version> (+https://github.com/scastiel/rouvy-mcp)");
    expect(email).toContain("CF-Worker");
    expect(email).toMatch(/refresh token, encrypted/);
    expect(email).toMatch(/stores no Activity or Workout data/);
    expect(email).toMatch(/within 24 hours/);
  });

  it("says what the instance does: reads, plus the rider's own Workouts on request", () => {
    expect(email).toMatch(/creates, edits and deletes the rider's own Workouts when the rider asks/);
    expect(email).toMatch(/same routes Rouvy's web app uses/);
  });

  it("offers allow-listing our zone as an optional extra, and one cooperative Data Act paragraph", () => {
    expect(email).toMatch(/Optionally.*allow-listing our zone/s);
    expect(email.split("\n\n").filter((paragraph) => paragraph.includes("Data Act"))).toHaveLength(1);
  });

  it("never says read-only, never threatens, never mentions Terra", () => {
    expect(doc).not.toMatch(/read-only/i);
    expect(doc).not.toMatch(/Terra\b/);
    expect(email).not.toMatch(/lawsuit|legal action|court|sue\b/i);
  });

  it("leaves the maintainer a checklist: both channels and the 4-week follow-up", () => {
    expect(doc).toMatch(/help desk/i);
    expect(doc).toMatch(/named Rouvy product or business person/);
    expect(doc).toMatch(/Follow-up due/);
    expect(doc).toMatch(/"Yes, but no writes"/);
  });
});
