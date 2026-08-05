/**
 * 追いタスク(フォローアップ)の選択対象になれるタスクの条件。
 * サーバーの resolveResume と同じ制約: 実行中は不可、セッションを残していないタスクも不可。
 */
export interface SelectableTaskLike {
  status: "running" | "succeeded" | "failed" | "cancelled";
  sessionId: string | null;
}

export function isSelectableTask(task: SelectableTaskLike): boolean {
  return task.status !== "running" && task.sessionId !== null;
}

/**
 * タスク参照(ID、または連番 "3" / "#3")からタスクを引く。
 * サーバーの TaskManager.resolve と同じ解決規則。
 */
export function resolveTaskReference<T extends { id: string; seq: number }>(
  tasks: T[],
  ref: string,
): T | undefined {
  const trimmed = ref.trim();
  const byId = tasks.find((t) => t.id === trimmed);
  if (byId) return byId;
  const num = /^#?(\d+)$/.exec(trimmed);
  if (!num) return undefined;
  const seq = Number(num[1]);
  return tasks.find((t) => t.seq === seq);
}
