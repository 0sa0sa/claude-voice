import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { AppDeps } from "./app.js";
import { TaskManager } from "./taskManager.js";
import { MAIN_THREAD_ID, ThreadLog } from "./threadLog.js";
import type { ChatRunner, QuickAsk } from "./types.js";

/** スレッド取得APIのテスト。メイン会話とタスク別スレッドの分離を検証する */

const PROJECTS = [{ name: "demo", hasGit: true, hasPackageJson: true, updatedAt: 1_700_000_000_000 }];

const quickAskNone: QuickAsk = async () => "NONE";

function echoRunner(replyText = "了解です"): ChatRunner {
  return {
    mode: "mock",
    async run({ resumeSessionId, onEvent }) {
      const sessionId = resumeSessionId ?? "sess-1";
      onEvent({ kind: "session", sessionId });
      onEvent({ kind: "delta", text: replyText });
      return { sessionId, text: replyText };
    },
  };
}

function makeDeps(opts?: { runner?: ChatRunner }): AppDeps & { threadLog: ThreadLog } {
  return {
    runner: opts?.runner ?? echoRunner(),
    quickAsk: quickAskNone,
    taskManager: new TaskManager(async () => ({ text: "task done" })),
    threadLog: new ThreadLog(),
    listProjects: async () => PROJECTS,
    resolveProject: async (name) => (PROJECTS.some((p) => p.name === name) ? `/tmp/${name}` : null),
  };
}

function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("threads API", () => {
  it("records the one-on-one chat into the main thread, separate from tasks", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    await (await post(app, "/api/chat", { message: "こんにちは" })).text();

    const res = await app.request(`/api/threads/${MAIN_THREAD_ID}`);
    expect(res.status).toBe(200);
    const thread = (await res.json()) as any;
    expect(thread.kind).toBe("main");
    expect(thread.messages.map((m: any) => [m.role, m.kind, m.text])).toEqual([
      ["user", "chat", "こんにちは"],
      ["assistant", "chat", "了解です"],
    ]);
  });

  it("exposes each task as its own thread with instruction and result", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const created = (await (await post(app, "/api/tasks", { project: "demo", instruction: "テスト直して" })).json()) as any;
    await vi.waitFor(() => {
      expect(deps.taskManager.get(created.id)?.status).toBe("succeeded");
    });

    const res = await app.request(`/api/threads/${created.id}`);
    expect(res.status).toBe(200);
    const thread = (await res.json()) as any;
    expect(thread.kind).toBe("task");
    expect(thread.taskId).toBe(created.id);
    expect(thread.messages.map((m: any) => [m.role, m.kind, m.text])).toEqual([
      ["user", "instruction", "テスト直して"],
      ["assistant", "result", "task done"],
    ]);
  });

  it("resolves a task thread by seq reference (#1) like the tasks API", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const created = (await (await post(app, "/api/tasks", { project: "demo", instruction: "x" })).json()) as any;
    const res = await app.request("/api/threads/%231");
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).taskId).toBe(created.id);
  });

  it("lists the main thread and task threads with summaries", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    await (await post(app, "/api/chat", { message: "こんにちは" })).text();
    const created = (await (await post(app, "/api/tasks", { project: "demo", instruction: "作業して" })).json()) as any;
    await vi.waitFor(() => {
      expect(deps.taskManager.get(created.id)?.status).toBe("succeeded");
    });

    const res = await app.request("/api/threads");
    const { threads } = (await res.json()) as any;
    expect(threads.map((t: any) => t.id)).toEqual([MAIN_THREAD_ID, created.id]);
    const taskThread = threads[1];
    expect(taskThread.project).toBe("demo");
    expect(taskThread.seq).toBe(1);
    expect(taskThread.messageCount).toBe(2);
    expect(taskThread.lastMessage.kind).toBe("result");
    // 一覧はサマリのみで全メッセージは含めない
    expect(taskThread.messages).toBeUndefined();
  });

  it("returns 404 for an unknown thread", async () => {
    const app = createApp(makeDeps());
    expect((await app.request("/api/threads/nope")).status).toBe(404);
  });

  it("keeps the chat endpoint behavior unchanged when no thread log is configured", async () => {
    const deps: AppDeps = { ...makeDeps(), threadLog: undefined };
    const app = createApp(deps);
    const chat = await post(app, "/api/chat", { message: "こんにちは" });
    expect(chat.status).toBe(200);
    expect(await chat.text()).toContain("了解です");
    expect((await app.request("/api/threads")).status).toBe(404);
  });
});
