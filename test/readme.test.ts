import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SELF_HOST_URL } from "../src/hosted/pages.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const spec = readFileSync(new URL("../docs/spec-m1.md", import.meta.url), "utf8");

/** The blockquote under spec §11, unquoted: the source of truth for the README's disclaimer. */
function specDisclaimer(): string {
  const section = spec.split("## 11. Disclaimer")[1]!.split("\n## ")[0]!;
  return section
    .split("\n")
    .filter((line) => line.startsWith(">"))
    .map((line) => line.replace(/^> ?/, ""))
    .join("\n")
    .trim();
}

describe("the README", () => {
  it("carries the spec's disclaimer verbatim", () => {
    expect(specDisclaimer()).toContain("**Unofficial project.** rouvy-mcp is not affiliated with");
    expect(readme).toContain(specDisclaimer());
  });

  it("shows the install line, the one-time login and the optional export folder", () => {
    expect(readme).toContain('"args": ["-y", "rouvy-mcp@latest"]');
    expect(readme).toContain("npx -y rouvy-mcp login");
    expect(readme).toContain("ROUVY_MCP_EXPORT_DIR");
  });

  it("says logout can't revoke the login: changing the Rouvy password does", () => {
    expect(readme).toContain("npx -y rouvy-mcp logout");
    expect(readme).toMatch(/change your Rouvy password/i);
  });
});

/** GitHub's anchor for a heading: lowercased, punctuation dropped, spaces to dashes. */
function anchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/ /g, "-");
}

describe("the README's self-host section (docs/spec-m2.md §11)", () => {
  const headings = [...readme.matchAll(/^## (.+)$/gm)].map((match) => match[1]!);
  const heading = headings.find((text) => anchor(text) === new URL(SELF_HOST_URL).hash.slice(1));
  const section = heading ? readme.split(`## ${heading}\n`)[1]!.split("\n## ")[0]! : "";

  it("is where the sign-in page's self-host link lands", () => {
    expect(heading).toBeDefined();
  });

  it("deploys a fork with the repo's deploy script, on Workers Paid", () => {
    expect(section).toMatch(/fork/i);
    expect(section).toContain("npm run deploy");
    expect(section).toContain("Workers Paid");
  });

  it("creates the KV namespace and the allow-list secret, and keeps the Durable Object in the EU", () => {
    expect(section).toContain("npx wrangler kv namespace create OAUTH_KV");
    expect(section).toContain("npx wrangler secret put ALLOW_LIST");
    expect(section).toMatch(/Durable Object.*EU jurisdiction/s);
  });

  it("names both compatibility flags", () => {
    expect(section).toContain("nodejs_compat");
    expect(section).toContain("global_fetch_strictly_public");
  });

  it("puts it on a custom domain that never changes once riders have connected", () => {
    expect(section).toContain("custom_domain = true");
    expect(section).toMatch(/never change.*once riders have connected/is);
  });

  it("points to the kill-one-rider and Hard stop steps, and says the self-hoster is the operator", () => {
    expect(section).toContain("docs/operations.md#kill-one-rider");
    expect(section).toContain("docs/runbooks/hard-stop.md");
    expect(section).toMatch(/you are the operator/i);
  });

  it("promises no support", () => {
    expect(section).toMatch(/best effort/i);
    expect(section).toMatch(/no support/i);
  });
});
