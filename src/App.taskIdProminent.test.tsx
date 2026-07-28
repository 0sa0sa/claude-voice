import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const tasks = [
  {
    id: "abc12345",
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
    id: "def67890",
    seq: 2,
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

describe("タスクカードの番号を常に目立つ位置へ表示する", () => {
  it("各カードの先頭(左上)に専用バッジとして連番を表示する", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    const badge1 = await within(panel).findByTestId("task-seq-badge-1");
    const badge2 = await within(panel).findByTestId("task-seq-badge-2");
    expect(badge1).toHaveTextContent("#1");
    expect(badge2).toHaveTextContent("#2");

    // カード内の他要素より先に(＝一番目立つ位置=左上に)配置されていること
    const card1 = badge1.closest("li");
    expect(card1).not.toBeNull();
    expect(card1!.querySelector(".task-seq-badge")).toBe(badge1);
    expect(card1!.firstElementChild).toBe(badge1);
  });

  it("展開やホバーなどの操作をせずクリック前から番号が読める", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    // クリック(展開)は一切行わない。初期表示の時点でバッジが見えること。
    const badge = await within(panel).findByTestId("task-seq-badge-1");
    expect(badge).toBeVisible();
  });
});
