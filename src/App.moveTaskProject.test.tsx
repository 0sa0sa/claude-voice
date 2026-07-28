import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

/**
 * タスクのプロジェクト付け替え: 完了済みタスクの「移動」からプロジェクト一覧を開き、
 * 選んだ先へ POST /api/tasks/:id/project で付け替える。実行中タスクは対象外。
 */

const projects = [
  { name: "alpha", hasGit: true, hasPackageJson: true },
  { name: "beta", hasGit: true, hasPackageJson: true },
  { name: "gamma", hasGit: true, hasPackageJson: false },
];

let tasksState: Array<Record<string, unknown>>;
/** POST /api/tasks/:id/project のレスポンスを差し替え可能にする */
let moveResponse: (id: string, project: string) => Response;

beforeEach(() => {
  vi.restoreAllMocks();
  tasksState = [
    {
      id: "t1",
      seq: 1,
      project: "alpha",
      instruction: "テストを実行する",
      status: "succeeded",
      startedAt: Date.now() - 120_000,
      endedAt: Date.now() - 60_000,
      lastEvent: null,
      result: "done",
      error: null,
      sessionId: "sess-1",
      resumedFrom: null,
      worktreePath: null,
      branch: null,
      worktreeNote: null,
    },
    {
      id: "t2",
      seq: 2,
      project: "alpha",
      instruction: "実行中タスク",
      status: "running",
      startedAt: Date.now() - 60_000,
      lastEvent: null,
      result: null,
      error: null,
      sessionId: "sess-2",
      resumedFrom: null,
      worktreePath: null,
      branch: null,
      worktreeNote: null,
    },
  ];
  moveResponse = (id, project) => {
    const task = tasksState.find((t) => t.id === id)!;
    task.project = project;
    return Response.json({ ok: true, task });
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const method = init?.method ?? "GET";
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects, active: null });
      const move = /\/api\/tasks\/([^/]+)\/project$/.exec(path);
      if (move && method === "POST") {
        return moveResponse(move[1], JSON.parse(String(init?.body)).project);
      }
      if (path.includes("/api/tasks")) return Response.json({ tasks: tasksState });
      return Response.json({ interject: false, question: "" });
    }),
  );
});

/** タスクパネル内で指示文をもつカード(li)を取得する */
async function findTaskCard(name: RegExp) {
  const panel = await screen.findByRole("complementary", { name: "タスク" });
  const body = await within(panel).findByRole("button", { name });
  return body.closest("li")!;
}

describe("タスクのプロジェクト付け替え", () => {
  it("完了タスクの「移動」からプロジェクトを選ぶとAPIへ付け替えを送る", async () => {
    const user = userEvent.setup();
    render(<App />);
    const card = await findTaskCard(/テストを実行する/);

    await user.click(within(card).getByRole("button", { name: "移動" }));
    const select = within(card).getByRole("combobox", { name: "移動先プロジェクト" });
    // 選択肢はプロジェクト一覧から。現在のプロジェクト(alpha)は除く
    const options = within(select)
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== "");
    expect(options).toEqual(["beta", "gamma"]);

    await user.selectOptions(select, "beta");

    await waitFor(() => {
      const post = vi
        .mocked(fetch)
        .mock.calls.find(
          (c) => String(c[0]).includes("/api/tasks/t1/project") && c[1]?.method === "POST",
        );
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ project: "beta" });
    });
    // 報告は連番でタスクを示し、一覧の再取得で移動先グループに表示される
    await screen.findByText(/タスク #1 を beta に移動しました/);
    await waitFor(() => {
      const panel = screen.getByRole("complementary", { name: "タスク" });
      expect(within(panel).getByText("beta")).toBeInTheDocument();
    });
  });

  it("実行中タスクには「移動」を出さない(worktreeに紐付いて実行中のため)", async () => {
    render(<App />);
    const running = await findTaskCard(/実行中タスク/);
    expect(within(running).queryByRole("button", { name: "移動" })).not.toBeInTheDocument();
    // 完了タスク側には出る
    const finished = await findTaskCard(/テストを実行する/);
    expect(within(finished).getByRole("button", { name: "移動" })).toBeInTheDocument();
  });

  it("付け替えに失敗したらエラーを表示し、タスクは元のプロジェクトに残る", async () => {
    moveResponse = () =>
      Response.json({ error: "プロジェクト beta が見つかりません" }, { status: 404 });
    const user = userEvent.setup();
    render(<App />);
    const card = await findTaskCard(/テストを実行する/);

    await user.click(within(card).getByRole("button", { name: "移動" }));
    await user.selectOptions(
      within(card).getByRole("combobox", { name: "移動先プロジェクト" }),
      "beta",
    );

    await screen.findByText(/⚠ プロジェクト beta が見つかりません/);
    const panel = screen.getByRole("complementary", { name: "タスク" });
    expect(within(panel).queryByText("beta")).not.toBeInTheDocument();
  });
});
