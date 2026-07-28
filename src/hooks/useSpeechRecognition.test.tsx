import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSpeechRecognition } from "./useSpeechRecognition";

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

function emitFinal(text: string) {
  FakeRecognition.last!.onresult?.({
    resultIndex: 0,
    results: [Object.assign([{ transcript: text }], { isFinal: true })],
  });
}

beforeEach(() => {
  FakeRecognition.last = null;
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSpeechRecognition voice corrections", () => {
  it("applies a 「AじゃなくてB」 correction to the accumulated finals", () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => emitFinal("店舗が大事"));
    act(() => emitFinal("店舗じゃなくてテンポ"));
    expect(result.current.transcript.finals).toEqual(["テンポが大事"]);
  });

  it("corrects misrecognized English project names using the provided project list", () => {
    const { result } = renderHook(() =>
      useSpeechRecognition({ projectNames: ["kindergarten"] }),
    );
    act(() => result.current.start());
    act(() => emitFinal("幼稚園のタスクを実行して"));
    act(() => emitFinal("キンダーガーデンのテストも直して"));
    expect(result.current.transcript.finals).toEqual([
      "kindergartenのタスクを実行して",
      "kindergartenのテストも直して",
    ]);
  });

  it("appends non-correction finals unchanged", () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => emitFinal("最初の発話"));
    act(() => emitFinal("次の発話"));
    expect(result.current.transcript.finals).toEqual(["最初の発話", "次の発話"]);
  });

  it("invokes onUpdate with the new transcript for each final", () => {
    const updates: string[] = [];
    const { result } = renderHook(() =>
      useSpeechRecognition({ onUpdate: (t) => updates.push(t.finals.join("")) }),
    );
    act(() => result.current.start());
    act(() => emitFinal("こんにちは"));
    act(() => emitFinal("元気ですか"));
    // 送信前ドラフト表示はこのコールバック経由。確定ごとに最新の全文で呼ばれること
    expect(updates.at(-1)).toBe("こんにちは元気ですか");
    expect(updates).toContain("こんにちは");
  });
});
