import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorktreeProvider } from "./worktrees.js";

const run = promisify(execFile);

async function initRepo(path: string): Promise<void> {
  await run("git", ["init", "-q"], { cwd: path });
  await run("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], {
    cwd: path,
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe("createWorktreeProvider", () => {
  let base: string;
  let projectPath: string;
  let root: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "cv-worktrees-"));
    projectPath = join(base, "demo");
    root = join(base, "worktrees");
    await run("mkdir", ["-p", projectPath]);
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("creates a task branch worktree for a git project", async () => {
    await initRepo(projectPath);
    const provider = createWorktreeProvider(root);
    const ws = await provider({ project: "demo", projectPath, taskId: "ab12cd34" });
    expect(ws).toEqual({
      kind: "worktree",
      worktreePath: join(root, "demo-ab12cd34"),
      branch: "task/ab12cd34",
    });
    if (ws.kind !== "worktree") throw new Error("unreachable");
    // worktreeとして実体があり(.gitファイルを持つ)、専用ブランチがチェックアウトされている
    expect(await exists(join(ws.worktreePath, ".git"))).toBe(true);
    const { stdout } = await run("git", ["branch", "--show-current"], { cwd: ws.worktreePath });
    expect(stdout.trim()).toBe("task/ab12cd34");
  });

  it("keeps worktrees of parallel tasks on the same project separate", async () => {
    await initRepo(projectPath);
    const provider = createWorktreeProvider(root);
    const a = await provider({ project: "demo", projectPath, taskId: "aaaa1111" });
    const b = await provider({ project: "demo", projectPath, taskId: "bbbb2222" });
    if (a.kind !== "worktree" || b.kind !== "worktree") throw new Error("expected worktrees");
    expect(a.worktreePath).not.toBe(b.worktreePath);
    // 片方のworktreeでの変更がもう片方に現れない(=作業ディレクトリが衝突しない)
    await writeFile(join(a.worktreePath, "only-a.txt"), "a", "utf8");
    expect(await exists(join(b.worktreePath, "only-a.txt"))).toBe(false);
    expect(await exists(join(projectPath, "only-a.txt"))).toBe(false);
  });

  it("falls back silently for non-git projects", async () => {
    const provider = createWorktreeProvider(root);
    const ws = await provider({ project: "demo", projectPath, taskId: "ab12cd34" });
    expect(ws).toEqual({ kind: "project" });
    expect(await exists(join(root, "demo-ab12cd34"))).toBe(false);
  });

  it("falls back with a reason when git worktree add fails", async () => {
    // コミットが1つもないリポジトリではHEADが無くworktree addが失敗する
    await run("git", ["init", "-q"], { cwd: projectPath });
    const provider = createWorktreeProvider(root);
    const ws = await provider({ project: "demo", projectPath, taskId: "ab12cd34" });
    expect(ws.kind).toBe("project");
    if (ws.kind !== "project") throw new Error("unreachable");
    expect(ws.reason).toBeTruthy();
  });
});
