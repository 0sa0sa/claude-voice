import { describe, expect, it } from "vitest";
import { isImeComposing } from "./imeGuard";

describe("isImeComposing", () => {
  it("returns true while the event is part of an IME composition", () => {
    expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true);
  });

  it("returns true for the keyCode 229 fallback (Safari などが返す IME 処理中コード)", () => {
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it("returns false for a plain Enter", () => {
    expect(isImeComposing({ isComposing: false, keyCode: 13 })).toBe(false);
  });

  it("returns false when the fields are missing (合成イベントなど)", () => {
    expect(isImeComposing({})).toBe(false);
  });
});
