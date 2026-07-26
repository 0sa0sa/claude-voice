import { randomUUID } from "node:crypto";

export interface TaskEvent {
  kind: "delta" | "tool" | "error";
  text: string;
  at: number;
}

export type TaskStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface Task {
  id: string;
  project: string;
  instruction: string;
  status: TaskStatus;
  events: TaskEvent[];
  result?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface TaskSpawnerEvent {
  kind: "delta" | "tool" | "error";
  text?: string;
  name?: string;
}

export type TaskSpawner = (opts: {
  instruction: string;
  cwd: string;
  onEvent: (e: TaskSpawnerEvent) => void;
  signal: AbortSignal;
}) => Promise<{ text: string }>;

const MAX_EVENTS = 200;

/** Background jobs: each task is one tool-enabled Claude Code run in a project cwd. */
export class TaskManager {
  private tasks = new Map<string, Task>();
  private aborts = new Map<string, AbortController>();
  private seq = new Map<string, number>();
  private counter = 0;

  constructor(private spawner: TaskSpawner) {}

  start(opts: { project: string; projectPath: string; instruction: string }): Task {
    const task: Task = {
      id: randomUUID().slice(0, 8),
      project: opts.project,
      instruction: opts.instruction,
      status: "running",
      events: [],
      startedAt: Date.now(),
    };
    this.tasks.set(task.id, task);
    this.seq.set(task.id, ++this.counter);
    const abort = new AbortController();
    this.aborts.set(task.id, abort);

    const pushEvent = (e: TaskSpawnerEvent) => {
      task.events.push({ kind: e.kind, text: e.name ?? e.text ?? "", at: Date.now() });
      if (task.events.length > MAX_EVENTS) task.events.splice(0, task.events.length - MAX_EVENTS);
    };

    void this.spawner({
      instruction: opts.instruction,
      cwd: opts.projectPath,
      onEvent: pushEvent,
      signal: abort.signal,
    })
      .then(({ text }) => {
        if (task.status !== "cancelled") {
          task.status = "succeeded";
          task.result = text;
        }
      })
      .catch((err) => {
        if (task.status !== "cancelled") {
          task.status = "failed";
          task.error = err instanceof Error ? err.message : String(err);
        }
      })
      .finally(() => {
        task.endedAt = Date.now();
        this.aborts.delete(task.id);
      });

    return task;
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  list(): Task[] {
    return [...this.tasks.values()].sort(
      (a, b) => (this.seq.get(b.id) ?? 0) - (this.seq.get(a.id) ?? 0),
    );
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    const abort = this.aborts.get(id);
    if (!task || !abort || task.status !== "running") return false;
    task.status = "cancelled";
    abort.abort();
    return true;
  }
}
