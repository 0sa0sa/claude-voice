import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveProjectPath, scanProjects } from "./projects.js";

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
