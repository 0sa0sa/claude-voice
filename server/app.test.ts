import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppDeps } from "./app.js";
import { TaskManager } from "./taskManager.js";
import type { TaskSpawner } from "./taskManager.js";
import type { ChatRunner, QuickAsk } from "./types.js";

const PROJECTS = [
  { name: "demo", hasGit: true, hasPackageJson: true },
  { name: "hojokin-navi", hasGit: true, hasPackageJson: true },
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
}): AppDeps & { taskManager: TaskManager } {
  const taskManager = new TaskManager(opts?.spawner ?? (async () => ({ text: "task done" })));
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
