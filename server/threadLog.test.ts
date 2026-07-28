import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConversationThread, ThreadTaskSource } from "./threadLog.js";
import { MAIN_THREAD_ID, ThreadLog, ThreadStore } from "./threadLog.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cv-threads-"));
  path = join(dir, "nested", "threads.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeThread(overrides: Partial<ConversationThread> = {}): ConversationThread {
  return {
    id: "main",
    kind: "main",
    messages: [{ role: "user", kind: "chat", text: "こんにちは", at: 1000 }],
    ...overrides,
  };
}

describe("ThreadStore", () => {
  it("returns an empty list when the file does not exist", async () => {
    const store = new ThreadStore(path);
    expect(await store.load()).toEqual([]);
  });

  it("persists saved threads across instances, preserving order", async () => {
    const store = new ThreadStore(path);
    const threads = [
      makeThread(),
      makeThread({ id: "task1234", kind: "task", taskId: "task1234", project: "demo", seq: 1 }),
    ];
    await store.save(threads);
    expect(await new ThreadStore(path).load()).toEqual(threads);
  });

  it("returns an empty list when the file is corrupt", async () => {
    const store = new ThreadStore(path);
    await store.save([makeThread()]);
    await writeFile(path, "{broken json", "utf8");
    expect(await new ThreadStore(path).load()).toEqual([]);
  });

  it("drops entries that are not thread-shaped instead of failing the whole load", async () => {
    const store = new ThreadStore(path);
    await store.save([makeThread()]);
    await writeFile(
      path,
      JSON.stringify({ threads: [makeThread(), { garbage: true }, "nope"] }),
      "utf8",
    );
    expect(await new ThreadStore(path).load()).toEqual([makeThread()]);
  });

  it("serializes overlapping saves so the file always holds the last snapshot", async () => {
    const store = new ThreadStore(path);
    await Promise.all([
      store.save([makeThread({ id: "aaaa" })]),
      store.save([makeThread({ id: "bbbb" })]),
      store.save([makeThread({ id: "cccc" })]),
    ]);
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.threads.map((t: ConversationThread) => t.id)).toEqual(["cccc"]);
  });
});

function makeTask(overrides: Partial<ThreadTaskSource> = {}): ThreadTaskSource {
  return {
    id: "abc12345",
    seq: 1,
    project: "demo",
    instruction: "run tests",
    status: "succeeded",
    startedAt: 1000,
    endedAt: 5000,
    events: [],
    result: "all green",
    ...overrides,
  };
}

describe("ThreadLog", () => {
  it("records main-conversation messages in a dedicated main thread", () => {
    const log = new ThreadLog();
    log.appendMain("user", "こんにちは", 1000);
    log.appendMain("assistant", "了解です", 2000);
    const main = log.get(MAIN_THREAD_ID);
    expect(main?.kind).toBe("main");
    expect(main?.messages).toEqual([
      { role: "user", kind: "chat", text: "こんにちは", at: 1000 },
      { role: "assistant", kind: "chat", text: "了解です", at: 2000 },
    ]);
  });

  it("projects a task into its own thread: instruction, appended, result in time order", () => {
    const log = new ThreadLog();
    log.syncFromTasks([
      makeTask({
        events: [
          { kind: "tool", text: "Bash", at: 1500 },
          { kind: "instruction", text: "テストも直して", at: 2000 },
        ],
      }),
    ]);
    const thread = log.get("abc12345");
    expect(thread?.kind).toBe("task");
    expect(thread?.taskId).toBe("abc12345");
    expect(thread?.project).toBe("demo");
    expect(thread?.seq).toBe(1);
    expect(thread?.messages).toEqual([
      { role: "user", kind: "instruction", text: "run tests", at: 1000 },
      { role: "user", kind: "appended", text: "テストも直して", at: 2000 },
      { role: "assistant", kind: "result", text: "all green", at: 5000 },
    ]);
  });

  it("projects a failed task's error as an assistant message", () => {
    const log = new ThreadLog();
    log.syncFromTasks([
      makeTask({ status: "failed", result: undefined, error: "boom", endedAt: 3000 }),
    ]);
    expect(log.get("abc12345")?.messages).toEqual([
      { role: "user", kind: "instruction", text: "run tests", at: 1000 },
      { role: "assistant", kind: "error", text: "boom", at: 3000 },
    ]);
  });

  it("keeps a running task's thread result-free until it finishes, then adds it (no duplicates)", () => {
    const log = new ThreadLog();
    const running = makeTask({ status: "running", result: undefined, endedAt: undefined });
    log.syncFromTasks([running]);
    expect(log.get("abc12345")?.messages).toEqual([
      { role: "user", kind: "instruction", text: "run tests", at: 1000 },
    ]);
    log.syncFromTasks([makeTask()]);
    log.syncFromTasks([makeTask()]);
    expect(log.get("abc12345")?.messages).toEqual([
      { role: "user", kind: "instruction", text: "run tests", at: 1000 },
      { role: "assistant", kind: "result", text: "all green", at: 5000 },
    ]);
  });

  it("preserves chat-kind messages added to a task thread across syncs (将来のスレッド別UI用)", () => {
    const log = new ThreadLog();
    log.syncFromTasks([makeTask()]);
    log.appendToTask("abc12345", "user", "進捗どう?", 6000);
    log.syncFromTasks([makeTask()]);
    expect(log.get("abc12345")?.messages.at(-1)).toEqual({
      role: "user",
      kind: "chat",
      text: "進捗どう?",
      at: 6000,
    });
  });

  it("lists the main thread first, then task threads newest-first by seq", () => {
    const log = new ThreadLog();
    log.syncFromTasks([makeTask({ id: "t1", seq: 1 }), makeTask({ id: "t2", seq: 2 })]);
    log.appendMain("user", "hi", 1);
    expect(log.list().map((t) => t.id)).toEqual([MAIN_THREAD_ID, "t2", "t1"]);
  });

  it("returns undefined for an unknown thread id", () => {
    expect(new ThreadLog().get("nope")).toBeUndefined();
  });

  it("persists changes and restores them into a fresh instance", async () => {
    const store = new ThreadStore(path);
    const log = new ThreadLog(store);
    log.appendMain("user", "こんにちは", 1000);
    log.syncFromTasks([makeTask()]);
    await log.flush();

    const reloaded = new ThreadLog(new ThreadStore(path));
    await reloaded.restore();
    expect(reloaded.get(MAIN_THREAD_ID)?.messages).toHaveLength(1);
    expect(reloaded.get("abc12345")?.messages).toHaveLength(2);
  });

  it("skips redundant writes when a sync changes nothing", async () => {
    let saves = 0;
    const countingStore = {
      load: async () => [],
      save: async () => {
        saves += 1;
      },
    };
    const log = new ThreadLog(countingStore);
    log.syncFromTasks([makeTask()]);
    await log.flush();
    const after = saves;
    log.syncFromTasks([makeTask()]);
    await log.flush();
    expect(saves).toBe(after);
  });
});
