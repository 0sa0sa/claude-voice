import { describe, expect, it } from "vitest";
import { needsClarification } from "./taskCompletion";

describe("needsClarification", () => {
  it("実データ(タスク71cd48c5)のように選択肢を提示して止まった結果はtrue", () => {
    const result =
      'This is a large, ambitious visual/interaction redesign, so let me scope it properly before proposing a design.\n\n' +
      'A few context findings from `src/styles.css` / `src/App.tsx`:\n' +
      "- There's currently no \"corner brackets\" or \"scanline\" CSS.\n\n" +
      'First question: what should count as "the topic currently in focus" that animates to center stage?\n\n' +
      '- **A)** When a task is focused → that task becomes the center stage.\n' +
      '- **B)** Chat/conversation is always the center stage.\n' +
      '- **C)** Something else — describe it.';
    expect(needsClarification(result)).toBe(true);
  });

  it("最後の行が疑問符で終わる場合はtrue", () => {
    expect(needsClarification("この方針で進めてよろしいですか?")).toBe(true);
    expect(needsClarification("Should I use the new API or the old one?")).toBe(true);
  });

  it("確認・指示を求める定型句を含む場合はtrue", () => {
    expect(needsClarification("実装前に一点確認してください。対象は本番環境で合っていますか。")).toBe(
      true,
    );
    expect(needsClarification("Please confirm the target environment before I proceed.")).toBe(true);
  });

  it("通常の完了報告はfalse", () => {
    expect(
      needsClarification(
        "タスク一覧カードに要確認バッジを追加しました。スタイルも合わせて調整しています。テストも通過しています。",
      ),
    ).toBe(false);
  });

  it("null/undefined/空文字はfalse", () => {
    expect(needsClarification(null)).toBe(false);
    expect(needsClarification(undefined)).toBe(false);
    expect(needsClarification("")).toBe(false);
    expect(needsClarification("   ")).toBe(false);
  });
});
