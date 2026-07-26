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
  /** 省略時は最近触ったプロジェクトのみ。{ all: true } で全件 */
  listProjects: (opts?: { all?: boolean }) => Promise<ProjectInfo[]>;
  /** Maps a project name (or "_root") to an absolute cwd, or null if unknown. */
  resolveProject: (name: string) => Promise<string | null>;
}

const SYSTEM_STYLE = [
  "あなたは音声会話でソフトウェア開発の全てを取り仕切る管制塔アシスタント。回答は音声で読み上げられる。",
  "簡潔に、話し言葉で、3文以内を基本に答えて。箇条書きや記号、コードブロックは使わない。",
  "毎ターン冒頭の[状況]にプロジェクト一覧・アクティブプロジェクト・タスク状態が入る。それを踏まえて答えて。",
  "ユーザーが実作業(実装・修正・テスト・調査など)を頼んだら、返答の最後に次の形式の行を1行追加して: ",
  '@@CV {"action":"start_task","project":"プロジェクト名","instruction":"具体的な作業指示"}',
  "タスクの指定は[状況]に付いている連番で行い、会話でも「タスク3」のように連番で呼んで。",
  "過去タスクの続き・修正・追加対応を頼まれたら、[状況]で[引き継ぎ可]が付いているタスクに限り ",
  '@@CV {"action":"start_task","resume":"#3","instruction":"続きの指示"} と連番のresumeを付けて。',
  "resumeで前回の作業文脈(会話・変更内容)を引き継いだまま再開できる。projectは省略すると引き継ぎ元と同じになる。",
  "実行中(running)のタスクへの追加指示・軌道修正は ",
  '@@CV {"action":"append_task","taskId":"#3","instruction":"追加の指示"} で伝えて。現在の作業が一区切りした後に同じ文脈で実行される。',
  "instructionは作業者Claudeへの完結した指示文にして。プロジェクト切替は ",
  '@@CV {"action":"switch_project","project":"名前"} 、タスク中止は @@CV {"action":"cancel_task","taskId":"#3"} 。',
  "新規プロジェクト作成はprojectを_rootにしてinstructionでディレクトリ作成から指示して。",
  "@@CV行はユーザーには見えない。実行するかどうか曖昧な依頼は先に一言確認してから。",
  "ユーザー発話は音声認識の書き起こしで、同音異義語などの誤認識を含むことがある。",
  "文脈から明らかな誤認識は正しい内容に読み替えて応答して(例:「店舗が大事」は音楽やリズムの文脈なら「テンポが大事」)。",
  '読み替えたときは @@CV {"action":"fix_transcript","corrected":"補正後の発話全文"} を1行追加して。確信が持てないときは読み替えず、確認もしない。',
  "タスクの進捗や結果を聞かれたら[状況]の内容から答えて。",
].join("");

function summarizeTask(t: Task) {
  return {
    id: t.id,
    seq: t.seq,
    project: t.project,
    instruction: t.instruction,
    status: t.status,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    lastEvent: t.events.at(-1)?.text ?? null,
    result: t.result ?? null,
    error: t.error ?? null,
    sessionId: t.sessionId ?? null,
    resumedFrom: t.resumedFrom ?? null,
    worktreePath: t.worktreePath ?? null,
    branch: t.branch ?? null,
    worktreeNote: t.worktreeNote ?? null,
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
            // 16進IDは口頭で伝わらないためプロンプトにも出さず、参照は連番に統一する
            (t) =>
              `#${t.seq} [${t.status}]${t.sessionId ? "[引き継ぎ可]" : ""} ${t.project}: ${t.instruction.slice(0, 40)}` +
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

  // CSRF対策: 変更系はapplication/jsonを必須にする。text/plainの単純リクエストは
  // CORSプリフライトを経ずに届くため、ここで弾かないと外部サイトからタスクを起動できてしまう。
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "POST" && !c.req.header("content-type")?.includes("application/json")) {
      return c.json({ error: "content-type: application/json required" }, 415);
    }
    await next();
  });

  app.get("/api/health", (c) => c.json({ ok: true, mode: deps.runner.mode }));

  app.get("/api/projects", async (c) => {
    const browserSessionId = c.req.query("browserSessionId") ?? "default";
    const session = sessions.get(browserSessionId);
    return c.json({
      projects: await deps.listProjects({ all: c.req.query("all") === "1" }),
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

  /**
   * Resolves a resume reference (task id or raw Claude session id) to a
   * session id + default project. Sessions live per-cwd, so resuming a known
   * task defaults to that task's project.
   */
  function resolveResume(
    resume: string,
  ):
    | {
        ok: true;
        sessionId: string;
        project?: string;
        workspace?: { worktreePath?: string; branch?: string };
      }
    | { ok: false; status: 400; error: string } {
    const source = deps.taskManager.resolve(resume);
    if (!source) return { ok: true, sessionId: resume };
    // エラーは読み上げられるため、タスクは口頭で分かる連番で示す
    if (source.status === "running") {
      return { ok: false, status: 400, error: `タスク #${source.seq} はまだ実行中で引き継げません` };
    }
    if (!source.sessionId) {
      return { ok: false, status: 400, error: `タスク #${source.seq} には引き継げるセッションがありません` };
    }
    return {
      ok: true,
      sessionId: source.sessionId,
      project: source.project,
      // セッションは元タスクのcwdに紐づくため、worktreeもそのまま引き継ぐ
      workspace: { worktreePath: source.worktreePath, branch: source.branch },
    };
  }

  async function startTask(
    project: string | undefined,
    activeProject: string | undefined,
    instruction: string,
    resume?: string,
  ): Promise<{ ok: true; task: Task } | { ok: false; status: 400 | 404; error: string }> {
    let resumeSessionId: string | undefined;
    let resumeProject: string | undefined;
    let workspace: { worktreePath?: string; branch?: string } | undefined;
    if (resume) {
      const resolved = resolveResume(resume);
      if (!resolved.ok) return resolved;
      resumeSessionId = resolved.sessionId;
      resumeProject = resolved.project;
      workspace = resolved.workspace;
    }
    const name = project ?? resumeProject ?? activeProject;
    if (!name) {
      return { ok: false, status: 400, error: "プロジェクトが未選択です" };
    }
    const path = await deps.resolveProject(name);
    if (!path) return { ok: false, status: 404, error: `プロジェクト ${name} が見つかりません` };
    return {
      ok: true,
      task: deps.taskManager.start({
        project: name,
        projectPath: path,
        instruction,
        resumeSessionId,
        workspace,
      }),
    };
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
      typeof body.resume === "string" && body.resume.trim() ? body.resume : undefined,
    );
    if (!started.ok) return c.json({ error: started.error }, started.status);
    return c.json(summarizeTask(started.task), 201);
  });

  app.get("/api/tasks", (c) => c.json({ tasks: deps.taskManager.list().map(summarizeTask) }));

  // :id はタスクID・連番("3")のどちらでも指定できる
  app.get("/api/tasks/:id", (c) => {
    const task = deps.taskManager.resolve(c.req.param("id"));
    return task ? c.json({ ...summarizeTask(task), events: task.events }) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/tasks/:id/cancel", (c) => {
    const task = deps.taskManager.resolve(c.req.param("id"));
    return c.json({ ok: task ? deps.taskManager.cancel(task.id) : false });
  });

  // 実行中タスクへの追加指示。現在の実行完了後に同じセッションを引き継いで消化される
  app.post("/api/tasks/:id/instructions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return c.json({ error: "text is required" }, 400);
    const task = deps.taskManager.resolve(c.req.param("id"));
    if (!task) return c.json({ error: "not found" }, 404);
    if (!deps.taskManager.appendInstruction(task.id, text)) {
      return c.json({ error: `タスク #${task.seq} は実行中ではありません` }, 409);
    }
    return c.json({ ok: true });
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
          const started = await startTask(d.project, activeProject, d.instruction, d.resume);
          if (!started.ok) return { action: d.action, ok: false, detail: started.error };
          return {
            action: d.action,
            ok: true,
            taskId: started.task.id,
            project: started.task.project,
            detail: d.resume
              ? `${started.task.project} で前回の続きからタスクを開始しました`
              : `${started.task.project} でタスクを開始しました`,
          };
        }
        case "append_task": {
          const target = deps.taskManager.resolve(d.taskId);
          const ok = target ? deps.taskManager.appendInstruction(target.id, d.instruction) : false;
          // 読み上げられる報告なので、タスクは連番で示す(未解決時は指定された参照のまま)
          const label = target ? `#${target.seq}` : d.taskId;
          return {
            action: d.action,
            ok,
            taskId: d.taskId,
            detail: ok
              ? `タスク ${label} に追加指示を送りました`
              : `タスク ${label} は実行中ではないため追加指示できません`,
          };
        }
        case "cancel_task": {
          const target = deps.taskManager.resolve(d.taskId);
          const ok = target ? deps.taskManager.cancel(target.id) : false;
          return {
            action: d.action,
            ok,
            taskId: d.taskId,
            detail: !target
              ? "対象のタスクが見つかりません"
              : ok
                ? `タスク #${target.seq} を中止しました`
                : `タスク #${target.seq} は実行中ではないため中止できません`,
          };
        }
        case "fix_transcript":
          // 表示中のユーザー発話をクライアント側で差し替えるだけ。読み上げはしない
          return { action: d.action, ok: true, corrected: d.corrected };
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
