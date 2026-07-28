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
    id: "0f3c9a7e-1234-4abc-9def-000000000001",
    seq: 2,
    project: "claude-voice",
    instruction: "レガシーIDのタスク",
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

describe("タスクサイドバーの短縮ID表示", () => {
  it("各タスクカードに短縮IDが表示される", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    expect(await within(panel).findByText("abc12345")).toBeInTheDocument();
  });

  it("レガシーな長いIDは先頭8文字に短縮して表示し、全文はtitleで参照できる", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    const shortId = await within(panel).findByText("0f3c9a7e");
    expect(shortId).toHaveAttribute("title", "ID: 0f3c9a7e-1234-4abc-9def-000000000001");
    expect(
      within(panel).queryByText("0f3c9a7e-1234-4abc-9def-000000000001"),
    ).not.toBeInTheDocument();
  });
});
