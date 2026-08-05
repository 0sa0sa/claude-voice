import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const runningTask = {
  id: "t1",
  seq: 1,
  project: "claude-voice",
  instruction: "テストを実行する",
  status: "running",
  startedAt: Date.now() - 60_000,
  lastEvent: null,
  result: null,
  error: null,
  sessionId: "sess-1",
  resumedFrom: null,
};

const finishedTask = {
  id: "t2",
  seq: 2,
  project: "claude-voice",
  instruction: "終わったタスク",
  status: "succeeded",
  startedAt: Date.now() - 120_000,
  endedAt: Date.now() - 60_000,
  lastEvent: null,
  result: "done",
  error: null,
  sessionId: "sess-2",
  resumedFrom: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/instructions")) return Response.json({ ok: true });
      if (path.includes("/api/tasks")) return Response.json({ tasks: [runningTask, finishedTask] });
      return Response.json({ interject: false, question: "" });
    }),
  );
});

describe("App append instruction UI", () => {
  it("shows the append button only on running tasks", async () => {
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("テストを実行する");
    expect(within(panel).getAllByRole("button", { name: "追加指示" })).toHaveLength(1);
  });

  it("opens an inline input and posts the follow-up to the instructions API", async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("テストを実行する");

    await user.click(within(panel).getByRole("button", { name: "追加指示" }));
    const input = within(panel).getByPlaceholderText("追加の指示を入力");
    await user.type(input, "READMEも更新して");
    await user.click(within(panel).getByRole("button", { name: "追加指示を送信" }));

    await waitFor(() => {
      const call = vi
        .mocked(fetch)
        .mock.calls.find(([u]) => String(u).includes("/api/tasks/t1/instructions"));
      expect(call).toBeTruthy();
      expect(call![1]?.method).toBe("POST");
      expect(JSON.parse(String(call![1]?.body))).toEqual({ text: "READMEも更新して" });
    });
    // 送信後は入力欄が閉じ、システムバブルは連番でタスクを示す
    await waitFor(() =>
      expect(screen.getByText(/タスク #1 に追加指示を送りました/)).toBeInTheDocument(),
    );
    expect(within(panel).queryByPlaceholderText("追加の指示を入力")).not.toBeInTheDocument();
  });

  it("submits the follow-up with Enter as well", async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("テストを実行する");
    await user.click(within(panel).getByRole("button", { name: "追加指示" }));
    await user.type(within(panel).getByPlaceholderText("追加の指示を入力"), "型チェックも回して{Enter}");
    await waitFor(() => {
      const call = vi
        .mocked(fetch)
        .mock.calls.find(([u]) => String(u).includes("/api/tasks/t1/instructions"));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call![1]?.body))).toEqual({ text: "型チェックも回して" });
    });
  });

  it("does not send empty follow-ups", async () => {
    const user = userEvent.setup();
    render(<App />);
    const panel = await screen.findByRole("complementary", { name: "タスク" });
    await within(panel).findByText("テストを実行する");
    await user.click(within(panel).getByRole("button", { name: "追加指示" }));
    expect(within(panel).getByRole("button", { name: "追加指示を送信" })).toBeDisabled();
  });
});
