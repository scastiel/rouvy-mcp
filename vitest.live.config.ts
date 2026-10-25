import { defineConfig } from "vitest/config";

/** Checks against the real Rouvy: never part of `npm test`. See `npm run canary` and `npm run contract:live`. */
export default defineConfig({
  test: {
    include: ["test/drift/*.live.ts"],
    testTimeout: 120_000,
  },
});
