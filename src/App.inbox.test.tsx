import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const ACKED_KEY = "cv-acked-task-ids";

const tasks = [
  {
    id: "t1",
    seq: 1,
    project: "claude-voice",
    instruction: "実行中タスク",
    status: "running",
    startedAt: Date.now() - 60_000,
    lastEvent: null,
    result: null,
    error: null,
    sessionId: null,
    resumedFrom: null,
  },
  {
    id: "t2",
    seq: 2,
    project: "claude-voice",
    instruction: "成功したタスク",
    status: "succeeded",
    startedAt: Date.now() - 300_000,
    endedAt: Date.now() - 200_000,
    lastEvent: null,
    result: "done",
    error: null,
    sessionId: "sess-2",
    resumedFrom: null,
  },
  {
    id: "t3",
    seq: 3,
    project: "hojokin-navi",
    instruction: "失敗したタスク",
    status: "failed",
    startedAt: Date.now() - 400_000,
    endedAt: Date.now() - 350_000,
    lastEvent: null,
    result: null,
    error: "build error",
    sessionId: "sess-3",
    resumedFrom: null,
  },
  {
    id: "t4",
    seq: 4,
    project: "claude-voice",
    instruction: "中止したタスク",
    status: "cancelled",
    startedAt: Date.now() - 500_000,
    endedAt: Date.now() - 450_000,
    lastEvent: null,
    result: null,
    error: null,
    sessionId: null,
    resumedFrom: null,
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      return Response.json({ interject: false, question: "" });
    }),
  );
});

describe("要対応の受信箱", () => {
  it("結果が未確認の完了/失敗タスクに要対応バッジが付く(実行中・中止には付かない)", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("成功したタスク");
    expect(within(panel).getAllByText("要対応")).toHaveLength(2);
    // サマリにも要対応の件数チップが出る
    expect(within(panel).getByRole("button", { name: "要対応 2" })).toBeInTheDocument();
  });

  it("タスクをタップすると確認済みになり、バッジが消えて保存される", async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await user.click(await within(panel).findByRole("button", { name: /成功したタスク/ }));
    await waitFor(() => expect(within(panel).getAllByText("要対応")).toHaveLength(1));
    expect(within(panel).getByRole("button", { name: "要対応 1" })).toBeInTheDocument();
    // リロード後も確認済みが引き継がれるようlocalStorageに保存する
    expect(JSON.parse(localStorage.getItem(ACKED_KEY) ?? "[]")).toContain("t2");
  });

  it("確認済みとして保存されたタスクは初期表示から要対応にしない", async () => {
    localStorage.setItem(ACKED_KEY, JSON.stringify(["t2", "t3"]));
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("成功したタスク");
    expect(within(panel).queryByText("要対応")).not.toBeInTheDocument();
  });

  it("要対応チップで未確認タスクだけの受信箱表示に絞り込める", async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("成功したタスク");
    await user.click(within(panel).getByRole("button", { name: "要対応 2" }));
    // 未確認の完了/失敗だけが残り、実行中・中止は隠れる
    expect(within(panel).queryByText("実行中タスク")).not.toBeInTheDocument();
    expect(within(panel).queryByText("中止したタスク")).not.toBeInTheDocument();
    expect(within(panel).getByText("成功したタスク")).toBeInTheDocument();
    expect(within(panel).getByText("失敗したタスク")).toBeInTheDocument();
    // もう一度押すと全件表示に戻る
    await user.click(within(panel).getByRole("button", { name: "要対応 2" }));
    expect(within(panel).getByText("実行中タスク")).toBeInTheDocument();
  });
});
