import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ProjectInfo {
  name: string;
  hasGit: boolean;
  hasPackageJson: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function scanProjects(root: string): Promise<ProjectInfo[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const projects = await Promise.all(
    dirs.map(async (d) => ({
      name: d.name,
      hasGit: await exists(join(root, d.name, ".git")),
      hasPackageJson: await exists(join(root, d.name, "package.json")),
    })),
  );
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Maps a spoken/LLM-provided project name to a real directory under root.
 * "_root" targets the projects root itself (for scaffolding new projects).
 * Returns null for anything unsafe or missing.
 */
export async function resolveProjectPath(root: string, name: string): Promise<string | null> {
  if (name === "_root") return root;
  if (!SAFE_NAME.test(name) || name.includes("..")) return null;
  const path = join(root, name);
  try {
    return (await stat(path)).isDirectory() ? path : null;
  } catch {
    return null;
  }
}
