import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks: [] });
      if (path.includes("/api/chat")) {
        return sseResponse([
          { event: "session", data: { sessionId: "s1" } },
          { event: "done", data: { text: "了解" } },
        ]);
      }
      return Response.json({ interject: false, question: "" });
    }),
  );
});

const chatCalls = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/chat"));

const draftInput = () => screen.getByPlaceholderText("キーボードでも話せます");

describe("IME変換中のEnterで送信しない(draft入力)", () => {
  it("compositionstart後の変換確定Enter(isComposing)では送信しない", async () => {
    render(<App />);
    const input = draftInput();
    fireEvent.change(input, { target: { value: "こんにちは" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.compositionEnd(input);
    expect(chatCalls()).toHaveLength(0);
    expect(input).toHaveValue("こんにちは"); // 入力は残ったまま
  });

  it("keyCode 229 のEnter(isComposing未対応ブラウザのフォールバック)でも送信しない", async () => {
    render(<App />);
    const input = draftInput();
    fireEvent.change(input, { target: { value: "こんにちは" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(chatCalls()).toHaveLength(0);
    expect(input).toHaveValue("こんにちは");
  });

  it("compositionend後の通常のEnterでは送信する", async () => {
    render(<App />);
    const input = draftInput();
    fireEvent.change(input, { target: { value: "こんにちは" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", keyCode: 13 });
    await waitFor(() => expect(chatCalls()).toHaveLength(1));
  });
});

describe("IME変換中のEnterで送信しない(認識テキストのtextarea)", () => {
  it("keyCode 229 のEnterでは送信しない", async () => {
    render(<App />);
    const textarea = screen.getByRole("textbox", { name: "認識テキスト(編集できます)" });
    fireEvent.change(textarea, { target: { value: "東京の天気" } });
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(chatCalls()).toHaveLength(0);
  });
});
