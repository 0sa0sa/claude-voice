import { describe, expect, it } from "vitest";
import { shouldBargeIn } from "./bargeIn";

const SPOKEN = ["タスクの完了を確認しました。テストは全て通っています。"];

describe("shouldBargeIn", () => {
  it("読み上げ中に新たに確定した無関係な発話ではバージインする", () => {
    expect(
      shouldBargeIn({
        freshFinal: "全然別の話なんだけど",
        spokenTexts: SPOKEN,
        lastSent: "タスクを実行して",
      }),
    ).toBe(true);
  });

  it("確定が増えていない(interimのみの)更新ではバージインしない", () => {
    expect(shouldBargeIn({ freshFinal: "", spokenTexts: SPOKEN, lastSent: "" })).toBe(false);
    expect(shouldBargeIn({ freshFinal: "  ", spokenTexts: SPOKEN, lastSent: "" })).toBe(false);
  });

  it("読み上げテキストのエコー(断片・表記ゆれ)ではバージインしない", () => {
    expect(
      shouldBargeIn({ freshFinal: "タスクの完了を確認しました", spokenTexts: SPOKEN, lastSent: "" }),
    ).toBe(false);
    expect(
      shouldBargeIn({
        freshFinal: "たすくの完了を確認しました てすとは全て通っています",
        spokenTexts: SPOKEN,
        lastSent: "",
      }),
    ).toBe(false);
  });

  it("送信済み発話の再発火(末尾に音声コマンドが残る形)ではバージインしない", () => {
    expect(
      shouldBargeIn({
        freshFinal: "タスクを実行して送信",
        spokenTexts: SPOKEN,
        lastSent: "タスクを実行して",
      }),
    ).toBe(false);
    expect(
      shouldBargeIn({ freshFinal: "タスクを実行して", spokenTexts: [], lastSent: "タスクを実行して" }),
    ).toBe(false);
  });

  it("lastSentが空でも無関係な発話ならバージインする", () => {
    expect(
      shouldBargeIn({ freshFinal: "デプロイもお願いします", spokenTexts: SPOKEN, lastSent: "" }),
    ).toBe(true);
  });
});
