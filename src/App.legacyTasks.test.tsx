import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

/**
 * 旧サーバーの /api/tasks は seq / sessionId をそのまま含まない。
 * 新フロントがそのペイロードを受けても「タスク #undefined」を表示したり、
 * 引き継げないタスクを追いタスクの宛先に選ばせたりしないことを保証する。
 */

// 旧形式: seq / sessionId / resumedFrom キーが存在しない
const legacyTasks = [
  {
    id: "0f3c9a7e-1234-4abc-9def-000000000001",
    project: "claude-voice",
    instruction: "レガシー完了タスク",
    status: "succeeded",
    startedAt: Date.now() - 120_000,
    endedAt: Date.now() - 60_000,
    lastEvent: null,
    result: "done",
    error: null,
  },
  {
    id: "77aa88bb-0000-4abc-9def-000000000002",
    project: "claude-voice",
    instruction: "レガシー実行中タスク",
    status: "running",
    startedAt: Date.now() - 60_000,
    lastEvent: null,
    result: null,
    error: null,
  },
  {
    // 移行期: セッションは残っているが連番が無いタスク
    id: "55cc66dd-0000-4abc-9def-000000000003",
    project: "claude-voice",
    instruction: "セッション付きレガシータスク",
    status: "succeeded",
    startedAt: Date.now() - 90_000,
    endedAt: Date.now() - 30_000,
    lastEvent: null,
    result: "done",
    error: null,
    sessionId: "sess-legacy",
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/instructions") && method === "POST") return Response.json({ ok: true });
      if (path.includes("/api/tasks") && method === "POST") {
        return Response.json({ id: "t9", project: "claude-voice", status: "running" }, { status: 201 });
      }
      if (path.includes("/api/tasks")) return Response.json({ tasks: legacyTasks });
      return Response.json({ interject: false, question: "" });
    }),
  );
});

async function findTaskBody(name: RegExp) {
  const panel = await screen.findByRole("complementary", { name: "タスク" });
  return within(panel).findByRole("button", { name });
}

describe("旧サーバー形式(seq/sessionId無し)のタスクへの耐性", () => {
  it("sessionIdキーの無い完了タスクはクリックしても追いタスクの宛先にならない", async () => {
    const user = userEvent.setup();
    render(<App />);
    const body = await findTaskBody(/レガシー完了タスク/);
    await user.click(body);
    // undefined を「セッションあり」と誤認すると、引き継げないのに resume 対象になってしまう
    expect(screen.queryByText(/追いタスク/)).not.toBeInTheDocument();
    expect(screen.queryByText("選択中")).not.toBeInTheDocument();
  });

  it("連番の無いタスクを選択して追いタスクを開始しても「#undefined」と表示しない", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await findTaskBody(/セッション付きレガシータスク/));
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "続きの指示");
    await user.click(screen.getByRole("button", { name: "送信" }));
    // 開始報告は短縮IDでタスクを示す
    await screen.findByText(/タスク 55cc66dd を引き継いで追いタスクを開始しました/);
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("連番の無い実行中タスクへの追加指示の報告も「#undefined」と表示しない", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await findTaskBody(/レガシー実行中タスク/));
    expect(screen.getByText(/追加指示の宛先/)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "追加の指示");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText(/タスク 77aa88bb に追加指示を送りました/);
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });
});
