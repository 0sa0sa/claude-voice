import { describe, expect, it } from "vitest";
import { mergeRecognizedText } from "./liveDraft";

describe("mergeRecognizedText", () => {
  it("未編集なら認識結果にそのまま追従する", () => {
    expect(mergeRecognizedText("こんにちは", "こんにちは", "こんにちは今日は")).toBe(
      "こんにちは今日は",
    );
  });

  it("未編集なら訂正コマンドによる巻き戻し(非追記の変化)も反映する", () => {
    expect(mergeRecognizedText("店舗が大事", "店舗が大事", "テンポが大事")).toBe("テンポが大事");
  });

  it("手動編集後は編集内容を保持し、新しく増えた認識分だけ末尾に追記する", () => {
    expect(mergeRecognizedText("今日の東京の天気", "今日の天気", "今日の天気を教えて")).toBe(
      "今日の東京の天気を教えて",
    );
  });

  it("手動編集後に認識結果が変化していなければ編集内容をそのまま返す", () => {
    expect(mergeRecognizedText("編集済み", "元のテキスト", "元のテキスト")).toBe("編集済み");
  });

  it("手動で全部削除しても、次の認識分は追記される", () => {
    expect(mergeRecognizedText("", "こんにちは", "こんにちは天気は")).toBe("天気は");
  });

  it("手動編集後に認識側の過去が書き換わった(追記でない)場合は編集内容を優先する", () => {
    expect(mergeRecognizedText("編集済みテキスト", "店舗が大事", "テンポが大事")).toBe(
      "編集済みテキスト",
    );
  });

  it("初回(認識前が空)は認識結果を返す", () => {
    expect(mergeRecognizedText("", "", "こんにちは")).toBe("こんにちは");
  });
});
