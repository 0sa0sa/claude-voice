import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveProjectPath, scanProjects } from "./projects.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const root = mkdtempSync(join(tmpdir(), "cv-projects-"));
mkdirSync(join(root, "alpha", ".git"), { recursive: true });
mkdirSync(join(root, "beta"));
writeFileSync(join(root, "beta", "package.json"), "{}");
mkdirSync(join(root, "plain"));
mkdirSync(join(root, ".hidden"));
writeFileSync(join(root, "not-a-dir.txt"), "x");

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("scanProjects", () => {
  it("lists visible directories with git/package metadata, sorted by name", async () => {
    const projects = await scanProjects(root);
    expect(projects.map((p) => p.name)).toEqual(["alpha", "beta", "plain"]);
    expect(projects[0]).toMatchObject({ name: "alpha", hasGit: true, hasPackageJson: false });
    expect(projects[1]).toMatchObject({ name: "beta", hasGit: false, hasPackageJson: true });
  });

  it("excludes hidden directories and plain files", async () => {
    const names = (await scanProjects(root)).map((p) => p.name);
    expect(names).not.toContain(".hidden");
    expect(names).not.toContain("not-a-dir.txt");
  });
});

describe("scanProjects recency filter", () => {
  // 専用root: fresh(今)/stale(40日前)/edge(29日前) のmtimeを持つ3プロジェクト
  const recentRoot = mkdtempSync(join(tmpdir(), "cv-recent-"));
  mkdirSync(join(recentRoot, "fresh"));
  mkdirSync(join(recentRoot, "stale"));
  mkdirSync(join(recentRoot, "edge"));
  const now = Date.now();
  utimesSync(join(recentRoot, "stale"), new Date(now - 40 * DAY_MS), new Date(now - 40 * DAY_MS));
  utimesSync(join(recentRoot, "edge"), new Date(now - 29 * DAY_MS), new Date(now - 29 * DAY_MS));

  afterAll(() => rmSync(recentRoot, { recursive: true, force: true }));

  it("excludes projects not touched within the default 30 days", async () => {
    const names = (await scanProjects(recentRoot)).map((p) => p.name);
    expect(names).toEqual(["edge", "fresh"]);
  });

  it("includes all projects when maxAgeDays is null", async () => {
    const names = (await scanProjects(recentRoot, { maxAgeDays: null })).map((p) => p.name);
    expect(names).toEqual(["edge", "fresh", "stale"]);
  });

  it("respects a custom maxAgeDays threshold", async () => {
    const names = (await scanProjects(recentRoot, { maxAgeDays: 7 })).map((p) => p.name);
    expect(names).toEqual(["fresh"]);
  });

  it("reports updatedAt from the directory mtime", async () => {
    const projects = await scanProjects(recentRoot, { maxAgeDays: null });
    const stale = projects.find((p) => p.name === "stale")!;
    expect(stale.updatedAt).toBeGreaterThan(now - 41 * DAY_MS);
    expect(stale.updatedAt).toBeLessThan(now - 39 * DAY_MS);
  });
});

describe("resolveProjectPath", () => {
  it("resolves an existing project directory", async () => {
    expect(await resolveProjectPath(root, "alpha")).toBe(join(root, "alpha"));
  });

  it("resolves _root to the projects root (for scaffolding new projects)", async () => {
    expect(await resolveProjectPath(root, "_root")).toBe(root);
  });

  it("rejects unknown projects", async () => {
    expect(await resolveProjectPath(root, "nope")).toBeNull();
  });

  it("rejects path traversal and separators", async () => {
    expect(await resolveProjectPath(root, "../etc")).toBeNull();
    expect(await resolveProjectPath(root, "a/b")).toBeNull();
    expect(await resolveProjectPath(root, "..")).toBeNull();
  });
});
