import { randomUUID } from "node:crypto";
import type { TaskStore } from "./taskStore.js";

export interface TaskEvent {
  kind: "delta" | "tool" | "error" | "instruction";
  text: string;
  at: number;
}

export type TaskStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface Task {
  id: string;
  /** 人が言いやすい作成順の連番(1始まり)。音声・テキストでのタスク指定に使う。 */
  seq: number;
  project: string;
  instruction: string;
  status: TaskStatus;
  events: TaskEvent[];
  result?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
  /** Claude Code session id of this run — lets a later task resume this context. */
  sessionId?: string;
  /** Session id this task was resumed from, if any. */
  resumedFrom?: string;
  /** worktree分離で実行した場合の作業ディレクトリ。完了後も残す(マージは人間が判断) */
  worktreePath?: string;
  /** worktree分離で実行した場合のブランチ名 */
  branch?: string;
  /** worktree作成に失敗してプロジェクト直下で実行したときの記録 */
  worktreeNote?: string;
}

export type TaskSpawnerEvent =
  | { kind: "delta" | "tool" | "error"; text?: string; name?: string }
  | { kind: "session"; sessionId: string };

/** タスクの作業ディレクトリの決め方。worktree分離か、従来のプロジェクト直下か */
export type Workspace =
  | { kind: "worktree"; worktreePath: string; branch: string }
  | { kind: "project"; reason?: string };

export type WorkspaceProvider = (opts: {
  project: string;
  projectPath: string;
  taskId: string;
}) => Promise<Workspace>;

export type TaskSpawner = (opts: {
  instruction: string;
  cwd: string;
  resumeSessionId?: string;
  onEvent: (e: TaskSpawnerEvent) => void;
  signal: AbortSignal;
}) => Promise<{ text: string; sessionId?: string }>;

const MAX_EVENTS = 200;

/** 完了報告はTTSで読み上げるため、全タスク指示の末尾に付ける読み上げ向けの体裁指示。 */
export const REPORT_STYLE_DIRECTIVE =
  "最終的な完了報告は3文程度のプレーンテキストで簡潔に。" +
  "報告は音声で読み上げられるため、markdownの見出し・箇条書き・コードブロック・記号装飾は使わないこと。";

/** Background jobs: each task is one tool-enabled Claude Code run in a project cwd. */
export class TaskManager {
  private tasks = new Map<string, Task>();
  private aborts = new Map<string, AbortController>();
  // 実行中タスクへの追加指示キュー。CLIプロセスのstdinは起動時に閉じるため、
  // 現在の実行が終わり次第、同じセッションを--resumeで継いで消化する
  private pending = new Map<string, string[]>();
  private counter = 0;
  private lastSave: Promise<void> = Promise.resolve();

  constructor(
    private spawner: TaskSpawner,
    private store?: TaskStore,
    // 省略時はworktree分離なし(常にプロジェクト直下で実行)
    private workspaceProvider?: WorkspaceProvider,
  ) {}

  /** タスクの作成・終了のたびに全件を保存する。失敗してもタスク実行は止めない */
  private persist(): void {
    if (!this.store) return;
    this.lastSave = this.store.save(this.list()).catch((err) => {
      console.error("task history save failed:", err);
    });
  }

  /** 直近の保存の完了を待つ(テスト・シャットダウン用) */
  async flush(): Promise<void> {
    await this.lastSave;
  }

  /**
   * サーバー起動時に保存済み履歴を復元する。running のまま残っていたタスクは
   * プロセスが既に存在しないため failed に補正し、補正結果を書き戻す。
   */
  async restore(): Promise<void> {
    if (!this.store) return;
    const saved = await this.store.load();
    // ファイルはlist()と同じ新しい順なので、古い順に登録してseq順を保つ
    for (const task of [...saved].reverse()) {
      if (this.tasks.has(task.id)) continue;
      if (task.status === "running") {
        task.status = "failed";
        task.error = "サーバー再起動により中断されました";
        task.endedAt = task.endedAt ?? Date.now();
      }
      // 旧形式の保存ファイルにはseqが無いため、読み込み順(古い順)で補う
      if (typeof task.seq !== "number") task.seq = this.counter + 1;
      this.counter = Math.max(this.counter, task.seq);
      this.tasks.set(task.id, task);
    }
    this.persist();
    await this.flush();
  }

  start(opts: {
    project: string;
    projectPath: string;
    instruction: string;
    resumeSessionId?: string;
    /**
     * 引き継ぎ元タスクの作業ディレクトリ。--resumeは同一cwdのセッションしか
     * 見えないため、指定時は新しいworktreeを作らず元の場所で実行する。
     */
    workspace?: { worktreePath?: string; branch?: string };
  }): Task {
    const task: Task = {
      id: randomUUID().slice(0, 8),
      seq: ++this.counter,
      project: opts.project,
      instruction: opts.instruction,
      status: "running",
      events: [],
      startedAt: Date.now(),
      ...(opts.resumeSessionId ? { resumedFrom: opts.resumeSessionId } : {}),
    };
    this.tasks.set(task.id, task);
    this.pending.set(task.id, []);
    const abort = new AbortController();
    this.aborts.set(task.id, abort);
    this.persist();

    const pushEvent = (e: TaskSpawnerEvent) => {
      // session通知はイベントログには出さず、resume用にタスクへ記録するだけ
      if (e.kind === "session") {
        task.sessionId = e.sessionId;
        return;
      }
      this.pushTaskEvent(task, e.kind, e.name ?? e.text ?? "");
    };

    const runOnce = (instruction: string, cwd: string, resumeSessionId?: string) =>
      this.spawner({
        // 表示用のtask.instructionは元の指示のまま、実行時のみ報告体裁の指示を付ける
        instruction: `${instruction}\n\n${REPORT_STYLE_DIRECTIVE}`,
        cwd,
        resumeSessionId,
        onEvent: pushEvent,
        signal: abort.signal,
      });

    // 実行cwdを決める。resume時は元タスクの場所を再利用し(--resumeは同一cwdの
    // セッションしか見えない)、providerがある新規タスクのみ非同期でworktreeを
    // 用意する。それ以外は従来どおり同期でspawnerが起動する
    let cwd: string | Promise<string> = opts.projectPath;
    if (opts.resumeSessionId || opts.workspace) {
      if (opts.workspace?.worktreePath) {
        task.worktreePath = opts.workspace.worktreePath;
        task.branch = opts.workspace.branch;
        cwd = opts.workspace.worktreePath;
      }
    } else if (this.workspaceProvider) {
      cwd = this.prepareWorkspace(task, opts.project, opts.projectPath);
    }

    const runLoop = async () => {
      try {
        const resolvedCwd = typeof cwd === "string" ? cwd : await cwd;
        if ((task.status as TaskStatus) !== "running") return;
        let { text, sessionId } = await runOnce(opts.instruction, resolvedCwd, opts.resumeSessionId);
        if (sessionId) task.sessionId = sessionId;
        // 追加指示が積まれていれば、同じセッションを引き継いで順に消化する
        for (;;) {
          if (task.status !== "running") return;
          const next = this.pending.get(task.id)?.shift();
          if (next === undefined) break;
          ({ text, sessionId } = await runOnce(next, resolvedCwd, task.sessionId));
          if (sessionId) task.sessionId = sessionId;
        }
        task.status = "succeeded";
        task.result = text;
      } catch (err) {
        if (task.status !== "cancelled") {
          task.status = "failed";
          task.error = err instanceof Error ? err.message : String(err);
        }
      } finally {
        task.endedAt = Date.now();
        this.aborts.delete(task.id);
        this.pending.delete(task.id);
        this.persist();
      }
    };
    void runLoop();

    return task;
  }

  /**
   * providerでworktreeを用意し、実行cwdを返す。失敗してもタスクは止めず、
   * 理由をworktreeNoteに記録してプロジェクト直下にフォールバックする。
   */
  private async prepareWorkspace(task: Task, project: string, projectPath: string): Promise<string> {
    try {
      const ws = await this.workspaceProvider!({ project, projectPath, taskId: task.id });
      if (ws.kind === "worktree") {
        task.worktreePath = ws.worktreePath;
        task.branch = ws.branch;
        this.persist();
        return ws.worktreePath;
      }
      if (ws.reason) {
        task.worktreeNote = `worktree作成に失敗、プロジェクト直下で実行: ${ws.reason}`;
        this.persist();
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      task.worktreeNote = `worktree作成に失敗、プロジェクト直下で実行: ${reason}`;
      this.persist();
    }
    return projectPath;
  }

  private pushTaskEvent(task: Task, kind: TaskEvent["kind"], text: string) {
    task.events.push({ kind, text, at: Date.now() });
    if (task.events.length > MAX_EVENTS) task.events.splice(0, task.events.length - MAX_EVENTS);
  }

  /**
   * Queues a follow-up instruction for a running task. It runs after the
   * current spawner run completes, resuming the same Claude session.
   */
  appendInstruction(id: string, text: string): boolean {
    const task = this.tasks.get(id);
    const queue = this.pending.get(id);
    if (!task || !queue || task.status !== "running") return false;
    queue.push(text);
    this.pushTaskEvent(task, "instruction", text);
    return true;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  /** タスク参照(ID、または連番 "3" / "#3")からタスクを引く。 */
  resolve(ref: string): Task | undefined {
    const trimmed = ref.trim();
    const byId = this.tasks.get(trimmed);
    if (byId) return byId;
    const num = /^#?(\d+)$/.exec(trimmed);
    if (!num) return undefined;
    const seq = Number(num[1]);
    for (const task of this.tasks.values()) if (task.seq === seq) return task;
    return undefined;
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.seq - a.seq);
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    const abort = this.aborts.get(id);
    if (!task || !abort || task.status !== "running") return false;
    task.status = "cancelled";
    abort.abort();
    this.persist();
    return true;
  }
}
