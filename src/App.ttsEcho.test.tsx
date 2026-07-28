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

const REPLY = "タスクの完了を確認しました。テストは全て通っています。";

function sseResponse(blocks: Array<{ event: string; data: unknown }>): Response {
  const body = blocks
    .map((b) => `event: ${b.event}\ndata: ${JSON.stringify(b.data)}\n\n`)
    .join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  FakeRecognition.last = null;
  FakeUtterance.instances = [];
  fakeSynthesis.speaking = false;
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", fakeSynthesis);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks: [] });
      if (path.includes("/api/dictionary")) return Response.json({ entries: [] });
      if (path.includes("/api/chat"))
        return sseResponse([
          { event: "delta", data: { text: REPLY } },
          { event: "done", data: { text: REPLY } },
        ]);
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

/** マイクを開始し、「タスクを実行して」を音声コマンド送信して応答の読み上げ開始まで進める。 */
async function speakReplyAfterSend(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(screen.getByRole("button", { name: "マイクを開始" }));
  act(() => emit(["タスクを実行して"]));
  act(() => emit(["送信"]));
  // 応答が届き、読み上げ(speechSynthesis.speak)が始まるのを待つ
  await waitFor(() => expect(fakeSynthesis.speak).toHaveBeenCalledTimes(1));
  expect(FakeUtterance.instances.map((u) => u.text)).toEqual([REPLY]);
  expect(fakeSynthesis.speaking).toBe(true);
  // 送信時の tts.cancel() 呼び出しはここで清算し、以降の cancel だけを検証する
  fakeSynthesis.cancel.mockClear();
}

describe("応答の読み上げとエコー抑止の両立", () => {
  it("かな表記に揺れたエコー(interim)を拾い直しても読み上げは止まらない", async () => {
    const user = userEvent.setup();
    await speakReplyAfterSend(user);

    // TTS音声のマイク回り込み: 認識途中(interim)はかな未変換で届くことが多く、
    // 読み上げテキスト(漢字)との文字照合をすり抜ける
    act(() => emit([], "たすくのかんりょうをかくにんしました"));

    expect(fakeSynthesis.cancel).not.toHaveBeenCalled();
    expect(fakeSynthesis.speaking).toBe(true);
  });

  it("かな表記に揺れたエコー(確定)でも読み上げは止まらない", async () => {
    const user = userEvent.setup();
    await speakReplyAfterSend(user);

    // 実環境では確定結果もかな未変換のまま届くことが多い。文字照合をすり抜けて
    // freshFinal になると、バージインが応答の読み上げ自体を殺してしまう
    act(() => emit(["たすくのかんりょうをかくにんしました"]));

    expect(fakeSynthesis.cancel).not.toHaveBeenCalled();
    expect(fakeSynthesis.speaking).toBe(true);
    // エコーは認識段階で破棄され、ドラフトにも残らない(沈黙後の自動誤送信を防ぐ)
    expect(screen.getByRole("textbox", { name: "認識テキスト(編集できます)" })).toHaveValue("");
  });

  it("送信済み発話の再発火(確定)では読み上げを止めない", async () => {
    const user = userEvent.setup();
    await speakReplyAfterSend(user);

    // reset後にブラウザが同一発話の確定結果を再発火するケース
    act(() => emit(["タスクを実行して送信"]));

    expect(fakeSynthesis.cancel).not.toHaveBeenCalled();
    expect(fakeSynthesis.speaking).toBe(true);
    // 再発火は lastSent ガードで再送信もされない
    const chatCalls = vi.mocked(fetch).mock.calls.filter((c) => String(c[0]).includes("/api/chat"));
    expect(chatCalls).toHaveLength(1);
  });

  it("読み上げテキストどおりのエコー(確定)は破棄され、読み上げも続く", async () => {
    const user = userEvent.setup();
    await speakReplyAfterSend(user);

    act(() => emit(["タスクの完了を確認しました"]));

    expect(fakeSynthesis.cancel).not.toHaveBeenCalled();
    expect(fakeSynthesis.speaking).toBe(true);
    // エコーは認識段階で破棄され、入力欄には現れない
    expect(screen.getByRole("textbox", { name: "認識テキスト(編集できます)" })).toHaveValue("");
  });

  it("読み上げ中の本物のユーザー発話(確定)ではバージインで読み上げを止める", async () => {
    const user = userEvent.setup();
    await speakReplyAfterSend(user);

    act(() => emit(["全然別の話なんだけど"]));

    expect(fakeSynthesis.cancel).toHaveBeenCalled();
  });
});
