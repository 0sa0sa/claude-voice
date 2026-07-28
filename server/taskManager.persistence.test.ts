import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskManager } from "./taskManager.js";
import type { Task } from "./taskManager.js";
import { TaskStore } from "./taskStore.js";

let dir: string;
let store: TaskStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cv-tm-persist-"));
  store = new TaskStore(join(dir, "tasks.json"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const tick = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function savedTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "saved001",
    seq: 1,
    project: "demo",
    instruction: "past work",
    status: "succeeded",
    events: [],
    result: "done",
    startedAt: 1000,
    endedAt: 2000,
    ...overrides,
  };
}

describe("TaskManager persistence", () => {
  it("saves the task to the store when it starts", async () => {
    const never = deferred<{ text: string }>();
    const tm = new TaskManager(async () => never.promise, store);
    const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "long job" });
    await tm.flush();
    const saved = await store.load();
    expect(saved.map((t) => t.id)).toEqual([task.id]);
    expect(saved[0].status).toBe("running");
  });

  it("saves the final state when the task succeeds", async () => {
    const tm = new TaskManager(async () => ({ text: "全部OK" }), store);
    const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
    await tick();
    await tm.flush();
    const saved = await store.load();
    expect(saved[0].id).toBe(task.id);
    expect(saved[0].status).toBe("succeeded");
    expect(saved[0].result).toBe("全部OK");
  });

  it("saves the final state when the task fails", async () => {
    const tm = new TaskManager(async () => {
      throw new Error("boom");
    }, store);
    tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
    await tick();
    await tm.flush();
    const saved = await store.load();
    expect(saved[0].status).toBe("failed");
    expect(saved[0].error).toContain("boom");
  });

  it("saves the cancelled state when the task is cancelled", async () => {
    const never = deferred<{ text: string }>();
    const tm = new TaskManager(async ({ signal }) => {
      signal.addEventListener("abort", () => never.reject(new Error("aborted")));
      return never.promise;
    }, store);
    const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
    tm.cancel(task.id);
    await tick();
    await tm.flush();
    const saved = await store.load();
    expect(saved[0].status).toBe("cancelled");
  });

  describe("restore", () => {
    it("loads saved history so it shows up in list() and get()", async () => {
      await store.save([savedTask()]);
      const tm = new TaskManager(async () => ({ text: "ok" }), store);
      await tm.restore();
      expect(tm.get("saved001")?.result).toBe("done");
      expect(tm.list().map((t) => t.id)).toEqual(["saved001"]);
    });

    it("marks tasks left running as failed because their process is gone", async () => {
      await store.save([savedTask({ id: "wasrun00", status: "running", endedAt: undefined })]);
      const tm = new TaskManager(async () => ({ text: "ok" }), store);
      await tm.restore();
      const task = tm.get("wasrun00")!;
      expect(task.status).toBe("failed");
      expect(task.error).toContain("再起動");
      expect(task.endedAt).toBeGreaterThan(0);
      // 補正後の状態はファイルにも書き戻される
      const saved = await store.load();
      expect(saved.find((t) => t.id === "wasrun00")?.status).toBe("failed");
    });

    it("keeps restored order and sorts newly started tasks first", async () => {
      // storeにはlist()と同じ新しい順で保存されている
      await store.save([
        savedTask({ id: "newer000", seq: 2, instruction: "newer" }),
        savedTask({ id: "older000", seq: 1, instruction: "older" }),
      ]);
      const tm = new TaskManager(async () => ({ text: "ok" }), store);
      await tm.restore();
      const fresh = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "now" });
      expect(tm.list().map((t) => t.id)).toEqual([fresh.id, "newer000", "older000"]);
      // 完了時の保存が一時ディレクトリ削除より後に走らないよう待ち切る
      await tick();
      await tm.flush();
    });

    it("assigns fresh seq numbers to tasks saved by an older format without seq", async () => {
      const legacy = { ...savedTask({ id: "legacy00" }) } as Partial<Task>;
      delete legacy.seq;
      await store.save([legacy as Task]);
      const tm = new TaskManager(async () => ({ text: "ok" }), store);
      await tm.restore();
      expect(tm.get("legacy00")?.seq).toBe(1);
      const fresh = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "now" });
      expect(fresh.seq).toBe(2);
      await tick();
      await tm.flush();
    });

    it("restored tasks cannot be cancelled or appended to", async () => {
      await store.save([savedTask({ id: "wasrun00", status: "running", endedAt: undefined })]);
      const tm = new TaskManager(async () => ({ text: "ok" }), store);
      await tm.restore();
      expect(tm.cancel("wasrun00")).toBe(false);
      expect(tm.appendInstruction("wasrun00", "more")).toBe(false);
    });
  });

  it("keeps worktree info across save and restore", async () => {
    await store.save([
      savedTask({
        worktreePath: "/wt/demo-saved001",
        branch: "task/saved001",
        worktreeNote: undefined,
      }),
    ]);
    const tm = new TaskManager(async () => ({ text: "ok" }), store);
    await tm.restore();
    const task = tm.get("saved001")!;
    expect(task.worktreePath).toBe("/wt/demo-saved001");
    expect(task.branch).toBe("task/saved001");
  });

  it("persists the reassigned project to the store", async () => {
    const tm = new TaskManager(async () => ({ text: "ok" }), store);
    const task = tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
    await tick();
    expect(tm.setProject(task.id, "hojokin-navi")).toBe(true);
    await tm.flush();
    const saved = await store.load();
    expect(saved[0].project).toBe("hojokin-navi");
  });

  it("works without a store (flush resolves, nothing persisted)", async () => {
    const tm = new TaskManager(async () => ({ text: "ok" }));
    tm.start({ project: "demo", projectPath: "/tmp/demo", instruction: "x" });
    await tick();
    await expect(tm.flush()).resolves.toBeUndefined();
  });
});
