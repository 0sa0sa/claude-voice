import { describe, expect, it } from "vitest";
import { classifyTaskPriority } from "./taskPriority.js";

describe("classifyTaskPriority", () => {
  it.each([
    "緊急でビルドを直して",
    "至急このバグを修正",
    "今すぐデプロイして",
    "急いでテストを回して",
    "これ最優先でお願い",
    "ASAP fix the crash",
    "urgent: rollback",
  ])("marks urgent: %s", (text) => {
    expect(classifyTaskPriority(text)).toBe("urgent");
  });

  it.each(["テストを回して", "新しいアプリを作って", "READMEを更新"])(
    "marks normal: %s",
    (text) => {
      expect(classifyTaskPriority(text)).toBe("normal");
    },
  );
});
