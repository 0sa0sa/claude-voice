import { act, render, screen, waitFor } from "@testing-library/react";
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

class FakeUtterance {
  static instances: FakeUtterance[] = [];
  text: string;
  lang = "";
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
    FakeUtterance.instances.push(this);
  }
}

const fakeSynthesis = {
  speaking: false,
  speak: vi.fn(() => {
    fakeSynthesis.speaking = true;
  }),
  cancel: vi.fn(() => {
    fakeSynthesis.speaking = false;
  }),
};

/**
 * /api/chat 呼び出しごとに、テストから完了させられる SSE ストリームを返す。
 * finish() で done イベントを流して応答を完了させ、キューの次の発話を進める。
 */
interface ChatCall {
  message: string;
  signal: AbortSignal;
  finish: (text?: string) => void;
}
let chatCalls: ChatCall[] = [];

function chatResponse(message: string, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  signal?.addEventListener("abort", () => {
    try {
      controller.error(new DOMException("aborted", "AbortError"));
    } catch {
      /* already closed */
    }
  });
  chatCalls.push({
    message,
    signal,
    finish: (text = "応答") => {
      try {
        controller.enqueue(enc.encode(`event: done\ndata: ${JSON.stringify({ text })}\n\n`));
        controller.close();
      } catch {
        /* already errored/closed */
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  FakeRecognition.last = null;
  FakeUtterance.instances = [];
  fakeSynthesis.speaking = false;
  chatCalls = [];
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", fakeSynthesis);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks: [] });
      if (path.includes("/api/dictionary")) return Response.json({ entries: [] });
      if (path.includes("/api/chat")) {
        const { message } = JSON.parse(String(init?.body ?? "{}"));
        return chatResponse(message, init?.signal as AbortSignal);
      }
      return Response.json({ interject: false, question: "" });
    }),
  );
});

afterEach(() => {
  fakeSynthesis.speak.mockClear();
  fakeSynthesis.cancel.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("発話ディスパッチキュー(非同期の順次処理と緊急割り込み)", () => {
  it("応答中の通常発話はキューされ、応答が完了してから順に送信される", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "マイクを開始" }));

    act(() => emit(["最初の質問です"]));
    act(() => emit(["送信"]));
    await waitFor(() => expect(chatCalls).toHaveLength(1));
    expect(chatCalls[0].message).toBe("最初の質問です");

    // 応答中に別の通常発話 → 打ち切らずキューに積み、まだ送信しない
    act(() => emit(["二個目の発話です"]));
    act(() => emit(["送信"]));
    await new Promise((r) => setTimeout(r, 30));
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0].signal.aborted).toBe(false);

    // 1件目の応答が完了すると、待機していた2件目が送られる
    act(() => chatCalls[0].finish());
    await waitFor(() => expect(chatCalls).toHaveLength(2));
    expect(chatCalls[1].message).toBe("二個目の発話です");
  });

  it("緊急発話は進行中の応答を打ち切って割り込み、即座に送信される", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "マイクを開始" }));

    act(() => emit(["普通の質問です"]));
    act(() => emit(["送信"]));
    await waitFor(() => expect(chatCalls).toHaveLength(1));

    // 緊急発話 → 割り込みで1件目を打ち切り、即座に送信される
    act(() => emit(["緊急で助けてください"]));
    act(() => emit(["送信"]));
    await waitFor(() => expect(chatCalls).toHaveLength(2));
    expect(chatCalls[1].message).toBe("緊急で助けてください");
    expect(chatCalls[0].signal.aborted).toBe(true);
  });
});
