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
    instruction: "実行中タスク",
    status: "running",
    startedAt: Date.now() - 60_000,
    lastEvent: null,
    result: null,
    error: null,
    sessionId: "sess-2",
    resumedFrom: null,
  },
];

/** POST /api/tasks(追いタスク起動)のレスポンスを差し替え可能にする */
let followUpResponse: () => Response;

beforeEach(() => {
  vi.restoreAllMocks();
  followUpResponse = () =>
    Response.json(
      {
        id: "t9",
        project: "claude-voice",
        instruction: "続きの指示",
        status: "running",
        startedAt: Date.now(),
        lastEvent: null,
        result: null,
        error: null,
        sessionId: null,
        resumedFrom: "sess-1",
      },
      { status: 201 },
    );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks") && method === "POST") return followUpResponse();
      if (path.includes("/api/tasks")) return Response.json({ tasks });
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

/** タスクカード本文(クリックで選択+展開)を取得する */
async function findTaskBody(name: RegExp) {
  const panel = await screen.findByRole("complementary", { name: "タスク" });
  return within(panel).findByRole("button", { name });
}

describe("追いタスク(タスク選択とフォローアップ指示)", () => {
  it("完了タスクをクリックすると選択され、入力欄付近にチップが出る。再クリックで解除", async () => {
    const user = userEvent.setup();
    render(<App />);
    const body = await findTaskBody(/テストを実行する/);
    await user.click(body);
    // 選択チップとカード上の選択中バッジが出る
    expect(screen.getByText(/追いタスク/)).toBeInTheDocument();
    expect(screen.getByText("選択中")).toBeInTheDocument();
    // チップは口頭で言いやすい連番でタスクを示す(16進IDは出さない)
    expect(screen.getByText(/タスク #1/)).toBeInTheDocument();
    expect(screen.queryByText(/タスク t1/)).not.toBeInTheDocument();
    // もう一度クリックすると選択解除
    await user.click(body);
    expect(screen.queryByText(/追いタスク/)).not.toBeInTheDocument();
  });

  it("実行中タスクのクリックでは選択されない(展開のみ)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const body = await findTaskBody(/実行中タスク/);
    await user.click(body);
    expect(body).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText(/追いタスク/)).not.toBeInTheDocument();
  });

  it("チップの解除ボタンで選択をクリアできる", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await findTaskBody(/テストを実行する/));
    await user.click(screen.getByRole("button", { name: "追いタスクの選択を解除" }));
    expect(screen.queryByText(/追いタスク/)).not.toBeInTheDocument();
  });

  it("選択中に送信すると、チャットではなく resume 付きで追いタスクが起動される", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await findTaskBody(/テストを実行する/));
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "続きの指示");
    await user.click(screen.getByRole("button", { name: "送信" }));

    // resume=t1 で POST /api/tasks が呼ばれる
    await waitFor(() => {
      const post = vi
        .mocked(fetch)
        .mock.calls.find(
          (c) => String(c[0]).includes("/api/tasks") && c[1]?.method === "POST",
        );
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
        resume: "t1",
        instruction: "続きの指示",
      });
    });
    // チャットレーンには送られない
    const chatCalls = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes("/api/chat"));
    expect(chatCalls).toHaveLength(0);
    // 開始のシステムバブルは連番でタスクを示し、選択は自動解除される
    await screen.findByText(/タスク #1 を引き継いで追いタスクを開始しました/);
    expect(screen.queryByText(/追いタスク:/)).not.toBeInTheDocument();
  });

  it("追いタスクの起動に失敗したらエラーを表示し、選択は保持する", async () => {
    followUpResponse = () =>
      Response.json({ error: "タスク t1 には引き継げるセッションがありません" }, { status: 400 });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await findTaskBody(/テストを実行する/));
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "続きの指示");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText(/⚠ タスク t1 には引き継げるセッションがありません/);
    // 失敗時は選択を保持して再試行できる
    expect(screen.getByText(/追いタスク/)).toBeInTheDocument();
  });
});
