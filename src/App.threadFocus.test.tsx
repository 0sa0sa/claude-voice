import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const now = Date.now();

const t1 = {
  id: "t1",
  seq: 1,
  project: "claude-voice",
  instruction: "テストを回して",
  status: "succeeded",
  startedAt: now - 500_000,
  endedAt: now - 400_000,
  lastEvent: null,
  result: "1回目OK",
  error: null,
  sessionId: "sess-1",
  resumedFrom: null,
};

// t1の追いタスク(resumedFromがt1のセッションを指す)
const t2 = {
  id: "t2",
  seq: 2,
  project: "claude-voice",
  instruction: "続きでlintも直して",
  status: "succeeded",
  startedAt: now - 300_000,
  endedAt: now - 200_000,
  lastEvent: null,
  result: "lintも通りました",
  error: null,
  sessionId: "sess-2",
  resumedFrom: "sess-1",
};

const t3 = {
  id: "t3",
  seq: 3,
  project: "hojokin-navi",
  instruction: "ビルドを直す",
  status: "running",
  startedAt: now - 60_000,
  lastEvent: null,
  result: null,
  error: null,
  sessionId: null,
  resumedFrom: null,
};

// セッションを残さず終わったタスク(フォーカス不可)
const t4 = {
  id: "t4",
  seq: 4,
  project: "claude-voice",
  instruction: "セッションなしタスク",
  status: "succeeded",
  startedAt: now - 700_000,
  endedAt: now - 600_000,
  lastEvent: null,
  result: null,
  error: null,
  sessionId: null,
  resumedFrom: null,
};

const detailEvents: Record<string, Array<{ kind: string; text: string; at: number }>> = {
  t1: [
    { kind: "instruction", text: "READMEも更新して", at: now - 450_000 },
    { kind: "tool", text: "Bash", at: now - 440_000 },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.endsWith("/instructions") && method === "POST") return Response.json({ ok: true });
      const detail = /\/api\/tasks\/([a-z0-9]+)$/.exec(path);
      if (detail && method === "GET") {
        const task = [t1, t2, t3, t4].find((t) => t.id === detail[1]);
        return Response.json({ ...task, events: detailEvents[detail[1]] ?? [] });
      }
      if (path.includes("/api/tasks")) return Response.json({ tasks: [t1, t2, t3, t4] });
      return Response.json({ interject: false, question: "" });
    }),
  );
});

async function findTaskBody(name: RegExp) {
  const panel = await screen.findByRole("complementary", { name: "タスク" });
  return within(panel).findByRole("button", { name });
}

describe("タスクスレッドビュー", () => {
  it("タスクをタップするとスレッドが開き、指示・追加指示・結果・追いタスクを時系列で表示する", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await findTaskBody(/テストを回して/));

    const region = await screen.findByRole("region", { name: "タスク #1 のスレッド" });
    // 追加指示はイベント詳細APIから遅れて届く
    await within(region).findByText("READMEも更新して");
    const items = within(region).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("指示");
    expect(items[0]).toHaveTextContent("テストを回して");
    expect(items[1]).toHaveTextContent("追加指示");
    expect(items[1]).toHaveTextContent("READMEも更新して");
    expect(items[2]).toHaveTextContent("結果");
    expect(items[2]).toHaveTextContent("1回目OK");
    // 追いタスク(t2)も同じスレッドに時系列で混ざり、連番で区別できる
    expect(items[3]).toHaveTextContent("#2");
    expect(items[3]).toHaveTextContent("続きでlintも直して");
    expect(items[4]).toHaveTextContent("lintも通りました");
  });

  it("スレッドを閉じるとフォーカスも解除される", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await findTaskBody(/テストを回して/));
    await screen.findByRole("region", { name: "タスク #1 のスレッド" });
    await user.click(screen.getByRole("button", { name: "スレッドを閉じる" }));
    expect(screen.queryByRole("region", { name: /のスレッド/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/追いタスク:/)).not.toBeInTheDocument();
  });
});

describe("タスクフォーカスの導線", () => {
  it("実行中タスクをタップすると追加指示の宛先になり、送信は追加指示APIへ行く", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await findTaskBody(/ビルドを直す/));
    // フォーカス中はどのタスク宛かが画面に明示される
    expect(screen.getByText(/追加指示の宛先:/)).toBeInTheDocument();
    expect(screen.getByText(/タスク #3/)).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "テストも足して");
    await user.click(screen.getByRole("button", { name: "送信" }));

    await waitFor(() => {
      const call = vi
        .mocked(fetch)
        .mock.calls.find(([u]) => String(u).includes("/api/tasks/t3/instructions"));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toEqual({ text: "テストも足して" });
    });
    await screen.findByText(/タスク #3 に追加指示を送りました/);
    // チャットには送られず、送信後にフォーカスは外れる
    expect(vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/api/chat"))).toHaveLength(0);
    expect(screen.queryByText(/追加指示の宛先:/)).not.toBeInTheDocument();
  });

  it("「タスク1」という発話でフォーカスでき、チャットには送られない", async () => {
    const user = userEvent.setup();
    render(<App />);
    await findTaskBody(/テストを回して/);
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "タスク1");
    await user.click(screen.getByRole("button", { name: "送信" }));

    await screen.findByText(/タスク #1 にフォーカスしました/);
    expect(screen.getByText(/追いタスク:/)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/api/chat"))).toHaveLength(0);
  });

  it("「選択解除」という発話でフォーカスが外れる", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await findTaskBody(/テストを回して/));
    expect(screen.getByText(/追いタスク:/)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "選択解除");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(screen.queryByText(/追いタスク:/)).not.toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/api/chat"))).toHaveLength(0);
  });

  it("セッションのない完了タスクへの発話フォーカスは断り、チャットにも送らない", async () => {
    const user = userEvent.setup();
    render(<App />);
    await findTaskBody(/セッションなしタスク/);
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "タスク4");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await screen.findByText(/⚠ タスク #4 には指示を送れません/);
    expect(screen.queryByText(/追いタスク:/)).not.toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/api/chat"))).toHaveLength(0);
  });
});
