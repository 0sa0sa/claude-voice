import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { decideInterjection } from "./interjection.js";
import { SessionStore } from "./sessions.js";
import type { ChatRunner, ClaudeEvent, QuickAsk } from "./types.js";

export interface AppDeps {
  runner: ChatRunner;
  quickAsk: QuickAsk;
}

const SYSTEM_STYLE = [
  "あなたは音声会話で要件定義を手伝うアシスタント。回答は音声で読み上げられる。",
  "簡潔に、話し言葉で、3文以内を基本に答えて。箇条書きや記号、コードブロックは使わない。",
  "曖昧な点があれば1つだけ確認質問をして。",
].join("");

export function createApp(deps: AppDeps) {
  const app = new Hono();
  const sessions = new SessionStore();

  app.get("/api/health", (c) => c.json({ ok: true, mode: deps.runner.mode }));

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
          prompt: message,
          systemPrompt: SYSTEM_STYLE,
          resumeSessionId: session.claudeSessionId,
          onEvent,
        });
        if (result.sessionId) session.claudeSessionId = result.sessionId;
        await send("done", { text: result.text });
      } catch (err) {
        await send("error", { message: err instanceof Error ? err.message : String(err) });
      }
    });
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
