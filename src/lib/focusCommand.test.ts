import { describe, expect, it } from "vitest";
import { parseTaskFocusCommand } from "./focusCommand";

describe("parseTaskFocusCommand", () => {
  it("「タスク3」だけの発話をフォーカス指定として解釈する", () => {
    expect(parseTaskFocusCommand("タスク3")).toEqual({ kind: "focus", seq: 3 });
    expect(parseTaskFocusCommand("タスク 12")).toEqual({ kind: "focus", seq: 12 });
    expect(parseTaskFocusCommand("タスク#3")).toEqual({ kind: "focus", seq: 3 });
  });

  it("「#3」「3番」もフォーカス指定として解釈する", () => {
    expect(parseTaskFocusCommand("#3")).toEqual({ kind: "focus", seq: 3 });
    expect(parseTaskFocusCommand("3番")).toEqual({ kind: "focus", seq: 3 });
  });

  it("選択・フォーカスの動詞つきも受け付ける", () => {
    expect(parseTaskFocusCommand("タスク3を選択")).toEqual({ kind: "focus", seq: 3 });
    expect(parseTaskFocusCommand("タスク3を選択して")).toEqual({ kind: "focus", seq: 3 });
    expect(parseTaskFocusCommand("タスク3を選んで")).toEqual({ kind: "focus", seq: 3 });
    expect(parseTaskFocusCommand("タスク3を開いて")).toEqual({ kind: "focus", seq: 3 });
    expect(parseTaskFocusCommand("タスク3にフォーカス")).toEqual({ kind: "focus", seq: 3 });
    expect(parseTaskFocusCommand("タスク3にフォーカスして")).toEqual({ kind: "focus", seq: 3 });
    expect(parseTaskFocusCommand("3番を選択")).toEqual({ kind: "focus", seq: 3 });
  });

  it("末尾の句読点や空白は無視する", () => {
    expect(parseTaskFocusCommand(" タスク3。 ")).toEqual({ kind: "focus", seq: 3 });
  });

  it("選択解除・フォーカス解除をクリア指定として解釈する", () => {
    expect(parseTaskFocusCommand("選択解除")).toEqual({ kind: "clear" });
    expect(parseTaskFocusCommand("フォーカス解除")).toEqual({ kind: "clear" });
    expect(parseTaskFocusCommand("選択を解除して")).toEqual({ kind: "clear" });
    expect(parseTaskFocusCommand("タスクの選択を解除")).toEqual({ kind: "clear" });
  });

  it("通常の指示や依頼はコマンドとして扱わない", () => {
    expect(parseTaskFocusCommand("タスク3を中止して")).toBeNull();
    expect(parseTaskFocusCommand("タスク3の続きでテストを直して")).toBeNull();
    expect(parseTaskFocusCommand("テストを回して")).toBeNull();
    // 数字だけの発話は選択と断定できない(質問への回答などがあり得る)
    expect(parseTaskFocusCommand("3")).toBeNull();
    expect(parseTaskFocusCommand("")).toBeNull();
    expect(parseTaskFocusCommand("   ")).toBeNull();
  });
});
