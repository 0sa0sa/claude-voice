import { describe, expect, it } from "vitest";
import { queuedCount, selectToStart, type Schedulable } from "./taskQueue.js";

const t = (
  id: string,
  status: string,
  priority: "urgent" | "normal",
  seq: number,
): Schedulable => ({ id, status, priority, seq });

describe("selectToStart", () => {
  it("starts queued tasks up to the concurrency limit", () => {
    const tasks = [t("a", "queued", "normal", 1), t("b", "queued", "normal", 2), t("c", "queued", "normal", 3)];
    expect(selectToStart(tasks, 2)).toEqual(["a", "b"]);
  });

  it("counts running tasks against the limit", () => {
    const tasks = [t("r", "running", "normal", 1), t("a", "queued", "normal", 2), t("b", "queued", "normal", 3)];
    expect(selectToStart(tasks, 2)).toEqual(["a"]);
  });

  it("returns nothing when all slots are full", () => {
    const tasks = [t("r1", "running", "normal", 1), t("r2", "running", "normal", 2), t("a", "queued", "normal", 3)];
    expect(selectToStart(tasks, 2)).toEqual([]);
  });

  it("schedules urgent tasks before normal ones regardless of creation order", () => {
    const tasks = [
      t("old-normal", "queued", "normal", 1),
      t("new-urgent", "queued", "urgent", 5),
      t("mid-normal", "queued", "normal", 2),
    ];
    expect(selectToStart(tasks, 1)).toEqual(["new-urgent"]);
  });

  it("keeps FIFO order within the same priority", () => {
    const tasks = [
      t("u2", "queued", "urgent", 4),
      t("u1", "queued", "urgent", 2),
      t("n1", "queued", "normal", 1),
    ];
    expect(selectToStart(tasks, 3)).toEqual(["u1", "u2", "n1"]);
  });

  it("ignores finished tasks (they hold no slot)", () => {
    const tasks = [
      t("done", "succeeded", "normal", 1),
      t("fail", "failed", "normal", 2),
      t("a", "queued", "normal", 3),
    ];
    expect(selectToStart(tasks, 1)).toEqual(["a"]);
  });

  it("treats a limit below 1 as 1", () => {
    const tasks = [t("a", "queued", "normal", 1), t("b", "queued", "normal", 2)];
    expect(selectToStart(tasks, 0)).toEqual(["a"]);
  });
});

describe("queuedCount", () => {
  it("counts only queued tasks", () => {
    const tasks = [
      t("a", "queued", "normal", 1),
      t("b", "running", "normal", 2),
      t("c", "queued", "urgent", 3),
      t("d", "succeeded", "normal", 4),
    ];
    expect(queuedCount(tasks)).toBe(2);
  });
});
