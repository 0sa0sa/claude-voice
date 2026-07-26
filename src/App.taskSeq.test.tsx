import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const tasks = [
  {
    id: "abcd1234efgh",
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
    id: "wxyz5678",
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

describe("タスクの連番表示", () => {
  it("各タスクカードに連番(#n)を主表示する", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    expect(await within(panel).findByText("#1")).toBeInTheDocument();
    expect(within(panel).getByText("#2")).toBeInTheDocument();
  });

  it("16進IDは本文に表示せず、連番バッジのtitleで補助的に参照できる", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("#1");
    // 口頭で伝えづらい16進IDはカード本文から外す
    expect(within(panel).queryByText("abcd1234")).not.toBeInTheDocument();
    expect(within(panel).queryByText("wxyz5678")).not.toBeInTheDocument();
    // 必要なときはツールチップ(title)から確認できる
    expect(within(panel).getByTitle(/abcd1234efgh/)).toBeInTheDocument();
    expect(within(panel).getByTitle(/wxyz5678/)).toBeInTheDocument();
  });
});
