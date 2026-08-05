/** タスク一覧の表示用グループ分け: 実行中を上部に固定し、それぞれ新しい順に並べる */

export interface DisplayableTask {
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number | null;
}

/** プロジェクト初出順を保ったまま、タスクをプロジェクトごとの配列にまとめる */
export function groupByProject<T extends { project: string }>(
  tasks: T[],
): Array<{ project: string; tasks: T[] }> {
  const groups = new Map<string, T[]>();
  for (const t of tasks) {
    const list = groups.get(t.project);
    if (list) list.push(t);
    else groups.set(t.project, [t]);
  }
  return [...groups.entries()].map(([project, list]) => ({ project, tasks: list }));
}

export function splitTasks<T extends DisplayableTask>(
  tasks: T[],
): { running: T[]; finished: T[] } {
  const running = tasks
    .filter((t) => t.status === "running")
    .sort((a, b) => b.startedAt - a.startedAt);
  const finished = tasks
    .filter((t) => t.status !== "running")
    .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
  return { running, finished };
}
