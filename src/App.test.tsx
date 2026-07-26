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
  chatBlocks = [
    { event: "session", data: { sessionId: "s1" } },
    { event: "delta", data: { text: "こんにちは" } },
    { event: "done", data: { text: "こんにちは" } },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) {
        return Response.json({
          projects: [
            { name: "claude-voice", hasGit: true, hasPackageJson: true },
            { name: "hojokin-navi", hasGit: true, hasPackageJson: true },
          ],
          active: null,
        });
      }
      if (path.includes("/api/tasks")) return Response.json({ tasks: [] });
      if (path.includes("/api/workspace")) return Response.json({ ok: true, active: "claude-voice" });
      if (path.includes("/api/chat")) return sseResponse(chatBlocks);
      return Response.json({ interject: false, question: "" });
    }),
  );
});

describe("App", () => {
  it("renders the title, health mode, and project options", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "claude-voice" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("モックモード")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "hojokin-navi" })).toBeInTheDocument(),
    );
  });

  it("disables the mic button when speech recognition is unsupported", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "マイクを開始" })).toBeDisabled();
  });

  it("sends a typed message and streams the reply", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "テスト送信");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(screen.getByText("テスト送信")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("こんにちは")).toBeInTheDocument());
  });

  it("shows a system bubble when the orchestrator executes a directive", async () => {
    chatBlocks = [
      { event: "session", data: { sessionId: "s1" } },
      { event: "delta", data: { text: "回しますね" } },
      {
        event: "directive",
        data: {
          action: "start_task",
          ok: true,
          taskId: "t1",
          project: "hojokin-navi",
          detail: "hojokin-navi でタスクを開始しました",
        },
      },
      { event: "done", data: { text: "回しますね" } },
    ];
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "テスト回して");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() =>
      expect(screen.getByText(/hojokin-navi でタスクを開始しました/)).toBeInTheDocument(),
    );
  });
});
