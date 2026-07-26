import { describe, expect, it } from "vitest";
import { clipForSpeech } from "./speechClip";

describe("clipForSpeech", () => {
  it("returns short text unchanged", () => {
    expect(clipForSpeech("テストが全部通りました。")).toBe("テストが全部通りました。");
  });

  it("returns empty string for empty input", () => {
    expect(clipForSpeech("")).toBe("");
    expect(clipForSpeech("   ")).toBe("");
  });

  it("keeps text exactly at the limit unchanged", () => {
    const text = "あ".repeat(30);
    expect(clipForSpeech(text, 30)).toBe(text);
  });

  it("cuts at the last sentence boundary within the limit", () => {
    const text = "一文目です。二文目です。三文目はとても長い説明が続きます。";
    expect(clipForSpeech(text, 12)).toBe("一文目です。二文目です。");
  });

  it("treats ！？!? and newline as sentence boundaries", () => {
    expect(clipForSpeech("完了！次はデプロイの長い説明が続きます", 5)).toBe("完了！");
    expect(clipForSpeech("done?\nそのあとに長い説明が続きます", 6)).toBe("done?");
    expect(clipForSpeech("1行目のまとめ\n2行目の長い詳細説明が続きます", 8)).toBe("1行目のまとめ");
  });

  it("treats an ASCII period as a boundary only at end of sentence", () => {
    // "1.2" のような小数点では切らない
    expect(clipForSpeech("Bumped to v1.2 and done. さらに長い説明が続きます続きます", 25)).toBe(
      "Bumped to v1.2 and done.",
    );
  });

  it("hard-cuts with ellipsis when no boundary fits", () => {
    const text = "句読点のないとても長いテキストが延々と続いていきます";
    expect(clipForSpeech(text, 10)).toBe("句読点のないとても長…");
  });
});
