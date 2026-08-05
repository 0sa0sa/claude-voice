import { render, screen, waitFor, within } from "@testing-library/react";
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
  it("renders the title, health mode, and the project sidebar", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "claude-voice" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("モックモード")).toBeInTheDocument());
    const sidebar = screen.getByRole("complementary", { name: "プロジェクト" });
    await waitFor(() =>
      expect(within(sidebar).getByRole("button", { name: "hojokin-navi" })).toBeInTheDocument(),
    );
    expect(within(sidebar).getByRole("button", { name: "すべてのタスク" })).toBeInTheDocument();
  });

  it("always shows the task sidebar with an empty message when there are no tasks", async () => {
    render(<App />);
    const panel = screen.getByRole("complementary", { name: "タスク" });
    await waitFor(() =>
      expect(within(panel).getByText("タスクはまだありません")).toBeInTheDocument(),
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

  it("shows the full task result without truncation", async () => {
    const longResult = `全テストが通りました。${"詳細な変更内容の説明が続きます。".repeat(15)}以上です。`;
    expect(longResult.length).toBeGreaterThan(120); // 旧実装の切り詰め幅より長いことを保証
    const tasks = [
      {
        id: "t1",
        seq: 1,
        project: "hojokin-navi",
        instruction: "テストを回して",
        status: "succeeded",
        startedAt: Date.now() - 120_000,
        endedAt: Date.now() - 60_000,
        lastEvent: null,
        result: longResult,
        error: null,
      },
    ];
    const baseFetch = vi.mocked(fetch);
    baseFetch.mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return Response.json({ interject: false, question: "" });
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText(longResult)).toBeInTheDocument());
  });

  it("shows project badges and status labels on task cards", async () => {
    const tasks = [
      {
        id: "t1",
        seq: 1,
        project: "claude-voice",
        instruction: "テストを実行する",
        status: "running",
        startedAt: Date.now() - 60_000,
        lastEvent: "npm test",
        result: null,
        error: null,
      },
      {
        id: "t2",
        seq: 2,
        project: "hojokin-navi",
        instruction: "ビルドを修正する",
        status: "failed",
        startedAt: Date.now() - 120_000,
        endedAt: Date.now() - 60_000,
        lastEvent: null,
        result: null,
        error: "build error",
      },
    ];
    vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return Response.json({ interject: false, question: "" });
    });
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    expect(within(panel).getByText("claude-voice")).toBeInTheDocument();
    expect(within(panel).getByText("hojokin-navi")).toBeInTheDocument();
    expect(within(panel).getByText("実行中")).toBeInTheDocument();
    expect(within(panel).getByText("失敗")).toBeInTheDocument();
    expect(within(panel).getByText("build error")).toBeInTheDocument();
    // 状態ごとの件数サマリで全体の状況が一目で分かる
    expect(within(panel).getByText("1 実行中")).toBeInTheDocument();
    expect(within(panel).getByText("1 失敗")).toBeInTheDocument();
  });

  it("shows the task's sequence badge as the primary id on task cards", async () => {
    const tasks = [
      {
        id: "0a18faeb-aaaa-bbbb-cccc-dddddddddddd",
        seq: 7,
        project: "claude-voice",
        instruction: "テストを実行する",
        status: "running",
        startedAt: Date.now() - 60_000,
        lastEvent: null,
        result: null,
        error: null,
      },
    ];
    vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return Response.json({ interject: false, question: "" });
    });
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    expect(within(panel).getByTestId("task-seq-badge-7")).toHaveTextContent("#7");
    expect(within(panel).getByText("0a18faeb")).toBeInTheDocument();
  });

  it("falls back to the short id when a legacy server response omits seq", async () => {
    // 古いバージョンのまま起動し続けているサーバープロセスは seq を返さないことがある
    // (関連: docs参照。稼働中プロセスのコードは再起動するまで更新されない)。
    // そのケースでもタスクカードに識別子が全く出ないと困るため、短縮IDへのフォールバックを保証する。
    const tasks = [
      {
        id: "0a18faeb-aaaa-bbbb-cccc-dddddddddddd",
        project: "claude-voice",
        instruction: "テストを実行する",
        status: "running",
        startedAt: Date.now() - 60_000,
        lastEvent: null,
        result: null,
        error: null,
      },
    ];
    vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return Response.json({ interject: false, question: "" });
    });
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    expect(within(panel).queryByTestId(/task-seq-badge-/)).not.toBeInTheDocument();
    expect(within(panel).getByText("0a18faeb")).toBeInTheDocument();
  });

  it("filters tasks by project from the sidebar and switches the workspace", async () => {
    const tasks = [
      {
        id: "t1",
        seq: 1,
        project: "claude-voice",
        instruction: "テストを実行する",
        status: "running",
        startedAt: Date.now() - 60_000,
        lastEvent: null,
        result: null,
        error: null,
      },
      {
        id: "t2",
        seq: 2,
        project: "hojokin-navi",
        instruction: "ビルドを修正する",
        status: "succeeded",
        startedAt: Date.now() - 120_000,
        endedAt: Date.now() - 60_000,
        lastEvent: null,
        result: null,
        error: null,
      },
    ];
    const baseImpl = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return baseImpl(url as RequestInfo, init);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("テストを実行する");
    expect(screen.getByText("ビルドを修正する")).toBeInTheDocument();

    const sidebar = screen.getByRole("complementary", { name: "プロジェクト" });
    await user.click(within(sidebar).getByRole("button", { name: /hojokin-navi/ }));

    await waitFor(() => expect(screen.queryByText("テストを実行する")).not.toBeInTheDocument());
    expect(screen.getByText("ビルドを修正する")).toBeInTheDocument();
    // 絞り込みと同時にワークスペースも切り替わる
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes("/api/workspace"))).toBe(true);
    // 絞り込み解除チップで全件表示に戻る
    await user.click(screen.getByRole("button", { name: "hojokin-navi の絞り込みを解除" }));
    await screen.findByText("テストを実行する");
  });

  it("offers a resume button only on finished tasks that kept a session", async () => {
    const tasks = [
      {
        id: "t1",
        seq: 1,
        project: "claude-voice",
        instruction: "テストを実行する",
        status: "succeeded",
        startedAt: Date.now() - 120_000,
        endedAt: Date.now() - 60_000,
        lastEvent: null,
        result: "done",
        error: null,
        sessionId: "sess-1",
        resumedFrom: null,
      },
      {
        id: "t2",
        seq: 2,
        project: "claude-voice",
        instruction: "セッションなしタスク",
        status: "succeeded",
        startedAt: Date.now() - 120_000,
        endedAt: Date.now() - 60_000,
        lastEvent: null,
        result: null,
        error: null,
        sessionId: null,
        resumedFrom: null,
      },
      {
        id: "t3",
        seq: 3,
        project: "claude-voice",
        instruction: "実行中タスク",
        status: "running",
        startedAt: Date.now() - 60_000,
        lastEvent: null,
        result: null,
        error: null,
        sessionId: "sess-3",
        resumedFrom: null,
      },
    ];
    vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return Response.json({ interject: false, question: "" });
    });
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    // セッション有りの完了タスクにだけ表示。実行中(t3)とセッション無し(t2)には出ない
    const buttons = within(panel).getAllByRole("button", { name: "続きを依頼" });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[0]);
    // 入力欄に連番つきの依頼文がプレフィルされ、続きを話すだけで送れる
    expect(screen.getByPlaceholderText("キーボードでも話せます")).toHaveValue(
      "タスク #1 の続きをお願い: ",
    );
  });

  it("renders the TTS rate selector with the faster default", async () => {
    render(<App />);
    const select = screen.getByRole("combobox", { name: "読み上げ速度" });
    expect(select).toHaveValue("1.2");
  });

  it("silently patches the user bubble when a fix_transcript directive arrives", async () => {
    chatBlocks = [
      { event: "session", data: { sessionId: "s1" } },
      { event: "delta", data: { text: "テンポの件ですね" } },
      { event: "directive", data: { action: "fix_transcript", ok: true, corrected: "テンポが大事" } },
      { event: "done", data: { text: "テンポの件ですね" } },
    ];
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "店舗が大事");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(screen.getByText("テンポが大事")).toBeInTheDocument());
    expect(screen.queryByText("店舗が大事")).not.toBeInTheDocument();
    // 補正はシステムバブルや読み上げを伴わない
    expect(screen.queryByText(/⚙|⚠/)).not.toBeInTheDocument();
  });

  it("pins running tasks above finished ones under grouped section headers", async () => {
    const tasks = [
      {
        id: "t1",
        project: "claude-voice",
        instruction: "終わったタスク",
        status: "succeeded",
        startedAt: Date.now() - 60_000,
        endedAt: Date.now() - 30_000,
        lastEvent: null,
        result: null,
        error: null,
      },
      {
        id: "t2",
        project: "claude-voice",
        instruction: "動いているタスク",
        status: "running",
        startedAt: Date.now() - 600_000,
        lastEvent: null,
        result: null,
        error: null,
      },
    ];
    vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return Response.json({ interject: false, question: "" });
    });
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("動いているタスク");
    // 完了が新しくても、実行中タスクのカードが常に先に並ぶ
    const items = within(panel).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("動いているタスク");
    expect(items[1]).toHaveTextContent("終わったタスク");
    expect(within(panel).getByText("実行中のタスク")).toBeInTheDocument();
    expect(within(panel).getByText("完了済み")).toBeInTheDocument();
  });

  it("collapses and re-expands the finished section from its header", async () => {
    const tasks = [
      {
        id: "t1",
        project: "claude-voice",
        instruction: "終わったタスク",
        status: "succeeded",
        startedAt: Date.now() - 60_000,
        endedAt: Date.now() - 30_000,
        lastEvent: null,
        result: null,
        error: null,
      },
      {
        id: "t2",
        project: "claude-voice",
        instruction: "動いているタスク",
        status: "running",
        startedAt: Date.now() - 600_000,
        lastEvent: null,
        result: null,
        error: null,
      },
    ];
    vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return Response.json({ interject: false, question: "" });
    });
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("終わったタスク");
    const header = within(panel).getByRole("button", { name: /完了済み/ });
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.click(header);
    // 折りたたむと完了済みだけ隠れ、実行中は見えたまま
    expect(within(panel).queryByText("終わったタスク")).not.toBeInTheDocument();
    expect(within(panel).getByText("動いているタスク")).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "false");
    await user.click(header);
    expect(within(panel).getByText("終わったタスク")).toBeInTheDocument();
  });

  it("expands a task card body on click to reveal clamped text", async () => {
    const tasks = [
      {
        id: "t1",
        project: "claude-voice",
        instruction: "とても長い指示文",
        status: "succeeded",
        startedAt: Date.now() - 60_000,
        endedAt: Date.now() - 30_000,
        lastEvent: null,
        result: "長い結果テキスト",
        error: null,
      },
    ];
    vi.mocked(fetch).mockImplementation(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return Response.json({ interject: false, question: "" });
    });
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    const body = await within(panel).findByRole("button", { name: /とても長い指示文/ });
    // 折りたたみ中は本文が省略表示(クリックで全文に展開)
    expect(body).toHaveAttribute("aria-expanded", "false");
    await user.click(body);
    expect(body).toHaveAttribute("aria-expanded", "true");
    await user.click(body);
    expect(body).toHaveAttribute("aria-expanded", "false");
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
