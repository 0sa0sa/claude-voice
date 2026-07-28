import { describe, expect, it } from "vitest";
import { buildThreadTimeline, collectThreadTasks } from "./taskThread";
import type { ThreadTaskLike } from "./taskThread";

function task(over: Partial<ThreadTaskLike> & { id: string; seq: number }): ThreadTaskLike {
  return {
    instruction: `指示 ${over.id}`,
    status: "succeeded",
    startedAt: 1000 * over.seq,
    endedAt: 1000 * over.seq + 500,
    result: null,
    error: null,
    sessionId: null,
    resumedFrom: null,
    ...over,
  };
}

describe("collectThreadTasks", () => {
  it("引き継ぎ関係のない単独タスクは自分だけのスレッドになる", () => {
    const a = task({ id: "a", seq: 1 });
    const other = task({ id: "x", seq: 2 });
    expect(collectThreadTasks([a, other], "a")).toEqual([a]);
  });

  it("resumedFrom→sessionIdの連鎖を根から辿り、開始順に返す", () => {
    const a = task({ id: "a", seq: 1, sessionId: "s-a" });
    const b = task({ id: "b", seq: 2, sessionId: "s-b", resumedFrom: "s-a" });
    const c = task({ id: "c", seq: 3, resumedFrom: "s-b" });
    const other = task({ id: "x", seq: 4, sessionId: "s-x" });
    // 途中のタスクを指しても同じスレッド全体が返る
    expect(collectThreadTasks([c, other, a, b], "b").map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(collectThreadTasks([c, other, a, b], "a").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("同じタスクから複数の追いタスクが分岐しても全員同じスレッドに入る", () => {
    const a = task({ id: "a", seq: 1, sessionId: "s-a" });
    const b = task({ id: "b", seq: 2, resumedFrom: "s-a" });
    const c = task({ id: "c", seq: 3, resumedFrom: "s-a" });
    expect(collectThreadTasks([a, b, c], "c").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("見つからないIDは空を返す", () => {
    expect(collectThreadTasks([task({ id: "a", seq: 1 })], "zzz")).toEqual([]);
  });

  it("セッション参照が循環していても停止する", () => {
    const a = task({ id: "a", seq: 1, sessionId: "s-a", resumedFrom: "s-b" });
    const b = task({ id: "b", seq: 2, sessionId: "s-b", resumedFrom: "s-a" });
    const ids = collectThreadTasks([a, b], "a").map((t) => t.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
  });
});

describe("buildThreadTimeline", () => {
  it("指示→追加指示→結果を時系列に並べる", () => {
    const a = task({
      id: "a",
      seq: 1,
      status: "succeeded",
      startedAt: 1000,
      endedAt: 5000,
      result: "できました",
    });
    const events = new Map([
      [
        "a",
        [
          { kind: "instruction", text: "READMEも更新して", at: 2000 },
          // instruction以外のイベント(tool/delta)はタイムラインに出さない
          { kind: "tool", text: "Bash", at: 3000 },
        ],
      ],
    ]);
    expect(buildThreadTimeline([a], events)).toEqual([
      { kind: "instruction", taskId: "a", seq: 1, text: "指示 a", at: 1000 },
      { kind: "appended", taskId: "a", seq: 1, text: "READMEも更新して", at: 2000 },
      { kind: "result", taskId: "a", seq: 1, text: "できました", at: 5000 },
    ]);
  });

  it("追いタスクの指示・結果も同じ時系列に混ざる", () => {
    const a = task({
      id: "a",
      seq: 1,
      status: "succeeded",
      startedAt: 1000,
      endedAt: 2000,
      result: "1回目の結果",
      sessionId: "s-a",
    });
    const b = task({
      id: "b",
      seq: 3,
      status: "failed",
      startedAt: 3000,
      endedAt: 4000,
      error: "テストが落ちました",
      resumedFrom: "s-a",
    });
    expect(buildThreadTimeline([a, b]).map((e) => [e.kind, e.seq, e.at])).toEqual([
      ["instruction", 1, 1000],
      ["result", 1, 2000],
      ["instruction", 3, 3000],
      ["error", 3, 4000],
    ]);
  });

  it("実行中タスクは結果エントリを持たない", () => {
    const a = task({ id: "a", seq: 1, status: "running", startedAt: 1000, endedAt: null });
    expect(buildThreadTimeline([a])).toEqual([
      { kind: "instruction", taskId: "a", seq: 1, text: "指示 a", at: 1000 },
    ]);
  });
});
