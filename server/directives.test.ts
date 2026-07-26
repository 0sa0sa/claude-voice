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
