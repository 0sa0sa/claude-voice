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

describe("useSpeechRecognition user dictionary", () => {
  it("corrects registered misrecognitions in finals", () => {
    const { result } = renderHook(() =>
      useSpeechRecognition({ dictionary: [{ wrong: "混みっと", right: "コミット" }] }),
    );
    act(() => result.current.start());
    act(() => emitFinal("混みっとしておいて"));
    expect(result.current.transcript.finals).toEqual(["コミットしておいて"]);
  });

  it("applies the dictionary before voice correction commands", () => {
    const { result } = renderHook(() =>
      useSpeechRecognition({ dictionary: [{ wrong: "凛と", right: "リント" }] }),
    );
    act(() => result.current.start());
    act(() => emitFinal("凛とを直して"));
    // 「AじゃなくてB」のBにも辞書補正が効く
    act(() => emitFinal("直してじゃなくて凛と実行して"));
    expect(result.current.transcript.finals).toEqual(["リントをリント実行して"]);
  });

  it("works together with projectNames correction", () => {
    const { result } = renderHook(() =>
      useSpeechRecognition({
        projectNames: ["kindergarten"],
        dictionary: [{ wrong: "混みっと", right: "コミット" }],
      }),
    );
    act(() => result.current.start());
    act(() => emitFinal("幼稚園で混みっとして"));
    expect(result.current.transcript.finals).toEqual(["kindergartenでコミットして"]);
  });

  it("leaves finals unchanged without a dictionary", () => {
    const { result } = renderHook(() => useSpeechRecognition());
    act(() => result.current.start());
    act(() => emitFinal("混みっとして"));
    expect(result.current.transcript.finals).toEqual(["混みっとして"]);
  });
});
