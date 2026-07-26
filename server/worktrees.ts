import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { WorkspaceProvider } from "./taskManager.js";

const run = promisify(execFile);

async function isGitProject(path: string): Promise<boolean> {
  try {
    await stat(join(path, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * タスクごとの作業ディレクトリ分離。gitプロジェクトなら task/<短縮ID> ブランチの
 * 専用worktreeを <root>/<project>-<短縮ID> に作り、並列タスクの衝突を防ぐ。
 * 非gitプロジェクトは黙ってプロジェクト直下実行に、worktree作成失敗は理由付きで
 * フォールバックする(タスクを失敗させない)。
 */
export function createWorktreeProvider(root: string): WorkspaceProvider {
  return async ({ project, projectPath, taskId }) => {
    if (!(await isGitProject(projectPath))) return { kind: "project" };
    const worktreePath = join(root, `${project}-${taskId}`);
    const branch = `task/${taskId}`;
    try {
      await mkdir(root, { recursive: true });
      await run("git", ["-C", projectPath, "worktree", "add", "-b", branch, worktreePath]);
      return { kind: "worktree", worktreePath, branch };
    } catch (err) {
      return { kind: "project", reason: err instanceof Error ? err.message : String(err) };
    }
  };
}
