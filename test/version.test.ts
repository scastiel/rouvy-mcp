import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USER_AGENT } from "../src/constants.js";

describe("the version", () => {
  // src/version.ts is generated, but committed so typecheck and the Worker build don't need the script first.
  it("matches package.json, so a version bump without `npm version` is caught", () => {
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

    expect(USER_AGENT).toBe(`rouvy-mcp/${version} (+https://github.com/scastiel/rouvy-mcp)`);
  });
});
