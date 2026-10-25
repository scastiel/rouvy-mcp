import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The hosted tests run the Worker in Node: the runtime module becomes a stub (test/hosted/cloudflare-workers.ts).
    alias: { "cloudflare:workers": fileURLToPath(new URL("./test/hosted/cloudflare-workers.ts", import.meta.url)) },
  },
  test: {
    setupFiles: ["test/hosted/setup.ts"],
    // Bundled by vitest, so its `cloudflare:workers` import goes through the alias.
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
  },
});
