import { describe, expect, it } from "vitest";
import { applyDictionary, type DictionaryEntry } from "./speechDictionary";

const dict = (pairs: [string, string][]): DictionaryEntry[] =>
  pairs.map(([wrong, right]) => ({ wrong, right }));

describe("applyDictionary", () => {
  it("replaces a registered misrecognition with the correct form", () => {
    expect(applyDictionary("混みっとして", dict([["混みっと", "コミット"]]))).toBe(
      "コミットして",
    );
  });

  it("replaces all occurrences", () => {
    expect(applyDictionary("凛とと凛と", dict([["凛と", "リント"]]))).toBe("リントとリント");
  });

  it("leaves text without registered patterns unchanged", () => {
    expect(applyDictionary("テストを実行して", dict([["凛と", "リント"]]))).toBe(
      "テストを実行して",
    );
  });

  it("applies longer patterns before shorter overlapping ones", () => {
    const entries = dict([
      ["タイプ", "type"],
      ["タイプ チェック", "タイプチェック"],
    ]);
    expect(applyDictionary("タイプ チェックして", entries)).toBe("タイプチェックして");
  });

  it("ignores entries with an empty wrong pattern", () => {
    expect(applyDictionary("そのまま", dict([["", "x"]]))).toBe("そのまま");
  });

  it("returns text as-is for an empty dictionary", () => {
    expect(applyDictionary("そのまま", [])).toBe("そのまま");
  });

  it("is idempotent when the correct form contains the wrong form", () => {
    const entries = dict([["ビルド", "ビルド実行"]]);
    // 1回の適用で二重置換にならない
    expect(applyDictionary("ビルドして", entries)).toBe("ビルド実行して");
  });
});
