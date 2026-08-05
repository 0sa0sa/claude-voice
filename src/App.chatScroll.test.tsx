import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function sseResponse(blocks: Array<{ event: string; data: unknown }>): Response {
  const body = blocks
    .map((b) => `event: ${b.event}\ndata: ${JSON.stringify(b.data)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

let chatBlocks: Array<{ event: string; data: unknown }>;

beforeEach(() => {
  vi.restoreAllMocks();
  chatBlocks = [{ event: "session", data: { sessionId: "s1" } }];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks: [] });
      if (path.includes("/api/workspace")) return Response.json({ ok: true, active: "claude-voice" });
      if (path.includes("/api/chat")) return sseResponse(chatBlocks);
      return Response.json({ interject: false, question: "" });
    }),
  );
});

describe("chat auto-scroll", () => {
  it("scrolls the user's own bubble into view from its top, instead of always snapping the log to the very bottom", async () => {
    const scrollIntoView = vi.fn();
    const scrollTo = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    HTMLElement.prototype.scrollTo = scrollTo as unknown as typeof HTMLElement.prototype.scrollTo;

    const longReply = "とても長い返信です。".repeat(50);
    chatBlocks = [
      { event: "session", data: { sessionId: "s1" } },
      { event: "delta", data: { text: longReply } },
      { event: "done", data: { text: longReply } },
    ];

    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "こんにちは");
    await user.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => expect(screen.getByText("こんにちは")).toBeInTheDocument());
    // 発言直後、自分の発言バブルの先頭が見える位置へスクロールされる
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));

    await waitFor(() => expect(screen.getByText(longReply)).toBeInTheDocument());
    // アシスタントの返信がストリーミングで伸びても、それだけを理由に
    // コンテナ全体を一番下まで再スクロールして自分の発言を押し流したりしない
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
