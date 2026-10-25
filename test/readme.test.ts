import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
