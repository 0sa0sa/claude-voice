import { describe, expect, it } from "vitest";
import {
  applyRecognition,
  emptyTranscript,
  fullText,
  shouldQueryInterjection,
} from "./transcript";

describe("applyRecognition", () => {
  it("tracks interim text without committing it", () => {
    const s = applyRecognition(emptyTranscript(), [], "こんにち");
    expect(s.interim).toBe("こんにち");
    expect(s.finals).toEqual([]);
  });

  it("appends finalized segments and clears matching interim", () => {
    let s = applyRecognition(emptyTranscript(), [], "こんにちは");
    s = applyRecognition(s, ["こんにちは"], "");
    expect(s.finals).toEqual(["こんにちは"]);
    expect(s.interim).toBe("");
  });

  it("accumulates multiple final segments", () => {
    let s = emptyTranscript();
    s = applyRecognition(s, ["最初の文。"], "");
    s = applyRecognition(s, ["次の文。"], "つづき");
    expect(s.finals).toEqual(["最初の文。", "次の文。"]);
    expect(s.interim).toBe("つづき");
  });

  it("fullText joins finals and interim", () => {
    let s = emptyTranscript();
    s = applyRecognition(s, ["前半。"], "後半");
    expect(fullText(s)).toBe("前半。後半");
  });
});

describe("shouldQueryInterjection", () => {
  it("requires enough new characters", () => {
    expect(shouldQueryInterjection("あいうえお", "あいうえおかき", 12)).toBe(false);
    expect(
      shouldQueryInterjection("", "例のダッシュボードをいい感じに", 12),
    ).toBe(true);
  });

  it("returns false when text is unchanged", () => {
    expect(shouldQueryInterjection("同じテキスト", "同じテキスト", 1)).toBe(false);
  });
});
