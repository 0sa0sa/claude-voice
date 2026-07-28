import { describe, expect, it, vi } from "vitest";
import { ProjectIndex } from "./projectIndex.js";
import type { ProjectInfo } from "./projects.js";

function project(name: string): ProjectInfo {
  return { name, hasGit: true, hasPackageJson: true, updatedAt: 1 };
}

function makeIndex(overrides?: {
  scan?: (opts: { all: boolean }) => Promise<ProjectInfo[]>;
  resolve?: (name: string) => Promise<string | null>;
  ttlMs?: number;
  now?: () => number;
}) {
  const scan = overrides?.scan ?? vi.fn(async () => [project("alpha")]);
  const resolve = overrides?.resolve ?? vi.fn(async (name: string) => `/root/${name}`);
  const index = new ProjectIndex({
    scan,
    resolve,
    ttlMs: overrides?.ttlMs ?? 10_000,
    now: overrides?.now,
  });
  return { index, scan, resolve };
}

describe("ProjectIndex.list", () => {
  it("scans only once for repeated calls within the TTL", async () => {
    const scan = vi.fn(async () => [project("alpha")]);
    const { index } = makeIndex({ scan });
    expect(await index.list()).toEqual([project("alpha")]);
    expect(await index.list()).toEqual([project("alpha")]);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("re-scans after the TTL expires", async () => {
    let t = 0;
    const scan = vi.fn(async () => [project("alpha")]);
    const { index } = makeIndex({ scan, ttlMs: 1000, now: () => t });
    await index.list();
    t = 1001;
    await index.list();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("caches the recent list and the full list separately", async () => {
    const scan = vi.fn(async (opts: { all: boolean }) =>
      opts.all ? [project("alpha"), project("stale")] : [project("alpha")],
    );
    const { index } = makeIndex({ scan });
    expect((await index.list()).map((p) => p.name)).toEqual(["alpha"]);
    expect((await index.list({ all: true })).map((p) => p.name)).toEqual(["alpha", "stale"]);
    expect((await index.list()).map((p) => p.name)).toEqual(["alpha"]);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("shares a single in-flight scan between concurrent calls", async () => {
    let release!: (v: ProjectInfo[]) => void;
    const scan = vi.fn(() => new Promise<ProjectInfo[]>((r) => (release = r)));
    const { index } = makeIndex({ scan });
    const [a, b] = [index.list(), index.list()];
    release([project("alpha")]);
    expect(await a).toEqual([project("alpha")]);
    expect(await b).toEqual([project("alpha")]);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("does not cache scan failures", async () => {
    const scan = vi
      .fn<(opts: { all: boolean }) => Promise<ProjectInfo[]>>()
      .mockRejectedValueOnce(new Error("disk error"))
      .mockResolvedValue([project("alpha")]);
    const { index } = makeIndex({ scan });
    await expect(index.list()).rejects.toThrow("disk error");
    expect(await index.list()).toEqual([project("alpha")]);
  });

  it("invalidate() forces the next call to re-scan", async () => {
    const scan = vi.fn(async () => [project("alpha")]);
    const { index } = makeIndex({ scan });
    await index.list();
    index.invalidate();
    await index.list();
    expect(scan).toHaveBeenCalledTimes(2);
  });
});

describe("ProjectIndex.resolve", () => {
  it("caches successful resolutions within the TTL", async () => {
    const resolve = vi.fn(async (name: string) => `/root/${name}`);
    const { index } = makeIndex({ resolve });
    expect(await index.resolve("alpha")).toBe("/root/alpha");
    expect(await index.resolve("alpha")).toBe("/root/alpha");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("caches per project name", async () => {
    const resolve = vi.fn(async (name: string) => `/root/${name}`);
    const { index } = makeIndex({ resolve });
    expect(await index.resolve("alpha")).toBe("/root/alpha");
    expect(await index.resolve("beta")).toBe("/root/beta");
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("does not cache misses, so a newly created project resolves immediately", async () => {
    const resolve = vi
      .fn<(name: string) => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue("/root/fresh");
    const { index } = makeIndex({ resolve });
    expect(await index.resolve("fresh")).toBeNull();
    expect(await index.resolve("fresh")).toBe("/root/fresh");
  });

  it("expires cached resolutions after the TTL", async () => {
    let t = 0;
    const resolve = vi.fn(async (name: string) => `/root/${name}`);
    const { index } = makeIndex({ resolve, ttlMs: 1000, now: () => t });
    await index.resolve("alpha");
    t = 1001;
    await index.resolve("alpha");
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("invalidate() clears cached resolutions too", async () => {
    const resolve = vi.fn(async (name: string) => `/root/${name}`);
    const { index } = makeIndex({ resolve });
    await index.resolve("alpha");
    index.invalidate();
    await index.resolve("alpha");
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
