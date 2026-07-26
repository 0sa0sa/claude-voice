import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { homedir } from "node:os";
import { join } from "node:path";
import { createApp } from "./app.js";
import {
  createCliQuickAsk,
  createCliRunner,
  createCliTaskSpawner,
  createMockRunner,
  createMockTaskSpawner,
  mockQuickAsk,
} from "./claudeRunner.js";
import { createDictionaryApp, DictionaryStore } from "./dictionary.js";
import { DEFAULT_RECENT_DAYS, resolveProjectPath, scanProjects } from "./projects.js";
import { TaskManager } from "./taskManager.js";
import { TaskStore } from "./taskStore.js";
import { createWorktreeProvider } from "./worktrees.js";

const useMock = process.env.CLAUDE_VOICE_MOCK === "1";
const projectsRoot = process.env.CLAUDE_VOICE_PROJECTS_ROOT ?? join(homedir(), "projects");
// 一覧に出す「最近触ったプロジェクト」の閾値(日数)。名前指定の解決は全件が対象のまま
const recentDays = Number(process.env.CLAUDE_VOICE_RECENT_DAYS) || DEFAULT_RECENT_DAYS;

// タスク履歴の保存先(辞書と同じ ~/.claude-voice 配下)。再起動しても履歴が残る
const tasksPath =
  process.env.CLAUDE_VOICE_TASKS_PATH ?? join(homedir(), ".claude-voice", "tasks.json");
// タスクごとのworktree分離: 並列タスクの作業ディレクトリ衝突を防ぐ。
// モックモードでは実リポジトリにブランチを作らないよう無効化し、
// "_root"(プロジェクトルート直下での新規作成)は対象外にする
const worktreesRoot =
  process.env.CLAUDE_VOICE_WORKTREES_ROOT ?? join(homedir(), ".claude-voice", "worktrees");
const worktreeProvider = createWorktreeProvider(worktreesRoot);
const taskManager = new TaskManager(
  useMock ? createMockTaskSpawner() : createCliTaskSpawner(),
  new TaskStore(tasksPath),
  useMock
    ? undefined
    : (opts) => (opts.project === "_root" ? Promise.resolve({ kind: "project" }) : worktreeProvider(opts)),
);
// 前回起動時の履歴を復元(runningのまま残ったタスクはfailedに補正される)
await taskManager.restore();

const app = createApp({
  runner: useMock ? createMockRunner() : createCliRunner(),
  quickAsk: useMock ? mockQuickAsk : createCliQuickAsk(),
  taskManager,
  listProjects: (opts) => scanProjects(projectsRoot, { maxAgeDays: opts?.all ? null : recentDays }),
  resolveProject: (name) => resolveProjectPath(projectsRoot, name),
});

// 音声補正辞書。/api/* のCSRFガード(app.ts)はマウント先でも効く
const dictionaryPath =
  process.env.CLAUDE_VOICE_DICTIONARY_PATH ?? join(homedir(), ".claude-voice", "dictionary.json");
app.route("/api/dictionary", createDictionaryApp(new DictionaryStore(dictionaryPath)));

// Serve the built client (dist/) when it exists, for `npm run start`.
app.use("/*", serveStatic({ root: "./dist" }));

const port = Number(process.env.PORT ?? 8799);
// タスクはフル権限で動くため、リッスンはループバック限定(LAN露出させない)
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(
    `claude-voice server: http://localhost:${info.port} (mode: ${useMock ? "mock" : "cli"}, projects: ${projectsRoot})`,
  );
});
