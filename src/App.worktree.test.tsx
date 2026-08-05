import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const tasks = [
  {
    id: "abcd1234",
    seq: 1,
    project: "demo",
    instruction: "worktreeで実行されたタスク",
    status: "succeeded",
    startedAt: Date.now() - 120_000,
    endedAt: Date.now() - 60_000,
    lastEvent: null,
    result: "done",
    error: null,
    sessionId: "sess-1",
    resumedFrom: null,
    worktreePath: "/home/u/.claude-voice/worktrees/demo-abcd1234",
    branch: "task/abcd1234",
    worktreeNote: null,
  },
  {
    id: "ffff0000",
    seq: 2,
    project: "demo",
    instruction: "worktree作成に失敗したタスク",
    status: "succeeded",
    startedAt: Date.now() - 60_000,
    endedAt: Date.now() - 30_000,
    lastEvent: null,
    result: "done",
    error: null,
    sessionId: "sess-2",
    resumedFrom: null,
    worktreePath: null,
    branch: null,
    worktreeNote: "worktree作成に失敗、プロジェクト直下で実行: no HEAD",
  },
];

beforeEach(() => {
  vi.restoreAllMocks();
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

describe("タスクのworktree表示", () => {
  it("worktreeで実行したタスクにはブランチ名を表示する", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    expect(await within(panel).findByText("task/abcd1234")).toBeInTheDocument();
  });

  it("展開するとworktreeのパスを確認できる", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    const badge = await within(panel).findByText("task/abcd1234");
    // 一覧では折りたたみ、バッジのtitleでパスを補助表示する
    expect(badge).toHaveAttribute("title", "/home/u/.claude-voice/worktrees/demo-abcd1234");
    await userEvent.click(within(panel).getByText("worktreeで実行されたタスク"));
    expect(
      within(panel).getByText(/\/home\/u\/\.claude-voice\/worktrees\/demo-abcd1234/),
    ).toBeInTheDocument();
  });

  it("worktree作成に失敗したタスクはその旨を表示し、ブランチバッジは出さない", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("task/abcd1234");
    expect(
      within(panel).getByText("worktree作成に失敗、プロジェクト直下で実行: no HEAD"),
    ).toBeInTheDocument();
    // ブランチバッジはworktreeがあるタスクの1件だけ
    expect(within(panel).queryAllByText(/^task\//)).toHaveLength(1);
  });
});
