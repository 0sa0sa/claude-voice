import { render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) {
        return Response.json({ ok: true, mode: "mock" });
      }
      if (path.includes("/api/chat")) {
        return sseResponse([
          { event: "session", data: { sessionId: "s1" } },
          { event: "delta", data: { text: "こんにちは" } },
          { event: "done", data: { text: "こんにちは" } },
        ]);
      }
      return Response.json({ interject: false, question: "" });
    }),
  );
});

describe("App", () => {
  it("renders the title and health mode", async () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "claude-voice" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("モックモード")).toBeInTheDocument());
  });

  it("disables the mic button when speech recognition is unsupported", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "マイクを開始" })).toBeDisabled();
  });

  it("sends a typed message and streams the reply", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByPlaceholderText("キーボードでも話せます"), "テスト送信");
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(screen.getByText("テスト送信")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("こんにちは")).toBeInTheDocument());
  });
});
