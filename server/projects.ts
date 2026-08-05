import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export interface ProjectInfo {
  name: string;
  hasGit: boolean;
  hasPackageJson: boolean;
  /** プロジェクトディレクトリのmtime (ms) */
  updatedAt: number;
}

/** 一覧に出す「最近触ったプロジェクト」の既定閾値 */
export const DEFAULT_RECENT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScanOptions {
  /** 最終更新がこの日数以内のものだけ返す。null で全件。省略時は DEFAULT_RECENT_DAYS */
  maxAgeDays?: number | null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function scanProjects(root: string, opts: ScanOptions = {}): Promise<ProjectInfo[]> {
  const maxAgeDays = opts.maxAgeDays === undefined ? DEFAULT_RECENT_DAYS : opts.maxAgeDays;
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("."));
  const projects = await Promise.all(
    dirs.map(async (d) => {
      try {
        const s = await stat(join(root, d.name));
        return {
          name: d.name,
          hasGit: await exists(join(root, d.name, ".git")),
          hasPackageJson: await exists(join(root, d.name, "package.json")),
          updatedAt: s.mtimeMs,
        };
      } catch {
        return null; // スキャン中に消えたディレクトリは無視
      }
    }),
  );
  const cutoff = maxAgeDays === null ? -Infinity : Date.now() - maxAgeDays * DAY_MS;
  return projects
    .filter((p): p is ProjectInfo => p !== null && p.updatedAt >= cutoff)
    .sort((a, b) => a.name.localeCompare(b.name));
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
