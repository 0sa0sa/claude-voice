import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const runningTask = {
  id: "t1",
  seq: 1,
  project: "claude-voice",
  instruction: "テストを直して",
  status: "running",
  startedAt: Date.now() - 60_000,
  endedAt: null,
  lastEvent: null,
  result: null,
  error: null,
  sessionId: null,
  resumedFrom: null,
  worktreePath: null,
  branch: null,
  worktreeNote: null,
};

const finishedTask = {
  ...runningTask,
  id: "t2",
  seq: 2,
  instruction: "完了済みの作業",
  status: "succeeded",
  endedAt: Date.now() - 30_000,
  result: "できました",
  sessionId: "sess-2",
};

/** 実行中タスクの詳細(途中経過)。テスト中に差し替えてポーリング更新を再現する */
let runningDetail: Record<string, unknown>;

beforeEach(() => {
  localStorage.clear();
  runningDetail = {
    ...runningTask,
    events: [
      { kind: "tool", text: "Edit: src/App.tsx", at: Date.now() },
      { kind: "tool", text: "Bash: npm test", at: Date.now() },
    ],
    liveText: "テストを実行しています…",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks/t1")) return Response.json(runningDetail);
      if (path.includes("/api/tasks/t2"))
        return Response.json({ ...finishedTask, events: [], liveText: null });
      if (path.includes("/api/tasks"))
        return Response.json({ tasks: [runningTask, finishedTask] });
      return Response.json({ interject: false, question: "" });
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("実行中タスクの途中経過表示", () => {
  it("実行中タスクを選ぶと直近のツール実行と最新出力が見える", async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await user.click(await within(panel).findByRole("button", { name: /テストを直して/ }));

    const progress = await screen.findByRole("group", { name: "途中経過" });
    expect(within(progress).getByText("Edit: src/App.tsx")).toBeInTheDocument();
    expect(within(progress).getByText("Bash: npm test")).toBeInTheDocument();
    expect(within(progress).getByText("テストを実行しています…")).toBeInTheDocument();
  });

  it("ポーリングで最新の途中経過に自動更新される", async () => {
    vi.useFakeTimers();
    // RTLのwaitFor/findBy*はjestグローバル経由でしかfake timersを進められないため橋渡しする
    vi.stubGlobal("jest", {
      advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
    });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await user.click(await within(panel).findByRole("button", { name: /テストを直して/ }));
    await screen.findByText("テストを実行しています…");

    runningDetail = {
      ...runningDetail,
      events: [...(runningDetail.events as unknown[]), { kind: "tool", text: "Bash: npm run lint", at: Date.now() }],
      liveText: "3件のテストが通りました",
    };
    // タスク一覧の3秒ポーリングに合わせて途中経過も再取得される
    await act(async () => {
      vi.advanceTimersByTime(3100);
    });
    await screen.findByText("3件のテストが通りました");
    expect(screen.getByText("Bash: npm run lint")).toBeInTheDocument();
  });

  it("完了済みタスクには途中経過を出さない", async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await user.click(await within(panel).findByRole("button", { name: /完了済みの作業/ }));
    expect(screen.queryByRole("group", { name: "途中経過" })).not.toBeInTheDocument();
  });
});
