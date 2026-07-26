import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSpeechRecognition } from "./useSpeechRecognition";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  constructor() {
    FakeRecognition.instances.push(this);
  }
}

function emit(rec: FakeRecognition, segments: Array<{ text: string; final: boolean }>) {
  rec.onresult?.({
    resultIndex: 0,
    results: segments.map((s) => ({ isFinal: s.final, 0: { transcript: s.text } })),
  });
}

afterEach(() => {
  FakeRecognition.instances = [];
  vi.unstubAllGlobals();
});

describe("useSpeechRecognition echo filtering", () => {
  it("drops final and interim segments flagged as echo, keeps real speech", () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const onUpdate = vi.fn();
    const { result } = renderHook(() =>
      useSpeechRecognition({ onUpdate, isEcho: (text) => text.includes("エコー") }),
    );
    act(() => result.current.start());
    const rec = FakeRecognition.instances[0];

    // 読み上げのエコーだけの認識結果は無視され、状態も更新されない
    act(() => emit(rec, [{ text: "エコーの断片", final: false }]));
    expect(result.current.transcript).toEqual({ finals: [], interim: "" });
    expect(onUpdate).not.toHaveBeenCalled();

    act(() => emit(rec, [{ text: "エコーが確定した文", final: true }]));
    expect(result.current.transcript).toEqual({ finals: [], interim: "" });
    expect(onUpdate).not.toHaveBeenCalled();

    // 本物の発話は通る
    act(() => emit(rec, [{ text: "本物の発話です", final: true }]));
    expect(result.current.transcript.finals).toEqual(["本物の発話です"]);
    expect(onUpdate).toHaveBeenCalled();
  });

  it("passes everything through when no isEcho filter is given", () => {
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const { result } = renderHook(() => useSpeechRecognition({}));
    act(() => result.current.start());
    const rec = FakeRecognition.instances[0];

    act(() =>
      emit(rec, [
        { text: "確定分", final: true },
        { text: "途中経過", final: false },
      ]),
    );
    expect(result.current.transcript).toEqual({ finals: ["確定分"], interim: "途中経過" });
  });
});
