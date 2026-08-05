import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TTS_RATE, TTS_RATE_STORAGE_KEY, useTTS } from "./useTTS";

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

const fakeSynthesis = { speak: vi.fn(), cancel: vi.fn(), speaking: false };

function setup() {
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", fakeSynthesis);
  return renderHook(() => useTTS());
}

afterEach(() => {
  FakeUtterance.instances = [];
  fakeSynthesis.speak.mockClear();
  fakeSynthesis.cancel.mockClear();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("useTTS rate", () => {
  it("defaults to DEFAULT_TTS_RATE and applies it to utterances", () => {
    const { result } = setup();
    expect(result.current.rate).toBe(DEFAULT_TTS_RATE);
    act(() => result.current.speak("こんにちは"));
    expect(FakeUtterance.instances[0].rate).toBe(DEFAULT_TTS_RATE);
  });

  it("setRate changes the rate of subsequent utterances and persists it", () => {
    const { result } = setup();
    act(() => result.current.setRate(1.5));
    expect(result.current.rate).toBe(1.5);
    act(() => result.current.speak("速いですか"));
    expect(FakeUtterance.instances[0].rate).toBe(1.5);
    expect(window.localStorage.getItem(TTS_RATE_STORAGE_KEY)).toBe("1.5");
  });

  it("restores a persisted rate on mount", () => {
    window.localStorage.setItem(TTS_RATE_STORAGE_KEY, "2");
    const { result } = setup();
    expect(result.current.rate).toBe(2);
  });

  it("falls back to the default when the persisted rate is invalid", () => {
    window.localStorage.setItem(TTS_RATE_STORAGE_KEY, "abc");
    const { result } = setup();
    expect(result.current.rate).toBe(DEFAULT_TTS_RATE);
  });
});
