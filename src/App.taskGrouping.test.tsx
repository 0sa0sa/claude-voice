import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

type Status = "running" | "succeeded" | "failed" | "cancelled";

interface MockTask {
  id: string;
  seq: number;
  project: string;
  instruction: string;
  status: Status;
  startedAt: number;
  endedAt?: number | null;
  lastEvent: string | null;
  result: string | null;
  error: string | null;
  sessionId?: string | null;
  resumedFrom?: string | null;
}

function makeTask(
  id: string,
  seq: number,
  project: string,
  instruction: string,
  status: Status,
  startedAt: number,
  endedAt?: number,
): MockTask {
  return {
    id,
    seq,
    project,
    instruction,
    status,
    startedAt,
    endedAt: endedAt ?? null,
    lastEvent: null,
    result: null,
    error: null,
    sessionId: null,
    resumedFrom: null,
  };
}

function stubFetch(tasks: MockTask[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks });
      if (path.includes("/api/workspace")) return Response.json({ ok: true });
      return Response.json({ interject: false, question: "" });
    }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("タスク一覧のプロジェクト別グルーピングと絞り込み", () => {
  it("同じプロジェクトのタスクが時系列順でも隣り合ってまとまり、プロジェクト見出しが付く", async () => {
    const now = Date.now();
    stubFetch([
      makeTask("t1", 1, "alpha", "A新しいタスク", "running", now - 10_000),
      makeTask("t2", 2, "beta", "Bのタスク", "running", now - 20_000),
      makeTask("t3", 3, "alpha", "A古いタスク", "running", now - 30_000),
    ]);
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("A新しいタスク");

    // 単なる新着順(A新, B, A古)ではなく、プロジェクトごとにまとまる
    const items = within(panel).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("A新しいタスク");
    expect(items[1]).toHaveTextContent("A古いタスク");
    expect(items[2]).toHaveTextContent("Bのタスク");

    // プロジェクト名はグループ見出しとして1回だけ表示される
    expect(within(panel).getByText("alpha")).toBeInTheDocument();
    expect(within(panel).getByText("beta")).toBeInTheDocument();
  });

  it("プロジェクトチップで絞り込め、ワークスペースは切り替わらない", async () => {
    const now = Date.now();
    stubFetch([
      makeTask("t1", 1, "alpha", "Aのタスク", "running", now - 10_000),
      makeTask("t2", 2, "beta", "Bのタスク", "succeeded", now - 60_000, now - 30_000),
    ]);
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("Aのタスク");

    // 既定は全プロジェクト表示。「すべて」チップが選択状態
    const allChip = within(panel).getByRole("button", { name: "すべて" });
    expect(allChip).toHaveAttribute("aria-pressed", "true");

    const betaChip = within(panel).getByRole("button", { name: "beta (1)" });
    await user.click(betaChip);
    await waitFor(() =>
      expect(within(panel).queryByText("Aのタスク")).not.toBeInTheDocument(),
    );
    expect(within(panel).getByText("Bのタスク")).toBeInTheDocument();
    expect(betaChip).toHaveAttribute("aria-pressed", "true");

    // 表示フィルタのみで、作業ワークスペースの切替APIは呼ばれない
    const calls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes("/api/workspace"))).toBe(false);

    await user.click(within(panel).getByRole("button", { name: "すべて" }));
    await within(panel).findByText("Aのタスク");
  });

  it("タスクが1プロジェクトだけのときはチップ行を出さない", async () => {
    const now = Date.now();
    stubFetch([makeTask("t1", 1, "alpha", "Aのタスク", "running", now - 10_000)]);
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("Aのタスク");
    expect(within(panel).queryByRole("button", { name: "すべて" })).toBeNull();
  });
});
