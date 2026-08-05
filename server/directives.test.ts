import { describe, expect, it } from "vitest";
import { extractDirectives } from "./directives.js";

describe("extractDirectives", () => {
  it("returns clean text unchanged when no directives", () => {
    const r = extractDirectives("普通の返答です。");
    expect(r.directives).toEqual([]);
    expect(r.cleanText).toBe("普通の返答です。");
  });

  it("extracts a start_task directive and strips the line", () => {
    const text =
      'わかりました、テストを回しますね。\n@@CV {"action":"start_task","project":"hojokin-navi","instruction":"npm testを実行して失敗があれば直す"}';
    const r = extractDirectives(text);
    expect(r.directives).toEqual([
      {
        action: "start_task",
        project: "hojokin-navi",
        instruction: "npm testを実行して失敗があれば直す",
      },
    ]);
    expect(r.cleanText).toBe("わかりました、テストを回しますね。");
  });

  it("extracts start_task with a resume reference", () => {
    const r = extractDirectives(
      '続きをやりますね。\n@@CV {"action":"start_task","resume":"ab12cd34","instruction":"レビュー指摘を修正して"}',
    );
    expect(r.directives).toEqual([
      { action: "start_task", resume: "ab12cd34", instruction: "レビュー指摘を修正して" },
    ]);
    expect(r.cleanText).toBe("続きをやりますね。");
  });

  it("drops invalid or blank resume but keeps the directive", () => {
    const r = extractDirectives(
      '@@CV {"action":"start_task","resume":true,"instruction":"a"}\n@@CV {"action":"start_task","resume":"  ","instruction":"b"}\nok',
    );
    expect(r.directives).toEqual([
      { action: "start_task", instruction: "a" },
      { action: "start_task", instruction: "b" },
    ]);
  });

  // 連番でのタスク指定を促すため、モデルがJSON数値でtaskId/resumeを出しても受理する
  it("coerces numeric taskId and resume to strings", () => {
    const r = extractDirectives(
      '@@CV {"action":"append_task","taskId":3,"instruction":"a"}\n@@CV {"action":"cancel_task","taskId":7}\n@@CV {"action":"start_task","resume":3,"instruction":"b"}\nok',
    );
    expect(r.directives).toEqual([
      { action: "append_task", taskId: "3", instruction: "a" },
      { action: "cancel_task", taskId: "7" },
      { action: "start_task", resume: "3", instruction: "b" },
    ]);
  });

  it("extracts switch_project and cancel_task", () => {
    const r = extractDirectives(
      '@@CV {"action":"switch_project","project":"claude-voice"}\n了解です。\n@@CV {"action":"cancel_task","taskId":"t1"}',
    );
    expect(r.directives).toEqual([
      { action: "switch_project", project: "claude-voice" },
      { action: "cancel_task", taskId: "t1" },
    ]);
    expect(r.cleanText).toBe("了解です。");
  });

  it("extracts append_task with taskId and instruction", () => {
    const r = extractDirectives(
      '追加で伝えますね。\n@@CV {"action":"append_task","taskId":"ab12cd34","instruction":"テストも追加して"}',
    );
    expect(r.directives).toEqual([
      { action: "append_task", taskId: "ab12cd34", instruction: "テストも追加して" },
    ]);
    expect(r.cleanText).toBe("追加で伝えますね。");
  });

  it("rejects append_task without taskId or instruction", () => {
    const r = extractDirectives(
      '@@CV {"action":"append_task","instruction":"x"}\n@@CV {"action":"append_task","taskId":"t1"}\n@@CV {"action":"append_task","taskId":" ","instruction":"x"}\nok',
    );
    expect(r.directives).toEqual([]);
    expect(r.cleanText).toBe("ok");
  });

  it("extracts fix_transcript with the corrected text", () => {
    const r = extractDirectives(
      'テンポの件ですね。\n@@CV {"action":"fix_transcript","corrected":"テンポが大事"}',
    );
    expect(r.directives).toEqual([{ action: "fix_transcript", corrected: "テンポが大事" }]);
    expect(r.cleanText).toBe("テンポの件ですね。");
  });

  it("rejects fix_transcript without corrected text", () => {
    const r = extractDirectives('@@CV {"action":"fix_transcript"}\n@@CV {"action":"fix_transcript","corrected":"  "}\nok');
    expect(r.directives).toEqual([]);
    expect(r.cleanText).toBe("ok");
  });

  it("ignores malformed or unknown directives but still strips the marker line", () => {
    const r = extractDirectives('@@CV {broken json\n@@CV {"action":"fly_to_moon"}\nこんにちは');
    expect(r.directives).toEqual([]);
    expect(r.cleanText).toBe("こんにちは");
  });

  it("requires required fields per action", () => {
    const r = extractDirectives(
      '@@CV {"action":"start_task"}\n@@CV {"action":"switch_project"}\nok',
    );
    expect(r.directives).toEqual([]);
    expect(r.cleanText).toBe("ok");
  });
});
