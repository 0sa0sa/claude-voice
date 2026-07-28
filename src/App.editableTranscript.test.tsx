import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  start() {
    FakeRecognition.last = this;
  }
  stop() {
    this.onend?.();
  }
}

function emit(finals: string[], interim = "") {
  const results = [
    ...finals.map((f) => Object.assign([{ transcript: f }], { isFinal: true })),
    ...(interim ? [Object.assign([{ transcript: interim }], { isFinal: false })] : []),
  ];
  FakeRecognition.last!.onresult?.({ resultIndex: 0, results });
}

function sseResponse(blocks: Array<{ event: string; data: unknown }>): Response {
  const body = blocks
    .map((b) => `event: ${b.event}\ndata: ${JSON.stringify(b.data)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  FakeRecognition.last = null;
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks: [] });
      if (path.includes("/api/chat"))
        return sseResponse([
          { event: "delta", data: { text: "了解" } },
          { event: "done", data: { text: "了解" } },
        ]);
      return Response.json({ interject: false, question: "" });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startMic(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "マイクを開始" }));
}

const editableTranscript = () =>
  screen.getByRole("textbox", { name: "認識テキスト(編集できます)" });

describe("編集可能な認識テキスト", () => {
  it("認識結果が編集可能な入力欄に表示され、キーボードで削除・追記できる", async () => {
    const user = userEvent.setup();
    render(<App />);
    await startMic(user);
    act(() => emit(["こんにちは。"]));

    const box = editableTranscript();
    expect(box).toHaveValue("こんにちは。");

    box.focus();
    await user.keyboard("{Backspace}");
    expect(box).toHaveValue("こんにちは");
    await user.keyboard("です");
    expect(box).toHaveValue("こんにちはです");
  });

  it("手動編集を保持したまま、新しい認識結果は末尾に追記される", async () => {
    const user = userEvent.setup();
    render(<App />);
    await startMic(user);
    act(() => emit(["今日の天気"]));

    // 途中挿入の編集(カーソル位置編集の代表として change で値を差し替え)
    fireEvent.change(editableTranscript(), { target: { value: "今日の東京の天気" } });
    expect(editableTranscript()).toHaveValue("今日の東京の天気");

    act(() => emit(["を教えて"]));
    expect(editableTranscript()).toHaveValue("今日の東京の天気を教えて");
  });

  it("未確定(interim)のテキストは入力欄の値には混ざらず、別枠で表示される", async () => {
    const user = userEvent.setup();
    render(<App />);
    await startMic(user);
    act(() => emit(["こんにちは"], "きょうの"));

    expect(editableTranscript()).toHaveValue("こんにちは");
    expect(screen.getByText("きょうの")).toBeInTheDocument();
  });

  it("編集後のテキストが送信され、入力欄はクリアされる", async () => {
    const user = userEvent.setup();
    render(<App />);
    await startMic(user);
    act(() => emit(["天気を教えて"]));

    fireEvent.change(editableTranscript(), { target: { value: "東京の天気を教えて" } });
    const sendNow = screen
      .getAllByRole("button", { name: "送信" })
      .find((b) => !(b as HTMLButtonElement).disabled)!;
    await user.click(sendNow);

    await waitFor(() => expect(screen.getByText("東京の天気を教えて")).toBeInTheDocument());
    const chatCall = vi
      .mocked(fetch)
      .mock.calls.find((c) => String(c[0]).includes("/api/chat"));
    expect(chatCall).toBeTruthy();
    expect(JSON.parse(String(chatCall![1]!.body)).message).toBe("東京の天気を教えて");
    expect(editableTranscript()).toHaveValue("");
  });

  it(
    "アンマウント後に無音の自動送信タイマーが発火しない(タイマーのクリーンアップ)",
    async () => {
      const user = userEvent.setup();
      const { unmount } = render(<App />);
      await startMic(user);
      act(() => emit(["天気を教えて"])); // interimなしの確定 → 2秒の自動送信タイマーが起動
      unmount();
      // 自動送信の無音しきい値(2秒)を超えて待っても、送信は起きないこと
      await new Promise((r) => setTimeout(r, 2400));
      const chatCalls = vi
        .mocked(fetch)
        .mock.calls.filter((c) => String(c[0]).includes("/api/chat"));
      expect(chatCalls).toHaveLength(0);
    },
    10_000,
  );

  it("末尾の「送信」音声コマンドでも編集後の本文が送られる", async () => {
    const user = userEvent.setup();
    render(<App />);
    await startMic(user);
    act(() => emit(["天気を教えて"]));

    fireEvent.change(editableTranscript(), { target: { value: "東京の天気を教えて" } });
    act(() => emit(["送信"]));

    await waitFor(() => {
      const chatCall = vi
        .mocked(fetch)
        .mock.calls.find((c) => String(c[0]).includes("/api/chat"));
      expect(chatCall).toBeTruthy();
      expect(JSON.parse(String(chatCall![1]!.body)).message).toBe("東京の天気を教えて");
    });
    expect(editableTranscript()).toHaveValue("");
  });
});
