import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unstable_readConfig } from "wrangler";

const config = unstable_readConfig({ config: fileURLToPath(new URL("../../wrangler.toml", import.meta.url)) });

describe("the deployed Worker's config", () => {
  it("keeps Workers Logs for our own events, with invocation logs off: no request URL, header or IP is recorded", () => {
    expect(config.observability?.enabled).toBe(true);
    expect(config.observability?.logs).toMatchObject({ enabled: true, invocation_logs: false });
    expect(config.observability?.logs?.destinations ?? []).toEqual([]);
  });

  it("records no traces, which would hold request URLs", () => {
    expect(config.observability?.traces?.enabled ?? false).toBe(false);
  });

  it("has no Logpush", () => {
    expect(config.logpush ?? false).toBe(false);
  });
});
