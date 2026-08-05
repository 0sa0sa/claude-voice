import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Task } from "./taskManager.js";
import { TaskStore } from "./taskStore.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cv-tasks-"));
  path = join(dir, "nested", "tasks.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "abc12345",
    seq: 1,
    project: "demo",
    instruction: "run tests",
    status: "succeeded",
    events: [{ kind: "delta", text: "working", at: 1000 }],
    result: "done",
    startedAt: 1000,
    endedAt: 2000,
    ...overrides,
  };
}

describe("TaskStore", () => {
  it("returns an empty list when the file does not exist", async () => {
    const store = new TaskStore(path);
    expect(await store.load()).toEqual([]);
  });

  it("persists saved tasks across instances, preserving order", async () => {
    const store = new TaskStore(path);
    const tasks = [makeTask({ id: "second00" }), makeTask({ id: "first000" })];
    await store.save(tasks);
    const reloaded = new TaskStore(path);
    expect(await reloaded.load()).toEqual(tasks);
  });

  it("writes valid JSON to the file", async () => {
    const store = new TaskStore(path);
    await store.save([makeTask()]);
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.tasks[0].id).toBe("abc12345");
  });

  it("returns an empty list when the file is corrupt", async () => {
    const store = new TaskStore(path);
    await store.save([makeTask()]);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{broken json", "utf8");
    expect(await new TaskStore(path).load()).toEqual([]);
  });

  it("drops entries that are not task-shaped instead of failing the whole load", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dir, "nested"), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({ tasks: [makeTask(), { garbage: true }, "nope"] }),
      "utf8",
    );
    const loaded = await new TaskStore(path).load();
    expect(loaded).toEqual([makeTask()]);
  });

  it("serializes overlapping saves so the file always holds the last snapshot", async () => {
    const store = new TaskStore(path);
    await Promise.all([
      store.save([makeTask({ id: "aaaaaaaa" })]),
      store.save([makeTask({ id: "bbbbbbbb" })]),
      store.save([makeTask({ id: "cccccccc" })]),
    ]);
    const loaded = await new TaskStore(path).load();
    expect(loaded.map((t) => t.id)).toEqual(["cccccccc"]);
  });
});
