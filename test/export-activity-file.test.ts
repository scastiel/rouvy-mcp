import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDirectoryStorage } from "../src/storage/directory.js";
import { fixtureActivityFile, ROUTE_ACTIVITY, routeActivityServer, syntheticActivityFile, text } from "./server-harness.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** An export folder that doesn't exist yet, inside a fresh temp dir. */
async function exportDir() {
  const parent = await mkdtemp(join(tmpdir(), "rouvy-mcp-export-"));
  folders.push(parent);
  return join(parent, "exports");
}

describe("export_activity_file", () => {
  it("isn't listed when no export folder is set", async () => {
    const { client } = await routeActivityServer();

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).not.toContain("export_activity_file");
  });

  it("is listed when an export folder is set", async () => {
    const { client } = await routeActivityServer({ storage: createDirectoryStorage(await exportDir()) });

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toContain("export_activity_file");
  });

  it("writes the Activity file as downloaded, readable only by the user, and returns its absolute path", async () => {
    const dir = await exportDir();
    const { exportFile } = await exporting(dir);

    const result = await exportFile({ format: "fit" });

    expect(result.isError).toBeFalsy();
    const path = join(dir, `${ROUTE_ACTIVITY}.fit`);
    expect(JSON.parse(text(result))).toEqual({ activity_id: ROUTE_ACTIVITY, format: "fit", path });
    expect(new Uint8Array(await readFile(path))).toEqual(new Uint8Array(fixtureActivityFile()));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("by default, writes the per-second records as CSV, leaving a reading the Activity file lacks empty", async () => {
    const dir = await exportDir();
    const { exportFile } = await exporting(dir, {
      file: () =>
        new Response(
          syntheticActivityFile([
            { power: 210, heartRate: 131, altitude: 100, distance: 0 },
            { power: 0, altitude: 100.4, distance: 7.5 },
          ]),
        ),
    });

    const result = await exportFile();

    const path = join(dir, `${ROUTE_ACTIVITY}.csv`);
    expect(JSON.parse(text(result))).toEqual({ activity_id: ROUTE_ACTIVITY, format: "csv", path });
    expect(await readFile(path, "utf8")).toBe(
      [
        "sec,timestamp,power,heart_rate,cadence,speed,altitude,distance,position_lat,position_long",
        "0,2026-01-01T00:00:00.000Z,210,131,,,100,0,,",
        "1,2026-01-01T00:00:01.000Z,0,,,,100.4,7.5,,",
        "",
      ].join("\n"),
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("overwrites an earlier export, which ends up readable only by the user too", async () => {
    const dir = await exportDir();
    const path = join(dir, `${ROUTE_ACTIVITY}.fit`);
    await mkdir(dir);
    await writeFile(path, "an older export", { mode: 0o644 });
    const { exportFile } = await exporting(dir);

    await exportFile({ format: "fit" });

    expect(new Uint8Array(await readFile(path))).toEqual(new Uint8Array(fixtureActivityFile()));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual([`${ROUTE_ACTIVITY}.fit`]);
  });

  it.each(["fit", "csv"])("answers 'No Activity file' in %s, and writes nothing, when the export URL returns 404", async (format) => {
    const dir = await exportDir();
    const { exportFile } = await exporting(dir, { file: () => new Response("<Error/>", { status: 404 }) });

    const result = await exportFile({ format });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain("No Activity file");
    await expect(readdir(dir)).rejects.toThrow();
  });

  it("answers 'No Activity file' when Rouvy offers none, without trying to download one", async () => {
    const { exportFile, network } = await exporting(await exportDir(), {
      change: (detail) => {
        detail.exportLink = null;
      },
    });

    const result = await exportFile();

    expect(text(result)).toContain("No Activity file");
    expect(network.requests.map((r) => r.url.host)).not.toContain("activities.virtualtraining.eu");
  });
});

async function exporting(dir: string, options: Parameters<typeof routeActivityServer>[0] = {}) {
  const server = await routeActivityServer({ storage: createDirectoryStorage(dir), ...options });
  const exportFile = (args: Record<string, unknown> = {}) =>
    server.client.callTool({ name: "export_activity_file", arguments: { activity_id: ROUTE_ACTIVITY, ...args } });
  return { ...server, exportFile };
}
