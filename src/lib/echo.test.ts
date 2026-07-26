import { describe, expect, it } from "vitest";
import { diceSimilarity, isLikelyEcho, normalizeEchoText } from "./echo";

describe("normalizeEchoText", () => {
  it("strips punctuation and whitespace", () => {
    expect(normalizeEchoText("こんにちは、 元気ですか?!")).toBe("こんにちは元気ですか");
  });

  it("converts katakana to hiragana", () => {
    expect(normalizeEchoText("テスト")).toBe("てすと");
  });

  it("applies NFKC (fullwidth → halfwidth) and lowercases", () => {
    expect(normalizeEchoText("ABC123")).toBe("abc123");
    expect(normalizeEchoText("ABC")).toBe("abc");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(normalizeEchoText("。、!? ")).toBe("");
  });
});

describe("diceSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(diceSimilarity("こんにちは", "こんにちは")).toBe(1);
  });

  it("returns 0 for completely different strings", () => {
    expect(diceSimilarity("こんにちは", "さようなら")).toBe(0);
  });

  it("returns a high score for mostly-overlapping strings", () => {
    expect(diceSimilarity("タスクが完了しました", "タスクが完了しま")).toBeGreaterThan(0.7);
  });
});

describe("isLikelyEcho", () => {
  const spoken = ["hojokin-naviのタスクが完了しました。テストは全て通っています。"];

  it("detects an exact echo", () => {
    expect(isLikelyEcho("hojokin-naviのタスクが完了しました。テストは全て通っています。", spoken)).toBe(
      true,
    );
  });

  it("detects a partial echo (prefix fragment, as interim results grow)", () => {
    expect(isLikelyEcho("タスクが完了しました", spoken)).toBe(true);
    expect(isLikelyEcho("テストは全て通って", spoken)).toBe(true);
  });

  it("detects an echo despite punctuation and kana differences", () => {
    expect(isLikelyEcho("ほじょきんナビのタスクが完了しました テストは全て通っています", spoken)).toBe(
      true,
    );
  });

  it("does not flag unrelated user speech", () => {
    expect(isLikelyEcho("次はデプロイをお願いします", spoken)).toBe(false);
    expect(isLikelyEcho("ちょっと待って", spoken)).toBe(false);
  });

  it("returns false when nothing was spoken recently", () => {
    expect(isLikelyEcho("タスクが完了しました", [])).toBe(false);
  });

  it("returns false for empty or punctuation-only recognized text", () => {
    expect(isLikelyEcho("", spoken)).toBe(false);
    expect(isLikelyEcho("。。。", spoken)).toBe(false);
  });

  it("detects a near-complete echo with a small recognition error", () => {
    expect(isLikelyEcho("補助金ナビのタスクが完了しましたテストは全て通っています", spoken)).toBe(
      true,
    );
  });
});
