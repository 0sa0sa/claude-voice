import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app.js";
import {
  createCliQuickAsk,
  createCliRunner,
  createMockRunner,
  mockQuickAsk,
} from "./claudeRunner.js";

const useMock = process.env.CLAUDE_VOICE_MOCK === "1";
const app = createApp(
  useMock
    ? { runner: createMockRunner(), quickAsk: mockQuickAsk }
    : { runner: createCliRunner(), quickAsk: createCliQuickAsk() },
);

// Serve the built client (dist/) when it exists, for `npm run start`.
app.use("/*", serveStatic({ root: "./dist" }));

const port = Number(process.env.PORT ?? 8799);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `claude-voice server: http://localhost:${info.port} (mode: ${useMock ? "mock" : "cli"})`,
  );
});
