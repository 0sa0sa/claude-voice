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
import { resolveProjectPath, scanProjects } from "./projects.js";
import { TaskManager } from "./taskManager.js";

const useMock = process.env.CLAUDE_VOICE_MOCK === "1";
const projectsRoot = process.env.CLAUDE_VOICE_PROJECTS_ROOT ?? join(homedir(), "projects");

const app = createApp({
  runner: useMock ? createMockRunner() : createCliRunner(),
  quickAsk: useMock ? mockQuickAsk : createCliQuickAsk(),
  taskManager: new TaskManager(useMock ? createMockTaskSpawner() : createCliTaskSpawner()),
  listProjects: () => scanProjects(projectsRoot),
  resolveProject: (name) => resolveProjectPath(projectsRoot, name),
});

// Serve the built client (dist/) when it exists, for `npm run start`.
app.use("/*", serveStatic({ root: "./dist" }));

const port = Number(process.env.PORT ?? 8799);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `claude-voice server: http://localhost:${info.port} (mode: ${useMock ? "mock" : "cli"}, projects: ${projectsRoot})`,
  );
});
