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

describe("isLikelyEcho: かな読みエコー(確定結果が漢字変換されずかなのまま届く)", () => {
  const spoken = ["タスクの完了を確認しました。テストは全て通っています。"];

  it("読み上げ全文のかな読みをエコーと判定する", () => {
    expect(
      isLikelyEcho("たすくのかんりょうをかくにんしましたてすとはすべてとおっています", spoken),
    ).toBe(true);
  });

  it("読みの途中で切れた確定(前半のみ)をエコーと判定する", () => {
    expect(isLikelyEcho("たすくのかんりょうをかくにんしました", spoken)).toBe(true);
  });

  it("拾い始めが遅れた確定(後半のみ)をエコーと判定する", () => {
    expect(isLikelyEcho("かくにんしましたてすとはすべてとおっています", spoken)).toBe(true);
  });

  it("かなだけの本物の発話はエコー扱いしない", () => {
    expect(isLikelyEcho("ぜんぜんべつのはなしなんだけど", spoken)).toBe(false);
    expect(isLikelyEcho("ちょっとまってください", spoken)).toBe(false);
  });

  it("漢字を含む認識結果には読み照合を適用しない(語彙が近い割り込みを殺さない)", () => {
    // 「実行して」読み上げ中の「中断して」のような、近い語彙の本物のバージイン
    expect(isLikelyEcho("タスクを中断して", ["タスクを実行して"])).toBe(false);
  });

  it("末尾の一般的な活用語尾だけの偶然一致はエコー扱いしない", () => {
    // 「通っています」は一般的な言い回しで、無関係な質問の語尾にも頻出する。
    // 単一のかな連だけの一致(裏付けとなる他の連がない)は偶然の一致として弾く
    expect(isLikelyEcho("とおっていますか", spoken)).toBe(false);
  });
});
