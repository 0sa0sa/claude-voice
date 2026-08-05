import { describe, expect, it } from "vitest";
import {
  applyRecognition,
  detectSendCommand,
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

describe("detectSendCommand", () => {
  it("detects a trailing 送信 and strips it from the body", () => {
    expect(detectSendCommand("ログイン画面を作って送信")).toEqual({
      triggered: true,
      body: "ログイン画面を作って",
    });
  });

  it("handles 送って / 送信して with trailing punctuation", () => {
    expect(detectSendCommand("テストを回して、送って。")).toEqual({
      triggered: true,
      body: "テストを回して",
    });
    expect(detectSendCommand("これを実装して 送信して")).toEqual({
      triggered: true,
      body: "これを実装して",
    });
  });

  it("does not trigger when 送信 appears mid-sentence", () => {
    const r = detectSendCommand("送信ボタンの色を変えたい");
    expect(r.triggered).toBe(false);
    expect(r.body).toBe("送信ボタンの色を変えたい");
  });

  it("triggers but yields an empty body when only the command is spoken", () => {
    expect(detectSendCommand("送信")).toEqual({ triggered: true, body: "" });
    expect(detectSendCommand("送信して。")).toEqual({ triggered: true, body: "" });
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
