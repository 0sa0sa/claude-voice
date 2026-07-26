import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Task } from "./taskManager.js";

/**
 * タスク履歴のサーバー側永続化(dictionary.tsと同じ流儀)。
 * TaskManagerがタスクの作成・終了のたびに全件スナップショットを保存し、
 * サーバー起動時に読み込んで履歴を復元する。
 */

function isTask(t: unknown): t is Task {
  const task = t as Task;
  return (
    typeof task === "object" &&
    task !== null &&
    typeof task.id === "string" &&
    typeof task.project === "string" &&
    typeof task.instruction === "string" &&
    typeof task.status === "string" &&
    Array.isArray(task.events) &&
    typeof task.startedAt === "number"
  );
}

export class TaskStore {
  // 保存要求を直列化するチェーン。並行saveでファイルが壊れないよう常に前の書き込みを待つ
  private chain: Promise<void> = Promise.resolve();

  constructor(private filePath: string) {}

  /** 保存済みタスク。ファイルが無い・壊れているときは空を返す */
  async load(): Promise<Task[]> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!Array.isArray(raw.tasks)) return [];
      return raw.tasks.filter(isTask);
    } catch {
      return [];
    }
  }

  /** タスク全件のスナップショットを永続化する(渡した順序を保持) */
  save(tasks: Task[]): Promise<void> {
    const snapshot = JSON.stringify({ tasks }, null, 2);
    this.chain = this.chain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, snapshot, "utf8");
    });
    return this.chain;
  }
}
