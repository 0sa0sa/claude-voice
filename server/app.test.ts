import { describe, expect, it } from "vitest";
import { buildChatPrompt, createApp } from "./app.js";
import type { AppDeps } from "./app.js";
import { REPORT_STYLE_DIRECTIVE, TaskManager } from "./taskManager.js";
import type { TaskSpawner, WorkspaceProvider } from "./taskManager.js";
import type { ChatRunner, QuickAsk } from "./types.js";

const PROJECTS = [
  { name: "demo", hasGit: true, hasPackageJson: true, updatedAt: 1_700_000_000_000 },
  { name: "hojokin-navi", hasGit: true, hasPackageJson: true, updatedAt: 1_700_000_000_000 },
];

function echoRunner(replyText = "了解です"): { runner: ChatRunner; prompts: string[] } {
  const prompts: string[] = [];
  const runner: ChatRunner = {
    mode: "mock",
    async run({ prompt, resumeSessionId, onEvent }) {
      prompts.push(prompt);
      const sessionId = resumeSessionId ?? "sess-1";
      onEvent({ kind: "session", sessionId });
      onEvent({ kind: "delta", text: replyText });
      onEvent({ kind: "result", text: replyText, sessionId });
      return { sessionId, text: replyText };
    },
  };
  return { runner, prompts };
}

const quickAskNone: QuickAsk = async () => "NONE";

function makeDeps(opts?: {
  runner?: ChatRunner;
  spawner?: TaskSpawner;
  workspaceProvider?: WorkspaceProvider;
}): AppDeps & { taskManager: TaskManager } {
  const taskManager = new TaskManager(
    opts?.spawner ?? (async () => ({ text: "task done" })),
    undefined,
    opts?.workspaceProvider,
  );
  return {
    runner: opts?.runner ?? echoRunner().runner,
    quickAsk: quickAskNone,
    taskManager,
    listProjects: async () => PROJECTS,
    resolveProject: async (name) =>
      PROJECTS.some((p) => p.name === name) || name === "_root" ? `/tmp/${name}` : null,
  };
}

function post(app: ReturnType<typeof createApp>, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readSSE(res: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await res.text();
  const events: Array<{ event: string; data: any }> = [];
  for (const block of text.split("\n\n")) {
    const ev = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (ev && data !== undefined) events.push({ event: ev, data: JSON.parse(data) });
  }
  return events;
}

describe("GET /api/health", () => {
  it("reports ok and runner mode", async () => {
    const res = await createApp(makeDeps()).request("/api/health");
    expect(await res.json()).toEqual({ ok: true, mode: "mock" });
  });
});

describe("projects & workspace", () => {
  it("lists projects with the session's active project", async () => {
    const app = createApp(makeDeps());
    const res = await app.request("/api/projects?browserSessionId=b1");
    const json = (await res.json()) as any;
    expect(json.projects.map((p: any) => p.name)).toEqual(["demo", "hojokin-navi"]);
    expect(json.active).toBeNull();
  });

  it("requests the recent-only list by default and the full list with ?all=1", async () => {
    const seen: Array<{ all?: boolean } | undefined> = [];
    const deps = makeDeps();
    deps.listProjects = async (opts?: { all?: boolean }) => {
      seen.push(opts);
      return PROJECTS;
    };
    const app = createApp(deps);
    await app.request("/api/projects?browserSessionId=b1");
    await app.request("/api/projects?browserSessionId=b1&all=1");
    expect(seen[0]?.all).toBeFalsy();
    expect(seen[1]?.all).toBe(true);
  });

  it("switches the active project and rejects unknown ones", async () => {
    const app = createApp(makeDeps());
    const ok = await post(app, "/api/workspace", { browserSessionId: "b1", project: "demo" });
    expect(((await ok.json()) as any).active).toBe("demo");

    const list = await app.request("/api/projects?browserSessionId=b1");
    expect(((await list.json()) as any).active).toBe("demo");

    const bad = await post(app, "/api/workspace", { browserSessionId: "b1", project: "nope" });
    expect(bad.status).toBe(404);
  });
});

describe("tasks API", () => {
  it("starts a task in the active project and lists it", async () => {
    const pending: TaskSpawner = ({ signal }) =>
      new Promise((res) => {
        signal.addEventListener("abort", () => res({ text: "" }));
        setTimeout(() => res({ text: "done" }), 50);
      });
    const app = createApp(makeDeps({ spawner: pending }));
    await post(app, "/api/workspace", { browserSessionId: "b1", project: "demo" });
    const res = await post(app, "/api/tasks", {
      browserSessionId: "b1",
      instruction: "npm test を回して",
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as any;
    expect(task.project).toBe("demo");
    expect(task.status).toBe("running");

    const list = (await (await app.request("/api/tasks")).json()) as any;
    expect(list.tasks[0].id).toBe(task.id);
  });

  it("rejects tasks without instruction or without a resolvable project", async () => {
    const app = createApp(makeDeps());
    expect((await post(app, "/api/tasks", { browserSessionId: "b1" })).status).toBe(400);
    expect(
      (await post(app, "/api/tasks", { browserSessionId: "b1", instruction: "x" })).status,
    ).toBe(400);
    expect(
      (
        await post(app, "/api/tasks", {
          browserSessionId: "b1",
          project: "nope",
          instruction: "x",
        })
      ).status,
    ).toBe(404);
  });

  it("cancels a running task via the API", async () => {
    const never: TaskSpawner = ({ signal }) =>
      new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
    const deps = makeDeps({ spawner: never });
    const app = createApp(deps);
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    const res = await post(app, `/api/tasks/${task.id}/cancel`, {});
    expect(((await res.json()) as any).ok).toBe(true);
    expect(deps.taskManager.get(task.id)!.status).toBe("cancelled");
  });
});

describe("task append instructions", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  /** 手動で完了させられるspawner: 実行中タスクへの追加指示を検証するため */
  function manualSpawner() {
    const calls: Array<{ instruction: string; resumeSessionId?: string }> = [];
    let resolvers: Array<(v: { text: string; sessionId?: string }) => void> = [];
    const spawner: TaskSpawner = ({ instruction, resumeSessionId, onEvent }) => {
      calls.push({ instruction, resumeSessionId });
      const sessionId = `sess-${calls.length}`;
      onEvent({ kind: "session", sessionId });
      return new Promise((res) => resolvers.push((v) => res({ ...v, sessionId })));
    };
    const finishNext = (text: string) => resolvers.shift()?.({ text });
    return { calls, spawner, finishNext };
  }

  it("queues a follow-up for a running task via the API and resumes the session", async () => {
    const { calls, spawner, finishNext } = manualSpawner();
    const deps = makeDeps({ spawner });
    const app = createApp(deps);
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "step 1" })
    ).json()) as any;

    const res = await post(app, `/api/tasks/${task.id}/instructions`, { text: "テストも追加して" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).ok).toBe(true);

    finishNext("first done");
    await tick();
    expect(calls.length).toBe(2);
    expect(calls[1].resumeSessionId).toBe("sess-1");
    expect(calls[1].instruction).toBe(`テストも追加して\n\n${REPORT_STYLE_DIRECTIVE}`);
    finishNext("all done");
    await tick();
    expect(deps.taskManager.get(task.id)!.status).toBe("succeeded");
  });

  it("rejects empty text, unknown tasks, and finished tasks", async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    await tick(); // タスク完了まで待つ

    expect((await post(app, `/api/tasks/${task.id}/instructions`, { text: "  " })).status).toBe(400);
    expect((await post(app, "/api/tasks/nope/instructions", { text: "x" })).status).toBe(404);
    const finished = await post(app, `/api/tasks/${task.id}/instructions`, { text: "x" });
    expect(finished.status).toBe(409);
    // 読み上げられるエラーもタスクは連番で示す
    expect(((await finished.json()) as any).error).toContain("タスク #1 は実行中");
  });

  it("executes append_task directives from the chat lane", async () => {
    const { calls, spawner, finishNext } = manualSpawner();
    let reply = "ok";
    const runner: ChatRunner = {
      mode: "mock",
      async run({ onEvent }) {
        onEvent({ kind: "result", text: reply, sessionId: "s1" });
        return { sessionId: "s1", text: reply };
      },
    };
    const app = createApp(makeDeps({ spawner, runner }));
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "step 1" })
    ).json()) as any;

    reply = `伝えておきますね。\n@@CV {"action":"append_task","taskId":"${task.id}","instruction":"READMEも更新して"}`;
    const res = await post(app, "/api/chat", { browserSessionId: "b1", message: "追加でお願い" });
    const events = await readSSE(res);
    const directive = events.find((e) => e.event === "directive");
    expect(directive?.data.ok).toBe(true);
    // 読み上げられる報告はタスクを連番で示す
    expect(directive?.data.detail).toContain("タスク #1 に追加指示");

    finishNext("first done");
    await tick();
    expect(calls.length).toBe(2);
    expect(calls[1].instruction.startsWith("READMEも更新して")).toBe(true);
    finishNext("done");
    await tick();
  });

  it("reports failure for append_task on a finished task", async () => {
    const reply = '伝えます。\n@@CV {"action":"append_task","taskId":"nope","instruction":"x"}';
    const app = createApp(makeDeps({ runner: echoRunner(reply).runner }));
    const res = await post(app, "/api/chat", { browserSessionId: "b1", message: "x" });
    const events = await readSSE(res);
    const directive = events.find((e) => e.event === "directive");
    expect(directive?.data.ok).toBe(false);
  });

  it("documents append_task usage in the orchestrator system prompt", async () => {
    let systemPrompt = "";
    const runner: ChatRunner = {
      mode: "mock",
      async run(opts) {
        systemPrompt = opts.systemPrompt ?? "";
        return { sessionId: "s1", text: "ok" };
      },
    };
    const app = createApp(makeDeps({ runner }));
    await post(app, "/api/chat", { browserSessionId: "b1", message: "こんにちは" });
    expect(systemPrompt).toContain("append_task");
    expect(systemPrompt).toContain("追加指示");
    // タスク参照は口頭で言いやすい連番で行うことを指示している
    expect(systemPrompt).toContain("連番");
  });
});

describe("task resume", () => {
  /** Records spawner calls and emits a per-run session id like the real CLI. */
  function recordingSpawner() {
    const calls: Array<{ instruction: string; cwd: string; resumeSessionId?: string }> = [];
    const spawner: TaskSpawner = async ({ instruction, cwd, resumeSessionId, onEvent }) => {
      calls.push({ instruction, cwd, resumeSessionId });
      const sessionId = `sess-${calls.length}`;
      onEvent({ kind: "session", sessionId });
      return { text: "done", sessionId };
    };
    return { calls, spawner };
  }

  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("resumes from a finished task id, inheriting its project and session", async () => {
    const { calls, spawner } = recordingSpawner();
    const app = createApp(makeDeps({ spawner }));
    const first = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "step 1" })
    ).json()) as any;
    await tick();

    const res = await post(app, "/api/tasks", {
      browserSessionId: "b1",
      resume: first.id,
      instruction: "step 2",
    });
    expect(res.status).toBe(201);
    const second = (await res.json()) as any;
    expect(second.project).toBe("demo"); // projectは引き継ぎ元から継承
    expect(second.resumedFrom).toBe("sess-1");
    await tick();
    expect(calls[1]).toEqual({
      instruction: `step 2\n\n${REPORT_STYLE_DIRECTIVE}`,
      cwd: "/tmp/demo",
      resumeSessionId: "sess-1",
    });
  });

  it("treats an unknown resume reference as a raw session id", async () => {
    const { calls, spawner } = recordingSpawner();
    const app = createApp(makeDeps({ spawner }));
    const res = await post(app, "/api/tasks", {
      browserSessionId: "b1",
      project: "demo",
      resume: "11111111-2222-3333-4444-555555555555",
      instruction: "continue",
    });
    expect(res.status).toBe(201);
    await tick();
    expect(calls[0].resumeSessionId).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("rejects resuming a task that is still running", async () => {
    const never: TaskSpawner = ({ signal }) =>
      new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
    const app = createApp(makeDeps({ spawner: never }));
    const first = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    const res = await post(app, "/api/tasks", {
      browserSessionId: "b1",
      resume: first.id,
      instruction: "y",
    });
    expect(res.status).toBe(400);
    // 引き継ぎエラーも読み上げ向けに連番で示す
    expect(((await res.json()) as any).error).toContain("タスク #1 はまだ実行中");
  });

  it("rejects resuming a task that has no session id", async () => {
    // セッションを通知しないspawner(古い実行やモック落ちを想定)
    const silent: TaskSpawner = async () => ({ text: "done" });
    const app = createApp(makeDeps({ spawner: silent }));
    const first = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    await tick();
    const res = await post(app, "/api/tasks", {
      browserSessionId: "b1",
      resume: first.id,
      instruction: "y",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain("タスク #1 には引き継げるセッション");
  });

  it("executes start_task directives with resume via the chat lane", async () => {
    const { calls, spawner } = recordingSpawner();
    // 返答本文を後から差し替えられるrunner: 最初のタスクIDをディレクティブに埋め込むため
    let reply = "ok";
    const runner: ChatRunner = {
      mode: "mock",
      async run({ onEvent }) {
        onEvent({ kind: "result", text: reply, sessionId: "s1" });
        return { sessionId: "s1", text: reply };
      },
    };
    const app = createApp(makeDeps({ spawner, runner }));
    const first = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "step 1" })
    ).json()) as any;
    await tick();

    reply = `続きをやりますね。\n@@CV {"action":"start_task","resume":"${first.id}","instruction":"step 2"}`;
    const res = await post(app, "/api/chat", { browserSessionId: "b1", message: "続きお願い" });
    const events = await readSSE(res);
    const directive = events.find((e) => e.event === "directive");
    expect(directive?.data.ok).toBe(true);
    expect(directive?.data.detail).toContain("続き");
    await tick();
    expect(calls[1]).toEqual({
      instruction: `step 2\n\n${REPORT_STYLE_DIRECTIVE}`,
      cwd: "/tmp/demo",
      resumeSessionId: "sess-1",
    });
  });

  it("documents resume usage in the orchestrator system prompt", async () => {
    let systemPrompt = "";
    const runner: ChatRunner = {
      mode: "mock",
      async run(opts) {
        systemPrompt = opts.systemPrompt ?? "";
        return { sessionId: "s1", text: "ok" };
      },
    };
    const app = createApp(makeDeps({ runner }));
    await post(app, "/api/chat", { browserSessionId: "b1", message: "こんにちは" });
    expect(systemPrompt).toContain('"resume"');
    expect(systemPrompt).toContain("引き継ぎ可");
  });

  it("summarizes sessionId in the task API responses", async () => {
    const { spawner } = recordingSpawner();
    const app = createApp(makeDeps({ spawner }));
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    await tick();
    const listed = ((await (await app.request("/api/tasks")).json()) as any).tasks[0];
    expect(listed.id).toBe(task.id);
    expect(listed.sessionId).toBe("sess-1");
  });
});

describe("task worktree info", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));

  const fakeProvider: WorkspaceProvider = async ({ project, taskId }) => ({
    kind: "worktree",
    worktreePath: `/wt/${project}-${taskId}`,
    branch: `task/${taskId}`,
  });

  it("exposes worktree path and branch in task summaries and detail", async () => {
    const app = createApp(makeDeps({ workspaceProvider: fakeProvider }));
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    await tick();
    const detail = (await (await app.request(`/api/tasks/${task.id}`)).json()) as any;
    expect(detail.worktreePath).toBe(`/wt/demo-${task.id}`);
    expect(detail.branch).toBe(`task/${task.id}`);
    expect(detail.worktreeNote).toBeNull();
    const list = (await (await app.request("/api/tasks")).json()) as any;
    expect(list.tasks[0].worktreePath).toBe(`/wt/demo-${task.id}`);
    expect(list.tasks[0].branch).toBe(`task/${task.id}`);
  });

  it("exposes the fallback note when worktree creation failed", async () => {
    const failing: WorkspaceProvider = async () => ({ kind: "project", reason: "no HEAD" });
    const app = createApp(makeDeps({ workspaceProvider: failing }));
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    await tick();
    const detail = (await (await app.request(`/api/tasks/${task.id}`)).json()) as any;
    expect(detail.worktreePath).toBeNull();
    expect(detail.branch).toBeNull();
    expect(detail.worktreeNote).toContain("no HEAD");
  });

  it("resumes a task inside the source task's worktree instead of creating a new one", async () => {
    let providerCalls = 0;
    const provider: WorkspaceProvider = async (opts) => {
      providerCalls++;
      return fakeProvider(opts);
    };
    const calls: Array<{ cwd: string; resumeSessionId?: string }> = [];
    const spawner: TaskSpawner = async ({ cwd, resumeSessionId, onEvent }) => {
      calls.push({ cwd, resumeSessionId });
      const sessionId = `sess-${calls.length}`;
      onEvent({ kind: "session", sessionId });
      return { text: "done", sessionId };
    };
    const app = createApp(makeDeps({ spawner, workspaceProvider: provider }));
    const first = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "step 1" })
    ).json()) as any;
    await tick();

    const second = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", resume: first.id, instruction: "step 2" })
    ).json()) as any;
    await tick();
    // --resumeは同一cwd限定のため、元タスクのworktreeで続きを実行する
    expect(providerCalls).toBe(1);
    expect(calls[1].cwd).toBe(`/wt/demo-${first.id}`);
    expect(calls[1].resumeSessionId).toBe("sess-1");
    const detail = (await (await app.request(`/api/tasks/${second.id}`)).json()) as any;
    expect(detail.worktreePath).toBe(`/wt/demo-${first.id}`);
    expect(detail.branch).toBe(`task/${first.id}`);
  });
});

describe("task sequence numbers", () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const never: TaskSpawner = ({ signal }) =>
    new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));

  it("includes seq in task API responses", async () => {
    const app = createApp(makeDeps());
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    expect(task.seq).toBe(1);
    await tick();
    const listed = ((await (await app.request("/api/tasks")).json()) as any).tasks[0];
    expect(listed.seq).toBe(1);
  });

  it("cancels a running task referenced by its sequence number", async () => {
    const deps = makeDeps({ spawner: never });
    const app = createApp(deps);
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    const res = await post(app, "/api/tasks/1/cancel", {});
    expect(((await res.json()) as any).ok).toBe(true);
    expect(deps.taskManager.get(task.id)!.status).toBe("cancelled");
  });

  it("appends an instruction to a task referenced by its sequence number", async () => {
    const deps = makeDeps({ spawner: never });
    const app = createApp(deps);
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    const res = await post(app, "/api/tasks/1/instructions", { text: "ログも見て" });
    expect(res.status).toBe(200);
    expect(
      deps.taskManager.get(task.id)!.events.some((e) => e.kind === "instruction"),
    ).toBe(true);
  });

  it("resumes from a task referenced by its sequence number", async () => {
    const calls: Array<{ resumeSessionId?: string }> = [];
    const spawner: TaskSpawner = async ({ resumeSessionId, onEvent }) => {
      calls.push({ resumeSessionId });
      const sessionId = `sess-${calls.length}`;
      onEvent({ kind: "session", sessionId });
      return { text: "done", sessionId };
    };
    const app = createApp(makeDeps({ spawner }));
    await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "step 1" });
    await tick();
    const res = await post(app, "/api/tasks", {
      browserSessionId: "b1",
      resume: "1",
      instruction: "step 2",
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as any).project).toBe("demo");
    await tick();
    expect(calls[1].resumeSessionId).toBe("sess-1");
  });

  it("executes cancel_task directives that reference a task by number", async () => {
    let reply = "ok";
    const runner: ChatRunner = {
      mode: "mock",
      async run({ onEvent }) {
        onEvent({ kind: "result", text: reply, sessionId: "s1" });
        return { sessionId: "s1", text: reply };
      },
    };
    const deps = makeDeps({ spawner: never, runner });
    const app = createApp(deps);
    const task = (await (
      await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" })
    ).json()) as any;
    reply = '中止しますね。\n@@CV {"action":"cancel_task","taskId":"#1"}';
    const res = await post(app, "/api/chat", { browserSessionId: "b1", message: "1番を止めて" });
    const events = await readSSE(res);
    const directive = events.find((e) => e.event === "directive");
    expect(directive?.data.ok).toBe(true);
    // 読み上げられる報告はどのタスクを止めたか連番で示す
    expect(directive?.data.detail).toContain("タスク #1 を中止しました");
    expect(deps.taskManager.get(task.id)!.status).toBe("cancelled");
  });

  it("reports a finished task as not running when cancel_task references it", async () => {
    const reply = '中止しますね。\n@@CV {"action":"cancel_task","taskId":"#1"}';
    const deps = makeDeps({ runner: echoRunner(reply).runner });
    const app = createApp(deps);
    await post(app, "/api/tasks", { browserSessionId: "b1", project: "demo", instruction: "x" });
    await tick(); // タスク完了まで待つ
    const res = await post(app, "/api/chat", { browserSessionId: "b1", message: "1番を止めて" });
    const events = await readSSE(res);
    const directive = events.find((e) => e.event === "directive");
    expect(directive?.data.ok).toBe(false);
    // 終了済みタスクは「見つからない」ではなく「実行中ではない」と読み上げる
    expect(directive?.data.detail).toContain("タスク #1 は実行中ではない");
  });

  it("identifies tasks by sequence number only in the chat prompt (no hex id)", () => {
    const prompt = buildChatPrompt({
      message: "hi",
      projects: PROJECTS,
      activeProject: "demo",
      tasks: [
        {
          id: "aaa",
          seq: 3,
          project: "demo",
          instruction: "x",
          events: [],
          startedAt: 0,
          status: "succeeded",
          sessionId: "sess-1",
        } as any,
      ],
    });
    expect(prompt).toContain("#3 [succeeded]");
    // 口頭で伝わらない16進IDはオーケストレーターにも渡さず、連番参照に統一する
    expect(prompt).not.toContain("aaa");
  });
});

describe("buildChatPrompt resume info", () => {
  it("marks tasks that have a resumable session", () => {
    const base = {
      project: "demo",
      instruction: "x",
      events: [],
      startedAt: 0,
    };
    const prompt = buildChatPrompt({
      message: "hi",
      projects: PROJECTS,
      activeProject: "demo",
      tasks: [
        { ...base, id: "aaa", seq: 1, status: "succeeded", sessionId: "sess-1" } as any,
        { ...base, id: "bbb", seq: 2, status: "failed" } as any,
      ],
    });
    expect(prompt).toContain("#1 [succeeded][引き継ぎ可]");
    expect(prompt).toContain("#2 [failed] ");
    expect(prompt).not.toContain("#2 [failed][引き継ぎ可]");
  });
});

describe("POST /api/chat (orchestrator)", () => {
  it("streams deltas and injects situation context into the prompt", async () => {
    const { runner, prompts } = echoRunner();
    const app = createApp(makeDeps({ runner }));
    await post(app, "/api/workspace", { browserSessionId: "b1", project: "demo" });
    const res = await post(app, "/api/chat", {
      browserSessionId: "b1",
      message: "こんにちは",
    });
    const events = await readSSE(res);
    expect(events.map((e) => e.event)).toContain("delta");
    expect(events[events.length - 1].event).toBe("done");
    expect(prompts[0]).toContain("[ユーザー発話]");
    expect(prompts[0]).toContain("こんにちは");
    expect(prompts[0]).toContain("demo");
  });

  it("executes start_task directives and strips them from the reply", async () => {
    const reply =
      'テストを回しますね。\n@@CV {"action":"start_task","project":"hojokin-navi","instruction":"npm test"}';
    const deps = makeDeps({ runner: echoRunner(reply).runner });
    const app = createApp(deps);
    const res = await post(app, "/api/chat", { browserSessionId: "b1", message: "テスト回して" });
    const events = await readSSE(res);

    const directive = events.find((e) => e.event === "directive");
    expect(directive?.data.action).toBe("start_task");
    expect(directive?.data.ok).toBe(true);
    expect(directive?.data.taskId).toBeTruthy();
    expect(deps.taskManager.list()[0].project).toBe("hojokin-navi");

    const done = events.find((e) => e.event === "done");
    expect(done?.data.text).toBe("テストを回しますね。");
  });

  it("executes switch_project directives and updates the workspace", async () => {
    const reply = '切り替えます。\n@@CV {"action":"switch_project","project":"demo"}';
    const app = createApp(makeDeps({ runner: echoRunner(reply).runner }));
    const res = await post(app, "/api/chat", { browserSessionId: "b9", message: "demoにして" });
    const events = await readSSE(res);
    expect(events.find((e) => e.event === "directive")?.data.ok).toBe(true);
    const list = await app.request("/api/projects?browserSessionId=b9");
    expect(((await list.json()) as any).active).toBe("demo");
  });

  it("reports failed directives without crashing the reply", async () => {
    const reply = 'やってみます。\n@@CV {"action":"start_task","project":"nope","instruction":"x"}';
    const app = createApp(makeDeps({ runner: echoRunner(reply).runner }));
    const res = await post(app, "/api/chat", { browserSessionId: "b1", message: "x" });
    const events = await readSSE(res);
    const directive = events.find((e) => e.event === "directive");
    expect(directive?.data.ok).toBe(false);
    expect(events.find((e) => e.event === "done")?.data.text).toBe("やってみます。");
  });

  it("executes fix_transcript directives and passes the corrected text to the client", async () => {
    const reply = 'テンポの件ですね。\n@@CV {"action":"fix_transcript","corrected":"テンポが大事"}';
    const app = createApp(makeDeps({ runner: echoRunner(reply).runner }));
    const res = await post(app, "/api/chat", { browserSessionId: "b1", message: "店舗が大事" });
    const events = await readSSE(res);
    const directive = events.find((e) => e.event === "directive");
    expect(directive?.data).toEqual({ action: "fix_transcript", ok: true, corrected: "テンポが大事" });
    expect(events.find((e) => e.event === "done")?.data.text).toBe("テンポの件ですね。");
  });

  it("instructs the orchestrator to fix obvious voice misrecognitions from context", async () => {
    let systemPrompt = "";
    const runner: ChatRunner = {
      mode: "mock",
      async run(opts) {
        systemPrompt = opts.systemPrompt ?? "";
        return { sessionId: "s1", text: "ok" };
      },
    };
    const app = createApp(makeDeps({ runner }));
    await post(app, "/api/chat", { browserSessionId: "b1", message: "こんにちは" });
    expect(systemPrompt).toContain("fix_transcript");
    expect(systemPrompt).toContain("誤認識");
  });

  it("rejects missing message", async () => {
    const res = await post(createApp(makeDeps()), "/api/chat", { browserSessionId: "b1" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/interject", () => {
  it("still detects vague transcripts", async () => {
    const app = createApp(makeDeps());
    const res = await post(app, "/api/interject", {
      browserSessionId: "b3",
      transcript: "例のダッシュボードをいい感じにしたいんだけど",
    });
    expect(((await res.json()) as any).interject).toBe(true);
  });
});

describe("security hardening", () => {
  it("rejects POSTs without application/json (CSRF via simple requests)", async () => {
    const app = createApp(makeDeps());
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ project: "demo", instruction: "rm -rf" }),
    });
    expect(res.status).toBe(415);
  });
});
