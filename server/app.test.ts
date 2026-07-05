import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { ChatRunner, QuickAsk } from "./types.js";

function mockRunner(opts?: { fail?: boolean }): ChatRunner {
  return {
    mode: "mock",
    async run({ prompt, resumeSessionId, onEvent }) {
      if (opts?.fail) throw new Error("claude CLI not found");
      const sessionId = resumeSessionId ?? "sess-1";
      onEvent({ kind: "session", sessionId });
      onEvent({ kind: "delta", text: "了解:" });
      onEvent({ kind: "delta", text: prompt.slice(0, 5) });
      onEvent({ kind: "result", text: `了解:${prompt.slice(0, 5)}`, sessionId });
      return { sessionId, text: `了解:${prompt.slice(0, 5)}` };
    },
  };
}

const quickAskNone: QuickAsk = async () => "NONE";

function makeApp(runner = mockRunner(), quickAsk = quickAskNone) {
  return createApp({ runner, quickAsk });
}

async function readSSE(res: Response): Promise<Array<{ event: string; data: string }>> {
  const text = await res.text();
  const events: Array<{ event: string; data: string }> = [];
  for (const block of text.split("\n\n")) {
    const ev = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    if (ev && data !== undefined) events.push({ event: ev, data });
  }
  return events;
}

describe("GET /api/health", () => {
  it("reports ok and runner mode", async () => {
    const res = await makeApp().request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, mode: "mock" });
  });
});

describe("POST /api/chat", () => {
  it("streams session, deltas, and done via SSE", async () => {
    const res = await makeApp().request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browserSessionId: "b1", message: "こんにちは、テストです" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSSE(res);
    const kinds = events.map((e) => e.event);
    expect(kinds[0]).toBe("session");
    expect(kinds).toContain("delta");
    expect(kinds[kinds.length - 1]).toBe("done");
    const deltas = events.filter((e) => e.event === "delta").map((e) => JSON.parse(e.data).text);
    expect(deltas.join("")).toBe("了解:こんにちは");
  });

  it("resumes the claude session for the same browser session", async () => {
    const seen: Array<string | undefined> = [];
    const runner: ChatRunner = {
      mode: "mock",
      async run({ resumeSessionId, onEvent }) {
        seen.push(resumeSessionId);
        onEvent({ kind: "session", sessionId: "sess-9" });
        onEvent({ kind: "result", text: "ok", sessionId: "sess-9" });
        return { sessionId: "sess-9", text: "ok" };
      },
    };
    const app = createApp({ runner, quickAsk: quickAskNone });
    const post = (msg: string) =>
      app.request("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ browserSessionId: "b2", message: msg }),
      });
    await (await post("一回目")).text();
    await (await post("二回目")).text();
    expect(seen).toEqual([undefined, "sess-9"]);
  });

  it("rejects missing message", async () => {
    const res = await makeApp().request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browserSessionId: "b1" }),
    });
    expect(res.status).toBe(400);
  });

  it("emits an SSE error event when the runner fails", async () => {
    const res = await makeApp(mockRunner({ fail: true })).request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browserSessionId: "b1", message: "hi" }),
    });
    const events = await readSSE(res);
    expect(events.some((e) => e.event === "error")).toBe(true);
  });
});

describe("POST /api/interject", () => {
  it("returns interjection for vague transcripts and tracks seen triggers", async () => {
    const app = makeApp();
    const body = {
      browserSessionId: "b3",
      transcript: "例のダッシュボードをいい感じにしたいんだけど",
    };
    const res = await app.request("/api/interject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { interject: boolean; question: string };
    expect(json.interject).toBe(true);
    expect(typeof json.question).toBe("string");

    // same trigger again → suppressed server-side
    const res2 = await app.request("/api/interject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(((await res2.json()) as { interject: boolean }).interject).toBe(false);
  });

  it("returns no interjection for clear transcripts", async () => {
    const res = await makeApp().request("/api/interject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ browserSessionId: "b4", transcript: "ログイン画面を作りたいです" }),
    });
    expect(((await res.json()) as { interject: boolean }).interject).toBe(false);
  });
});
