import { describe, expect, it } from "vitest";
import { TaskManager } from "./taskManager.js";
import type { TaskSpawner } from "./taskManager.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("TaskManager", () => {
  it("starts a task in running state and succeeds with the runner result", async () => {
    const d = deferred<{ text: string }>();
    const spawner: TaskSpawner = async ({ onEvent }) => {
      onEvent({ kind: "tool", name: "Bash" });
      onEvent({ kind: "delta", text: "テスト実行中" });
      return d.promise;
    };
    const tm = new TaskManager(spawner);
    const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "run tests" });
    expect(task.status).toBe("running");
    expect(task.id).toBeTruthy();

    d.resolve({ text: "全テスト通過" });
    await tick();
    const done = tm.get(task.id)!;
    expect(done.status).toBe("succeeded");
    expect(done.result).toBe("全テスト通過");
    expect(done.events.some((e) => e.kind === "tool" && e.text === "Bash")).toBe(true);
  });

  it("marks failing tasks as failed with the error message", async () => {
    const tm = new TaskManager(async () => {
      throw new Error("boom");
    });
    const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
    await tick();
    const done = tm.get(task.id)!;
    expect(done.status).toBe("failed");
    expect(done.error).toContain("boom");
  });

  it("cancel aborts the runner signal and marks cancelled", async () => {
    let aborted = false;
    const never = deferred<{ text: string }>();
    const tm = new TaskManager(async ({ signal }) => {
      signal.addEventListener("abort", () => {
        aborted = true;
        never.reject(new Error("aborted"));
      });
      return never.promise;
    });
    const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
    expect(tm.cancel(task.id)).toBe(true);
    await tick();
    expect(aborted).toBe(true);
    expect(tm.get(task.id)!.status).toBe("cancelled");
  });

  it("cancel returns false for unknown or finished tasks", async () => {
    const tm = new TaskManager(async () => ({ text: "ok" }));
    const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
    await tick();
    expect(tm.cancel(task.id)).toBe(false);
    expect(tm.cancel("nope")).toBe(false);
  });

  it("lists tasks newest first with summaries", async () => {
    const tm = new TaskManager(async () => ({ text: "ok" }));
    tm.start({ project: "a", projectPath: "/tmp/a", instruction: "first" });
    tm.start({ project: "b", projectPath: "/tmp/b", instruction: "second" });
    const list = tm.list();
    expect(list.map((t) => t.instruction)).toEqual(["second", "first"]);
    expect(list[0]).toHaveProperty("status");
    expect(list[0]).toHaveProperty("project", "b");
  });

  it("captures the session id from spawner events without polluting the event log", async () => {
    const tm = new TaskManager(async ({ onEvent }) => {
      onEvent({ kind: "session", sessionId: "sess-abc" });
      onEvent({ kind: "delta", text: "working" });
      return { text: "ok" };
    });
    const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
    await tick();
    const done = tm.get(task.id)!;
    expect(done.sessionId).toBe("sess-abc");
    expect(done.events.every((e) => e.text !== "sess-abc")).toBe(true);
  });

  it("keeps the session id even when the task fails mid-run", async () => {
    const tm = new TaskManager(async ({ onEvent }) => {
      onEvent({ kind: "session", sessionId: "sess-fail" });
      throw new Error("boom");
    });
    const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
    await tick();
    const done = tm.get(task.id)!;
    expect(done.status).toBe("failed");
    expect(done.sessionId).toBe("sess-fail");
  });

  it("uses the session id returned by the spawner result as a fallback", async () => {
    const tm = new TaskManager(async () => ({ text: "ok", sessionId: "sess-result" }));
    const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
    await tick();
    expect(tm.get(task.id)!.sessionId).toBe("sess-result");
  });

  it("passes resumeSessionId to the spawner and records resumedFrom", async () => {
    let received: string | undefined;
    const tm = new TaskManager(async ({ resumeSessionId }) => {
      received = resumeSessionId;
      return { text: "ok" };
    });
    const task = tm.start({
      project: "a",
      projectPath: "/tmp/a",
      instruction: "x",
      resumeSessionId: "sess-prev",
    });
    await tick();
    expect(received).toBe("sess-prev");
    expect(tm.get(task.id)!.resumedFrom).toBe("sess-prev");
  });

  it("appends the voice-friendly report directive to the instruction sent to the spawner", async () => {
    let received: string | undefined;
    const tm = new TaskManager(async ({ instruction }) => {
      received = instruction;
      return { text: "ok" };
    });
    const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "run tests" });
    await tick();
    expect(received).toBeDefined();
    expect(received!.startsWith("run tests")).toBe(true);
    expect(received).toContain("3文程度");
    expect(received).toContain("音声で読み上げ");
    // 一覧表示に使う保存済みinstructionは元の指示のまま
    expect(task.instruction).toBe("run tests");
  });

  describe("appendInstruction", () => {
    /** 実行ごとにセッションIDを発行し、呼び出しを記録するspawner。resolveNextで1実行ずつ完了させる */
    function chainSpawner() {
      const calls: Array<{ instruction: string; resumeSessionId?: string }> = [];
      let pending: Array<(v: { text: string; sessionId?: string }) => void> = [];
      const spawner: TaskSpawner = ({ instruction, resumeSessionId, onEvent }) => {
        calls.push({ instruction, resumeSessionId });
        const sessionId = `sess-${calls.length}`;
        onEvent({ kind: "session", sessionId });
        return new Promise((res) => pending.push((v) => res({ ...v, sessionId })));
      };
      const resolveNext = (text: string) => {
        const res = pending.shift();
        if (res) res({ text });
      };
      return { calls, spawner, resolveNext };
    }

    it("queues a follow-up and resumes the same session after the current run finishes", async () => {
      const { calls, spawner, resolveNext } = chainSpawner();
      const tm = new TaskManager(spawner);
      const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "step 1" });
      expect(tm.appendInstruction(task.id, "追加でこれもやって")).toBe(true);
      // 現在の実行が終わるまでは1回しか起動していない
      expect(calls.length).toBe(1);

      resolveNext("first done");
      await tick();
      // 追加指示の消化中はタスクはrunningのまま
      expect(tm.get(task.id)!.status).toBe("running");
      expect(calls.length).toBe(2);
      expect(calls[1].resumeSessionId).toBe("sess-1");
      expect(calls[1].instruction.startsWith("追加でこれもやって")).toBe(true);

      resolveNext("second done");
      await tick();
      const done = tm.get(task.id)!;
      expect(done.status).toBe("succeeded");
      expect(done.result).toBe("second done");
    });

    it("drains multiple queued instructions in order", async () => {
      const { calls, spawner, resolveNext } = chainSpawner();
      const tm = new TaskManager(spawner);
      const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "step 1" });
      tm.appendInstruction(task.id, "step 2");
      tm.appendInstruction(task.id, "step 3");
      resolveNext("r1");
      await tick();
      resolveNext("r2");
      await tick();
      resolveNext("r3");
      await tick();
      expect(calls.map((c) => c.instruction.split("\n")[0])).toEqual(["step 1", "step 2", "step 3"]);
      // 各追加実行は直前の実行のセッションを引き継ぐ
      expect(calls[1].resumeSessionId).toBe("sess-1");
      expect(calls[2].resumeSessionId).toBe("sess-2");
      expect(tm.get(task.id)!.status).toBe("succeeded");
      expect(tm.get(task.id)!.result).toBe("r3");
    });

    it("returns false for unknown or finished tasks", async () => {
      const tm = new TaskManager(async () => ({ text: "ok" }));
      const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
      await tick();
      expect(tm.appendInstruction(task.id, "too late")).toBe(false);
      expect(tm.appendInstruction("nope", "x")).toBe(false);
    });

    it("records an instruction event so the UI can show it", async () => {
      const { spawner, resolveNext } = chainSpawner();
      const tm = new TaskManager(spawner);
      const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
      tm.appendInstruction(task.id, "ログも確認して");
      expect(
        task.events.some((e) => e.kind === "instruction" && e.text === "ログも確認して"),
      ).toBe(true);
      resolveNext("r1");
      await tick();
      resolveNext("r2");
      await tick();
    });

    it("does not run queued instructions after the task is cancelled", async () => {
      const { calls, spawner, resolveNext } = chainSpawner();
      const tm = new TaskManager(spawner);
      const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
      tm.appendInstruction(task.id, "追加指示");
      tm.cancel(task.id);
      // 実行中のspawnerがabort後に正常終了しても、キューは消化しない
      resolveNext("finished anyway");
      await tick();
      expect(calls.length).toBe(1);
      expect(tm.get(task.id)!.status).toBe("cancelled");
    });

    it("does not run queued instructions when the current run fails", async () => {
      let callCount = 0;
      const tm = new TaskManager(async () => {
        callCount++;
        throw new Error("boom");
      });
      const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
      tm.appendInstruction(task.id, "追加指示");
      await tick();
      expect(callCount).toBe(1);
      expect(tm.get(task.id)!.status).toBe("failed");
    });

    it("appends the report directive to follow-up instructions too", async () => {
      const { calls, spawner, resolveNext } = chainSpawner();
      const tm = new TaskManager(spawner);
      const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
      tm.appendInstruction(task.id, "続きの指示");
      resolveNext("r1");
      await tick();
      expect(calls[1].instruction).toContain("3文程度");
      resolveNext("r2");
      await tick();
      expect(tm.get(task.id)!.status).toBe("succeeded");
    });
  });

  describe("sequence numbers", () => {
    it("assigns 1-based creation-order sequence numbers", async () => {
      const tm = new TaskManager(async () => ({ text: "ok" }));
      const t1 = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "first" });
      const t2 = tm.start({ project: "b", projectPath: "/tmp/b", instruction: "second" });
      expect(t1.seq).toBe(1);
      expect(t2.seq).toBe(2);
    });

    it("keeps seq on listed tasks and sorts newest first", async () => {
      const tm = new TaskManager(async () => ({ text: "ok" }));
      tm.start({ project: "a", projectPath: "/tmp/a", instruction: "first" });
      tm.start({ project: "b", projectPath: "/tmp/b", instruction: "second" });
      expect(tm.list().map((t) => t.seq)).toEqual([2, 1]);
    });
  });

  describe("resolve", () => {
    it("resolves by exact task id", async () => {
      const tm = new TaskManager(async () => ({ text: "ok" }));
      const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
      expect(tm.resolve(task.id)?.id).toBe(task.id);
    });

    it("resolves by sequence number, with or without a leading #", async () => {
      const tm = new TaskManager(async () => ({ text: "ok" }));
      const t1 = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "first" });
      const t2 = tm.start({ project: "b", projectPath: "/tmp/b", instruction: "second" });
      expect(tm.resolve("1")?.id).toBe(t1.id);
      expect(tm.resolve("#2")?.id).toBe(t2.id);
      expect(tm.resolve(" 2 ")?.id).toBe(t2.id);
    });

    it("returns undefined for unknown references", async () => {
      const tm = new TaskManager(async () => ({ text: "ok" }));
      tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
      expect(tm.resolve("99")).toBeUndefined();
      expect(tm.resolve("nope")).toBeUndefined();
      expect(tm.resolve("")).toBeUndefined();
    });
  });

  describe("workspace (worktree分離)", () => {
    /** spawnerが受け取ったcwdを記録するspawner */
    function cwdSpawner() {
      const cwds: string[] = [];
      const spawner: TaskSpawner = async ({ cwd }) => {
        cwds.push(cwd);
        return { text: "ok", sessionId: "sess-1" };
      };
      return { cwds, spawner };
    }

    it("runs the spawner in the worktree provided by the workspace provider", async () => {
      const { cwds, spawner } = cwdSpawner();
      const tm = new TaskManager(spawner, undefined, async ({ project, taskId }) => ({
        kind: "worktree",
        worktreePath: `/wt/${project}-${taskId}`,
        branch: `task/${taskId}`,
      }));
      const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
      await tick();
      expect(cwds).toEqual([`/wt/demo-${task.id}`]);
      const done = tm.get(task.id)!;
      expect(done.worktreePath).toBe(`/wt/demo-${task.id}`);
      expect(done.branch).toBe(`task/${task.id}`);
      expect(done.worktreeNote).toBeUndefined();
      expect(done.status).toBe("succeeded");
    });

    it("runs in the project directory when the provider falls back silently (non-git)", async () => {
      const { cwds, spawner } = cwdSpawner();
      const tm = new TaskManager(spawner, undefined, async () => ({ kind: "project" }));
      const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
      await tick();
      expect(cwds).toEqual(["/tmp/demo"]);
      const done = tm.get(task.id)!;
      expect(done.worktreePath).toBeUndefined();
      expect(done.branch).toBeUndefined();
      expect(done.worktreeNote).toBeUndefined();
    });

    it("records the fallback reason when worktree creation fails, without failing the task", async () => {
      const { cwds, spawner } = cwdSpawner();
      const tm = new TaskManager(spawner, undefined, async () => ({
        kind: "project",
        reason: "fatal: not a valid ref",
      }));
      const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
      await tick();
      expect(cwds).toEqual(["/tmp/demo"]);
      const done = tm.get(task.id)!;
      expect(done.status).toBe("succeeded");
      expect(done.worktreeNote).toContain("fatal: not a valid ref");
      expect(done.worktreePath).toBeUndefined();
    });

    it("falls back to the project directory when the provider throws", async () => {
      const { cwds, spawner } = cwdSpawner();
      const tm = new TaskManager(spawner, undefined, async () => {
        throw new Error("provider crashed");
      });
      const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
      await tick();
      expect(cwds).toEqual(["/tmp/demo"]);
      const done = tm.get(task.id)!;
      expect(done.status).toBe("succeeded");
      expect(done.worktreeNote).toContain("provider crashed");
    });

    it("reuses the resumed task's workspace instead of creating a new worktree", async () => {
      const { cwds, spawner } = cwdSpawner();
      let providerCalls = 0;
      const tm = new TaskManager(spawner, undefined, async ({ taskId }) => {
        providerCalls++;
        return { kind: "worktree", worktreePath: `/wt/new-${taskId}`, branch: `task/${taskId}` };
      });
      const task = tm.start({
        project: "demo",
        projectPath: "/tmp/demo",
        instruction: "続き",
        resumeSessionId: "sess-prev",
        workspace: { worktreePath: "/wt/demo-orig1234", branch: "task/orig1234" },
      });
      await tick();
      // --resumeは同一cwdのセッションしか見えないため、元タスクのworktreeで実行する
      expect(providerCalls).toBe(0);
      expect(cwds).toEqual(["/wt/demo-orig1234"]);
      const done = tm.get(task.id)!;
      expect(done.worktreePath).toBe("/wt/demo-orig1234");
      expect(done.branch).toBe("task/orig1234");
    });

    it("resumes in the project directory when the source task had no worktree", async () => {
      const { cwds, spawner } = cwdSpawner();
      let providerCalls = 0;
      const tm = new TaskManager(spawner, undefined, async () => {
        providerCalls++;
        return { kind: "project" };
      });
      tm.start({
        project: "demo",
        projectPath: "/tmp/demo",
        instruction: "続き",
        resumeSessionId: "sess-prev",
        workspace: {},
      });
      await tick();
      expect(providerCalls).toBe(0);
      expect(cwds).toEqual(["/tmp/demo"]);
    });

    it("runs queued follow-up instructions in the same worktree", async () => {
      const cwds: string[] = [];
      let pending: Array<(v: { text: string; sessionId?: string }) => void> = [];
      const spawner: TaskSpawner = ({ cwd, onEvent }) => {
        cwds.push(cwd);
        onEvent({ kind: "session", sessionId: `sess-${cwds.length}` });
        return new Promise((res) => pending.push(res));
      };
      const tm = new TaskManager(spawner, undefined, async ({ taskId }) => ({
        kind: "worktree",
        worktreePath: `/wt/demo-${taskId}`,
        branch: `task/${taskId}`,
      }));
      const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
      await tick();
      tm.appendInstruction(task.id, "追加指示");
      pending.shift()!({ text: "r1", sessionId: "sess-1" });
      await tick();
      pending.shift()!({ text: "r2", sessionId: "sess-2" });
      await tick();
      expect(cwds).toEqual([`/wt/demo-${task.id}`, `/wt/demo-${task.id}`]);
      expect(tm.get(task.id)!.status).toBe("succeeded");
    });

    it("keeps the worktree info on the task after completion (no auto-cleanup)", async () => {
      const tm = new TaskManager(
        async () => ({ text: "ok" }),
        undefined,
        async ({ taskId }) => ({
          kind: "worktree",
          worktreePath: `/wt/demo-${taskId}`,
          branch: `task/${taskId}`,
        }),
      );
      const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
      await tick();
      const done = tm.get(task.id)!;
      expect(done.status).toBe("succeeded");
      expect(done.worktreePath).toBe(`/wt/demo-${task.id}`);
      expect(done.branch).toBe(`task/${task.id}`);
    });

    it("does not run the spawner when the task is cancelled while preparing the workspace", async () => {
      const { cwds, spawner } = cwdSpawner();
      const gate = deferred<void>();
      const tm = new TaskManager(spawner, undefined, async ({ taskId }) => {
        await gate.promise;
        return { kind: "worktree", worktreePath: `/wt/demo-${taskId}`, branch: `task/${taskId}` };
      });
      const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
      tm.cancel(task.id);
      gate.resolve();
      await tick();
      expect(cwds).toEqual([]);
      expect(tm.get(task.id)!.status).toBe("cancelled");
    });
  });

  it("caps stored events to avoid unbounded growth", async () => {
    const tm = new TaskManager(async ({ onEvent }) => {
      for (let i = 0; i < 500; i++) onEvent({ kind: "delta", text: `d${i}` });
      return { text: "ok" };
    });
    const task = tm.start({ project: "a", projectPath: "/tmp/a", instruction: "x" });
    await tick();
    expect(tm.get(task.id)!.events.length).toBeLessThanOrEqual(200);
  });
});
