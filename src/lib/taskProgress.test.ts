import { describe, expect, it } from "vitest";
import { buildLiveProgress } from "./taskProgress";

const at = 1_700_000_000_000;

describe("buildLiveProgress", () => {
  it("直近のツール実行だけを時系列順に最大3件返す", () => {
    const events = [
      { kind: "tool", text: "Read: src/App.tsx", at },
      { kind: "instruction", text: "テストも足して", at: at + 1 },
      { kind: "tool", text: "Edit: src/App.tsx", at: at + 2 },
      { kind: "tool", text: "Bash: npm test", at: at + 3 },
      { kind: "tool", text: "Bash: npm run lint", at: at + 4 },
    ];
    const p = buildLiveProgress({ events, liveText: null });
    expect(p.tools).toEqual(["Edit: src/App.tsx", "Bash: npm test", "Bash: npm run lint"]);
  });

  it("短い出力はそのまま、余白だけ整えて返す", () => {
    const p = buildLiveProgress({ events: [], liveText: "  テストを実行しています…\n" });
    expect(p.tail).toBe("テストを実行しています…");
  });

  it("長い出力は末尾だけを切り出し、省略を…で示す", () => {
    const live = `${"あ".repeat(1000)}最新の出力END`;
    const p = buildLiveProgress({ events: [], liveText: live });
    expect(p.tail.length).toBeLessThanOrEqual(401);
    expect(p.tail.startsWith("…")).toBe(true);
    expect(p.tail.endsWith("最新の出力END")).toBe(true);
  });

  it("イベントも出力も無ければ空の途中経過を返す", () => {
    expect(buildLiveProgress({})).toEqual({ tools: [], tail: "" });
    expect(buildLiveProgress({ events: undefined, liveText: undefined })).toEqual({
      tools: [],
      tail: "",
    });
  });
});
