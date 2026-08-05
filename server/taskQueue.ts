/**
 * タスク実行キューのスケジューリング(純粋関数)。
 *
 * タスクは作成時 "queued" で積まれ、同時実行数の上限に空きがある間だけ
 * "running" へ昇格する。緊急(urgent)タスクは通常(normal)より先に走り、
 * 同じ優先度内では作成順(seq)のFIFOで公平に処理する。
 */

export type QueuePriority = "urgent" | "normal";

export interface Schedulable {
  id: string;
  /** "queued"=順番待ち, "running"=実行中。それ以外(終了)はスロットを占有しない */
  status: string;
  priority: QueuePriority;
  /** 作成順の連番。同一優先度内のFIFO順序に使う */
  seq: number;
}

const rank = (p: QueuePriority): number => (p === "urgent" ? 0 : 1);

/**
 * 空きスロットに対して、次に "running" へ昇格すべき queued タスクの id を
 * 優先度順(urgent優先)＋FIFO順で返す。空きが無ければ空配列。
 */
export function selectToStart(tasks: Schedulable[], maxConcurrent: number): string[] {
  const limit = Math.max(1, Math.floor(maxConcurrent));
  const running = tasks.filter((t) => t.status === "running").length;
  const slots = limit - running;
  if (slots <= 0) return [];
  return tasks
    .filter((t) => t.status === "queued")
    .sort((a, b) => rank(a.priority) - rank(b.priority) || a.seq - b.seq)
    .slice(0, slots)
    .map((t) => t.id);
}

/** 待機中(queued)タスク数。UIの「順番待ち」表示用。 */
export function queuedCount(tasks: Schedulable[]): number {
  return tasks.filter((t) => t.status === "queued").length;
}
