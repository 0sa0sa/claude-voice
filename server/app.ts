import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { extractDirectives } from "./directives.js";
import type { Directive } from "./directives.js";
import { decideInterjection } from "./interjection.js";
import type { ProjectInfo } from "./projects.js";
import { SessionStore } from "./sessions.js";
import type { Task, TaskManager } from "./taskManager.js";
import type { ChatRunner, ClaudeEvent, QuickAsk } from "./types.js";

export interface AppDeps {
  runner: ChatRunner;
  quickAsk: QuickAsk;
  taskManager: TaskManager;
  listProjects: () => Promise<ProjectInfo[]>;
  /** Maps a project name (or "_root") to an absolute cwd, or null if unknown. */
  resolveProject: (name: string) => Promise<string | null>;
}

const SYSTEM_STYLE = [
  "あなたは音声会話でソフトウェア開発の全てを取り仕切る管制塔アシスタント。回答は音声で読み上げられる。",
  "簡潔に、話し言葉で、3文以内を基本に答えて。箇条書きや記号、コードブロックは使わない。",
  "毎ターン冒頭の[状況]にプロジェクト一覧・アクティブプロジェクト・タスク状態が入る。それを踏まえて答えて。",
  "ユーザーが実作業(実装・修正・テスト・調査など)を頼んだら、返答の最後に次の形式の行を1行追加して: ",
  '@@CV {"action":"start_task","project":"プロジェクト名","instruction":"具体的な作業指示"}',
  "instructionは作業者Claudeへの完結した指示文にして。プロジェクト切替は ",
  '@@CV {"action":"switch_project","project":"名前"} 、タスク中止は @@CV {"action":"cancel_task","taskId":"ID"} 。',
  "新規プロジェクト作成はprojectを_rootにしてinstructionでディレクトリ作成から指示して。",
  "@@CV行はユーザーには見えない。実行するかどうか曖昧な依頼は先に一言確認してから。",
  "タスクの進捗や結果を聞かれたら[状況]の内容から答えて。",
].join("");

function summarizeTask(t: Task) {
  return {
    id: t.id,
    project: t.project,
    instruction: t.instruction,
    status: t.status,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    lastEvent: t.events.at(-1)?.text ?? null,
    result: t.result ?? null,
    error: t.error ?? null,
  };
}

export function buildChatPrompt(opts: {
  message: string;
  projects: ProjectInfo[];
  activeProject: string | null;
  tasks: Task[];
}): string {
  const taskLines =
    opts.tasks.length === 0
      ? "なし"
      : opts.tasks
          .slice(0, 8)
          .map(
            (t) =>
              `${t.id} [${t.status}] ${t.project}: ${t.instruction.slice(0, 40)}` +
              (t.result ? ` → ${t.result.slice(0, 60)}` : t.error ? ` → エラー: ${t.error.slice(0, 60)}` : ""),
          )
          .join("\n");
  return [
    "[状況]",
    `プロジェクト一覧: ${opts.projects.map((p) => p.name).join(", ")}`,
    `アクティブプロジェクト: ${opts.activeProject ?? "(未選択)"}`,
    `タスク:\n${taskLines}`,
    "[ユーザー発話]",
    opts.message,
  ].join("\n");
}

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const sessions = new SessionStore();

  app.get("/api/health", (c) => c.json({ ok: true, mode: deps.runner.mode }));

  app.get("/api/projects", async (c) => {
    const browserSessionId = c.req.query("browserSessionId") ?? "default";
    const session = sessions.get(browserSessionId);
    return c.json({
      projects: await deps.listProjects(),
      active: session.activeProject ?? null,
    });
  });

  app.post("/api/workspace", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const project: unknown = body.project;
    const session = sessions.get(body.browserSessionId ?? "default");
    if (typeof project !== "string" || !(await deps.resolveProject(project))) {
      return c.json({ error: `プロジェクト ${project} が見つかりません` }, 404);
    }
    session.activeProject = project;
    return c.json({ ok: true, active: project });
  });

  async function startTask(
    project: string | undefined,
    activeProject: string | undefined,
    instruction: string,
  ): Promise<{ ok: true; task: Task } | { ok: false; status: 400 | 404; error: string }> {
    const name = project ?? activeProject;
    if (!name) {
      return { ok: false, status: 400, error: "プロジェクトが未選択です" };
    }
    const path = await deps.resolveProject(name);
    if (!path) return { ok: false, status: 404, error: `プロジェクト ${name} が見つかりません` };
    return { ok: true, task: deps.taskManager.start({ project: name, projectPath: path, instruction }) };
  }

  app.post("/api/tasks", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const session = sessions.get(body.browserSessionId ?? "default");
    if (typeof body.instruction !== "string" || !body.instruction.trim()) {
      return c.json({ error: "instruction is required" }, 400);
    }
    const started = await startTask(
      typeof body.project === "string" ? body.project : undefined,
      session.activeProject,
      body.instruction,
    );
    if (!started.ok) return c.json({ error: started.error }, started.status);
    return c.json(summarizeTask(started.task), 201);
  });

  app.get("/api/tasks", (c) => c.json({ tasks: deps.taskManager.list().map(summarizeTask) }));

  app.get("/api/tasks/:id", (c) => {
    const task = deps.taskManager.get(c.req.param("id"));
    return task ? c.json({ ...summarizeTask(task), events: task.events }) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/tasks/:id/cancel", (c) => {
    const ok = deps.taskManager.cancel(c.req.param("id"));
    return c.json({ ok });
  });

  app.post("/api/chat", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const message: unknown = body.message;
    const browserSessionId: string = body.browserSessionId ?? "default";
    if (typeof message !== "string" || message.trim() === "") {
      return c.json({ error: "message is required" }, 400);
    }
    const session = sessions.get(browserSessionId);

    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) =>
        stream.writeSSE({ event, data: JSON.stringify(data) });
      try {
        const prompt = buildChatPrompt({
          message,
          projects: await deps.listProjects(),
          activeProject: session.activeProject ?? null,
          tasks: deps.taskManager.list(),
        });
        const onEvent = (e: ClaudeEvent) => {
          if (e.kind === "session" && e.sessionId) {
            session.claudeSessionId = e.sessionId;
            void send("session", { sessionId: e.sessionId });
          } else if (e.kind === "delta" && e.text) {
            void send("delta", { text: e.text });
          } else if (e.kind === "error") {
            void send("error", { message: e.text ?? "claude error" });
          }
        };
        const result = await deps.runner.run({
          prompt,
          systemPrompt: SYSTEM_STYLE,
          resumeSessionId: session.claudeSessionId,
          onEvent,
        });
        if (result.sessionId) session.claudeSessionId = result.sessionId;

        const { directives, cleanText } = extractDirectives(result.text);
        for (const d of directives) {
          await send("directive", await executeDirective(d, session.activeProject, session));
        }
        await send("done", { text: cleanText });
      } catch (err) {
        await send("error", { message: err instanceof Error ? err.message : String(err) });
      }
    });

    async function executeDirective(
      d: Directive,
      activeProject: string | undefined,
      session: { activeProject?: string },
    ): Promise<Record<string, unknown>> {
      switch (d.action) {
        case "switch_project": {
          const path = await deps.resolveProject(d.project);
          if (!path) {
            return { action: d.action, ok: false, detail: `プロジェクト ${d.project} が見つかりません` };
          }
          session.activeProject = d.project;
          return { action: d.action, ok: true, project: d.project, detail: `${d.project} に切り替えました` };
        }
        case "start_task": {
          const started = await startTask(d.project, activeProject, d.instruction);
          if (!started.ok) return { action: d.action, ok: false, detail: started.error };
          return {
            action: d.action,
            ok: true,
            taskId: started.task.id,
            project: started.task.project,
            detail: `${started.task.project} でタスクを開始しました`,
          };
        }
        case "cancel_task": {
          const ok = deps.taskManager.cancel(d.taskId);
          return {
            action: d.action,
            ok,
            taskId: d.taskId,
            detail: ok ? "タスクを中止しました" : "対象のタスクが見つかりません",
          };
        }
      }
    }
  });

  app.post("/api/interject", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const transcript: unknown = body.transcript;
    const browserSessionId: string = body.browserSessionId ?? "default";
    if (typeof transcript !== "string") {
      return c.json({ error: "transcript is required" }, 400);
    }
    const session = sessions.get(browserSessionId);
    if (transcript.length <= session.lastInterjectLen) {
      return c.json({ interject: false, question: "" });
    }
    const decision = await decideInterjection({
      transcript,
      recentContext: typeof body.context === "string" ? body.context : undefined,
      seenTriggers: session.seenTriggers,
      ask: deps.quickAsk,
    });
    if (decision.interject && decision.trigger) {
      session.seenTriggers.push(decision.trigger);
      session.lastInterjectLen = transcript.length;
    }
    return c.json(decision);
  });

  return app;
}
