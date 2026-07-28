import { describe, expect, it } from "vitest";
import { needsReview, pruneAcked, reviewTasks } from "./taskInbox";
import type { ReviewableTaskLike } from "./taskInbox";

function task(
  id: string,
  status: ReviewableTaskLike["status"],
  endedAt?: number,
): ReviewableTaskLike {
  return { id, status, startedAt: 100, endedAt: endedAt ?? null };
}

describe("needsReview", () => {
  it("完了(成功/失敗)かつ未確認のタスクだけが要対応になる", () => {
    const acked = new Set<string>();
    expect(needsReview(task("a", "succeeded"), acked)).toBe(true);
    expect(needsReview(task("b", "failed"), acked)).toBe(true);
    expect(needsReview(task("c", "running"), acked)).toBe(false);
    // 中止はユーザー自身の操作なので確認は不要
    expect(needsReview(task("d", "cancelled"), acked)).toBe(false);
  });

  it("確認済み(acked)のタスクは要対応にならない", () => {
    expect(needsReview(task("a", "succeeded"), new Set(["a"]))).toBe(false);
  });
});

describe("reviewTasks", () => {
  it("要対応タスクだけを新しい順に返す", () => {
    const tasks = [
      task("old", "succeeded", 1000),
      task("new", "failed", 3000),
      task("run", "running"),
      task("seen", "succeeded", 2000),
    ];
    expect(reviewTasks(tasks, new Set(["seen"])).map((t) => t.id)).toEqual(["new", "old"]);
  });
});

describe("pruneAcked", () => {
  it("タスク一覧に存在しないIDを落とす(localStorageの肥大化防止)", () => {
    const tasks = [task("a", "succeeded"), task("b", "running")];
    expect(pruneAcked(["a", "b", "gone"], tasks)).toEqual(["a", "b"]);
  });
});
