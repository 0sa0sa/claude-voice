import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * 会話ログのスレッド分離: ユーザーとのメイン会話(一対一)と、タスクごとの
 * やり取り(指示出し・追加指示・進捗報告)をタスクIDに紐付く別スレッドとして
 * 保存・取得する。永続化は ~/.claude-voice/threads.json(taskStore.tsと同じ流儀)。
 * kindの語彙(instruction/appended/result/error)は src/lib/taskThread.ts の
 * タイムラインと揃えてあり、スレッド別表示のUIを後から足すときに再利用できる。
 */

export interface ThreadMessage {
  role: "user" | "assistant";
  /** chat: 自由会話, instruction: タスク開始指示, appended: 追加指示, result/error: 完了報告 */
  kind: "chat" | "instruction" | "appended" | "result" | "error";
  text: string;
  at: number;
}

export interface ConversationThread {
  /** メインスレッドは MAIN_THREAD_ID、タスクスレッドはタスクID */
  id: string;
  kind: "main" | "task";
  taskId?: string;
  project?: string;
  seq?: number;
  messages: ThreadMessage[];
}

function isThread(t: unknown): t is ConversationThread {
  const thread = t as ConversationThread;
  return (
    typeof thread === "object" &&
    thread !== null &&
    typeof thread.id === "string" &&
    (thread.kind === "main" || thread.kind === "task") &&
    Array.isArray(thread.messages)
  );
}

export const MAIN_THREAD_ID = "main";

/**
 * タスクスレッドの射影元。taskManager.tsのTaskと構造互換だが、タスク基盤に
 * 依存しないよう(taskThread.tsのThreadTaskLikeと同じ流儀で)必要な形だけを持つ。
 */
export interface ThreadTaskSource {
  id: string;
  seq: number;
  project: string;
  instruction: string;
  status: string;
  startedAt: number;
  endedAt?: number;
  events?: { kind: string; text: string; at: number }[];
  result?: string;
  error?: string;
}

interface ThreadStorage {
  load(): Promise<ConversationThread[]>;
  save(threads: ConversationThread[]): Promise<void>;
}

/**
 * スレッドの保持と永続化。メイン会話はappendMainで追記し、タスクスレッドは
 * タスクデータ(唯一の真実)からsyncFromTasksで導出する。タスク基盤側には
 * フックを持たないため、進捗はsyncを呼んだ時点の内容が反映される。
 */
export class ThreadLog {
  private threads = new Map<string, ConversationThread>();
  private lastSave: Promise<void> = Promise.resolve();
  // 直近に保存した内容。取得APIのたびに呼ばれるsyncが無変更でも書き込まないための比較用
  private lastSnapshot = "";

  constructor(private store?: ThreadStorage) {}

  /** 変更があったときだけ全件スナップショットを保存する。失敗しても呼び出し元は止めない */
  private persist(): void {
    if (!this.store) return;
    const threads = this.list();
    const snapshot = JSON.stringify(threads);
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    this.lastSave = this.store.save(threads).catch((err) => {
      console.error("thread log save failed:", err);
    });
  }

  /** 直近の保存の完了を待つ(テスト・シャットダウン用) */
  async flush(): Promise<void> {
    await this.lastSave;
  }

  /** サーバー起動時に保存済みスレッドを復元する */
  async restore(): Promise<void> {
    if (!this.store) return;
    for (const thread of await this.store.load()) {
      if (!this.threads.has(thread.id)) this.threads.set(thread.id, thread);
    }
    this.lastSnapshot = JSON.stringify(this.list());
  }

  private appendChat(thread: ConversationThread, role: ThreadMessage["role"], text: string, at: number) {
    thread.messages.push({ role, kind: "chat", text, at });
    this.persist();
  }

  /** メイン会話(一対一チャット)への追記 */
  appendMain(role: ThreadMessage["role"], text: string, at: number): void {
    let main = this.threads.get(MAIN_THREAD_ID);
    if (!main) {
      main = { id: MAIN_THREAD_ID, kind: "main", messages: [] };
      this.threads.set(MAIN_THREAD_ID, main);
    }
    this.appendChat(main, role, text, at);
  }

  /** タスクスレッドへの自由メッセージの追記(スレッド別UIを後から足すための口)。 */
  appendToTask(taskId: string, role: ThreadMessage["role"], text: string, at: number): boolean {
    const thread = this.threads.get(taskId);
    if (!thread || thread.kind !== "task") return false;
    this.appendChat(thread, role, text, at);
    return true;
  }

  /**
   * タスク一覧からタスクスレッドを導出して上書きする(冪等)。射影規則は
   * src/lib/taskThread.tsのbuildThreadTimelineと同じ: 指示→追加指示→結果/エラー。
   * appendToTaskで足されたchatメッセージだけは導出対象外なので保持する。
   */
  syncFromTasks(tasks: ThreadTaskSource[]): void {
    for (const task of tasks) {
      const messages: ThreadMessage[] = [
        { role: "user", kind: "instruction", text: task.instruction, at: task.startedAt },
      ];
      for (const e of task.events ?? []) {
        if (e.kind === "instruction") {
          messages.push({ role: "user", kind: "appended", text: e.text, at: e.at });
        }
      }
      if (task.status === "succeeded" && task.result) {
        messages.push({ role: "assistant", kind: "result", text: task.result, at: task.endedAt ?? task.startedAt });
      } else if (task.status === "failed" && task.error) {
        messages.push({ role: "assistant", kind: "error", text: task.error, at: task.endedAt ?? task.startedAt });
      }
      const kept = this.threads.get(task.id)?.messages.filter((m) => m.kind === "chat") ?? [];
      messages.push(...kept);
      // sortは安定なので、同時刻は導出順(指示→追加指示→結果)を保つ
      messages.sort((a, b) => a.at - b.at);
      this.threads.set(task.id, {
        id: task.id,
        kind: "task",
        taskId: task.id,
        project: task.project,
        seq: task.seq,
        messages,
      });
    }
    this.persist();
  }

  get(id: string): ConversationThread | undefined {
    return this.threads.get(id);
  }

  /** メインスレッドを先頭に、タスクスレッドを新しい順(seq降順)で返す */
  list(): ConversationThread[] {
    const all = [...this.threads.values()];
    const main = all.filter((t) => t.kind === "main");
    const tasks = all.filter((t) => t.kind === "task").sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
    return [...main, ...tasks];
  }
}

export class ThreadStore {
  // 保存要求を直列化するチェーン。並行saveでファイルが壊れないよう常に前の書き込みを待つ
  private chain: Promise<void> = Promise.resolve();

  constructor(private filePath: string) {}

  /** 保存済みスレッド。ファイルが無い・壊れているときは空を返す */
  async load(): Promise<ConversationThread[]> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!Array.isArray(raw.threads)) return [];
      return raw.threads.filter(isThread);
    } catch {
      return [];
    }
  }

  /** スレッド全件のスナップショットを永続化する(渡した順序を保持) */
  save(threads: ConversationThread[]): Promise<void> {
    const snapshot = JSON.stringify({ threads }, null, 2);
    this.chain = this.chain.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, snapshot, "utf8");
    });
    return this.chain;
  }
}
