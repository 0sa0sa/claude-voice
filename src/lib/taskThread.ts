/**
 * タスクスレッド: 追いタスク(resume)の連鎖を1本の履歴として扱うための収集と、
 * 指示・追加指示・結果を時系列に並べたタイムラインの構築。
 */

export interface ThreadTaskLike {
  id: string;
  seq: number;
  instruction: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number | null;
  result: string | null;
  error: string | null;
  sessionId: string | null;
  resumedFrom: string | null;
}

export interface ThreadEventLike {
  kind: string;
  text: string;
  at: number;
}

export interface ThreadEntry {
  kind: "instruction" | "appended" | "result" | "error";
  taskId: string;
  seq: number;
  text: string;
  at: number;
}

export function collectThreadTasks<T extends ThreadTaskLike>(tasks: T[], id: string): T[] {
  const focus = tasks.find((t) => t.id === id);
  if (!focus) return [];

  const bySession = new Map<string, T>();
  for (const t of tasks) if (t.sessionId) bySession.set(t.sessionId, t);

  // 根まで遡る。セッション参照が壊れて循環していても止まるようvisitedで守る
  const visited = new Set<string>([focus.id]);
  let root = focus;
  for (;;) {
    const parent = root.resumedFrom ? bySession.get(root.resumedFrom) : undefined;
    if (!parent || visited.has(parent.id)) break;
    visited.add(parent.id);
    root = parent;
  }

  // 根から子孫を全て集める(1タスクから複数の追いタスクが分岐することもある)
  const thread = new Set<T>([root]);
  for (;;) {
    let grew = false;
    for (const t of tasks) {
      if (thread.has(t) || !t.resumedFrom) continue;
      const parent = bySession.get(t.resumedFrom);
      if (parent && thread.has(parent)) {
        thread.add(t);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return [...thread].sort((a, b) => a.startedAt - b.startedAt);
}

export function buildThreadTimeline<T extends ThreadTaskLike>(
  threadTasks: T[],
  eventsByTaskId?: ReadonlyMap<string, ThreadEventLike[]>,
): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  for (const t of threadTasks) {
    entries.push({ kind: "instruction", taskId: t.id, seq: t.seq, text: t.instruction, at: t.startedAt });
    for (const e of eventsByTaskId?.get(t.id) ?? []) {
      if (e.kind === "instruction") {
        entries.push({ kind: "appended", taskId: t.id, seq: t.seq, text: e.text, at: e.at });
      }
    }
    if (t.status === "succeeded" && t.result) {
      entries.push({ kind: "result", taskId: t.id, seq: t.seq, text: t.result, at: t.endedAt ?? t.startedAt });
    } else if (t.status === "failed" && t.error) {
      entries.push({ kind: "error", taskId: t.id, seq: t.seq, text: t.error, at: t.endedAt ?? t.startedAt });
    }
  }
  // Array.prototype.sortは安定なので、同時刻は挿入順(指示→追加指示→結果)を保つ
  return entries.sort((a, b) => a.at - b.at);
}
