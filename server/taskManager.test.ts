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
