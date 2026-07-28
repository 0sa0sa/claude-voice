import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const task = {
  id: "t1",
  seq: 1,
  project: "claude-voice",
  instruction: "テストを直して",
  status: "succeeded",
  startedAt: Date.now() - 600_000,
  endedAt: Date.now() - 500_000,
  lastEvent: null,
  result: "できました",
  error: null,
  sessionId: "sess-1",
  resumedFrom: null,
};

let chatBlocks: Array<{ event: string; data: unknown }>;

beforeEach(() => {
  vi.restoreAllMocks();
  chatBlocks = [
    { event: "session", data: { sessionId: "s1" } },
    { event: "delta", data: { text: "了解" } },
    { event: "done", data: { text: "了解" } },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) {
        return Response.json({
          projects: [{ name: "claude-voice", hasGit: true, hasPackageJson: true }],
          active: null,
        });
      }
      if (path.includes("/api/tasks")) return Response.json({ tasks: [task] });
      if (path.includes("/api/chat")) return sseResponse(chatBlocks);
      return Response.json({ interject: false, question: "" });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function sendMessage(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByPlaceholderText("キーボードでも話せます"), text);
  await user.click(screen.getByRole("button", { name: "送信" }));
}

describe("UI制御ディレクティブ", () => {
  it("手動トグルでプロジェクトサイドバーを開閉できる", async () => {
    const user = userEvent.setup();
    render(<App />);
    const sidebar = screen.getByRole("complementary", { name: "プロジェクト" });
    const toggle = screen.getByRole("button", { name: "プロジェクトサイドバーを閉じる" });
    expect(sidebar).not.toHaveClass("is-collapsed");
    await user.click(toggle);
    expect(sidebar).toHaveClass("is-collapsed");
    await user.click(screen.getByRole("button", { name: "プロジェクトサイドバーを開く" }));
    expect(sidebar).not.toHaveClass("is-collapsed");
  });

  it("ui_toggle_sidebarディレクティブでサイドバーが閉じる", async () => {
    chatBlocks = [
      { event: "session", data: { sessionId: "s1" } },
      { event: "directive", data: { action: "ui_toggle_sidebar", ok: true, open: false } },
      { event: "done", data: { text: "" } },
    ];
    const user = userEvent.setup();
    render(<App />);
    const sidebar = screen.getByRole("complementary", { name: "プロジェクト" });
    await sendMessage(user, "サイドバーを閉じて");
    await waitFor(() => expect(sidebar).toHaveClass("is-collapsed"));
    // UI制御は無音の演出なので、システムバブルは出さない
    expect(screen.queryByText(/⚙|⚠/)).not.toBeInTheDocument();
  });

  it("ui_highlight_projectディレクティブでプロジェクト行がハイライトされ、時間経過で消える", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
    chatBlocks = [
      { event: "session", data: { sessionId: "s1" } },
      { event: "directive", data: { action: "ui_highlight_project", ok: true, project: "claude-voice" } },
      { event: "done", data: { text: "" } },
    ];
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<App />);
    const sidebar = await screen.findByRole("complementary", { name: "プロジェクト" });
    await sendMessage(user, "claude-voiceを目立たせて");
    const row = await within(sidebar).findByRole("button", { name: /claude-voice/ });
    await waitFor(() => expect(row).toHaveClass("is-highlighted"));
    vi.advanceTimersByTime(3000);
    await waitFor(() => expect(row).not.toHaveClass("is-highlighted"));
  });

  it("ui_focus_taskディレクティブで対象タスクがズームし、時間経過で消える", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
    chatBlocks = [
      { event: "session", data: { sessionId: "s1" } },
      { event: "directive", data: { action: "ui_focus_task", ok: true, taskId: "#1" } },
      { event: "done", data: { text: "" } },
    ];
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await sendMessage(user, "タスク1に注目して");
    const body = await within(panel).findByRole("button", { name: /テストを直して/ });
    const card = body.closest("li");
    await waitFor(() => expect(card).toHaveClass("task-zoom"));
    vi.advanceTimersByTime(1500);
    await waitFor(() => expect(card).not.toHaveClass("task-zoom"));
  });
});
