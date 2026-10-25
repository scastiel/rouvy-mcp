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

describe("the hosting recipe (docs/spec-m2.md §3, §11)", () => {
  const publicUrl = String(config.vars.PUBLIC_URL);
  const { hostname: publicHost, origin, protocol } = new URL(publicUrl);

  it("turns on nodejs_compat, and global_fetch_strictly_public, which CIMD needs", () => {
    expect(config.compatibility_flags).toEqual(expect.arrayContaining(["nodejs_compat", "global_fetch_strictly_public"]));
  });

  it('keeps "rouvy" out of every hostname: the Worker name (its workers.dev host) and PUBLIC_URL', () => {
    expect(config.name).not.toMatch(/rouvy/i);
    expect(publicHost).not.toMatch(/rouvy/i);
  });

  it("sets PUBLIC_URL to a bare https origin, whose /mcp is the OAuth audience", () => {
    expect(protocol).toBe("https:");
    expect(origin).toBe(publicUrl);
  });

  it("serves PUBLIC_URL's host and only it: a custom domain with workers.dev off, or workers.dev alone", () => {
    const routes: unknown[] = config.routes ?? [];
    const customDomains = routes
      .filter((route): route is { pattern: string; custom_domain: true } =>
        typeof route === "object" && route !== null && "custom_domain" in route && route.custom_domain === true,
      )
      .map((route) => route.pattern);
    if (publicHost.endsWith(".workers.dev")) {
      expect(customDomains).toEqual([]);
      expect(config.workers_dev ?? true).toBe(true);
    } else {
      expect(customDomains).toEqual([publicHost]);
      expect(config.workers_dev).toBe(false);
    }
  });
});
