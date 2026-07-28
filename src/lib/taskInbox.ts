/**
 * 受信箱(要対応)の判定: 結果が返ってきて(成功/失敗)、ユーザーがまだ
 * 確認(タップ/フォーカス)していないタスクを「要対応」として扱う。
 */

export interface ReviewableTaskLike {
  id: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number | null;
}

export function needsReview(task: ReviewableTaskLike, acked: ReadonlySet<string>): boolean {
  // 中止(cancelled)はユーザー自身の操作の結果なので確認対象にしない
  return (task.status === "succeeded" || task.status === "failed") && !acked.has(task.id);
}

export function reviewTasks<T extends ReviewableTaskLike>(
  tasks: T[],
  acked: ReadonlySet<string>,
): T[] {
  return tasks
    .filter((t) => needsReview(t, acked))
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
}

export function pruneAcked(acked: Iterable<string>, tasks: ReviewableTaskLike[]): string[] {
  const ids = new Set(tasks.map((t) => t.id));
  return [...acked].filter((id) => ids.has(id));
}
