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
import { createFavoritesApp, FavoritesStore } from "./favorites.js";
import { ProjectIndex } from "./projectIndex.js";
import { DEFAULT_RECENT_DAYS, resolveProjectPath, scanProjects } from "./projects.js";
import { TaskManager } from "./taskManager.js";
import { TaskStore } from "./taskStore.js";
import { ThreadLog, ThreadStore } from "./threadLog.js";
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

// 会話ログのスレッド保存: メイン会話とタスク別スレッドを分離して永続化する
const threadsPath =
  process.env.CLAUDE_VOICE_THREADS_PATH ?? join(homedir(), ".claude-voice", "threads.json");
const threadLog = new ThreadLog(new ThreadStore(threadsPath));
await threadLog.restore();

// サイドバーに表示するお気に入りプロジェクト(辞書と同じ ~/.claude-voice 配下に永続化)。
// お気に入りは最終更新が古くても通常一覧に含める
const favoritesPath =
  process.env.CLAUDE_VOICE_FAVORITES_PATH ?? join(homedir(), ".claude-voice", "favorites.json");
const favoritesStore = new FavoritesStore(favoritesPath);

// プロジェクト情報のTTLキャッシュ: 一覧のポーリングやチャットの[状況]生成のたびに
// readdir+statのフルスキャンが走らないようにする
const projectIndex = new ProjectIndex({
  scan: async ({ all }) =>
    scanProjects(projectsRoot, {
      maxAgeDays: all ? null : recentDays,
      include: await favoritesStore.list(),
    }),
  resolve: (name) => resolveProjectPath(projectsRoot, name),
});

const app = createApp({
  runner: useMock ? createMockRunner() : createCliRunner(),
  quickAsk: useMock ? mockQuickAsk : createCliQuickAsk(),
  taskManager,
  threadLog,
  listProjects: (opts) => projectIndex.list(opts),
  resolveProject: (name) => projectIndex.resolve(name),
});

// お気に入りAPI。変更したら一覧キャッシュを捨て、次のGETに即反映させる
app.route("/api/favorites", createFavoritesApp(favoritesStore, () => projectIndex.invalidate()));

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
