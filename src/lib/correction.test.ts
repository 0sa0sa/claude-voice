import { describe, expect, it } from "vitest";
import { applyCorrection, integrateFinal } from "./correction";

describe("applyCorrection: 「AじゃなくてB」", () => {
  it("replaces the misheard word in the preceding text and drops the correction utterance", () => {
    expect(applyCorrection(["店舗が大事だと思う"], "店舗じゃなくてテンポ")).toEqual([
      "テンポが大事だと思う",
    ]);
  });

  it("handles ではなくて / じゃなく variants and punctuation", () => {
    expect(applyCorrection(["店舗を上げたい。"], "店舗ではなくて、テンポ。")).toEqual([
      "テンポを上げたい。",
    ]);
    expect(applyCorrection(["店舗を上げたい"], "店舗じゃなくテンポ")).toEqual([
      "テンポを上げたい",
    ]);
  });

  it("replaces the last occurrence when the wrong term appears multiple times", () => {
    expect(applyCorrection(["店舗の話。店舗が大事"], "店舗じゃなくてテンポ")).toEqual([
      "店舗の話。テンポが大事",
    ]);
  });

  it("matches a suffix of the wrong part so leading fillers do not break the correction", () => {
    expect(applyCorrection(["店舗が大事"], "えっと店舗じゃなくてテンポ")).toEqual([
      "テンポが大事",
    ]);
  });

  it("returns null when the wrong term is not in the preceding text (normal speech)", () => {
    expect(applyCorrection(["ボタンの色を変えて"], "赤じゃなくて青にして")).toBeNull();
  });

  it("returns null when there is no preceding text", () => {
    expect(applyCorrection([], "店舗じゃなくてテンポ")).toBeNull();
  });

  it("keeps a trailing 送信 command as its own segment after correcting", () => {
    expect(applyCorrection(["店舗が大事"], "店舗じゃなくてテンポ送信")).toEqual([
      "テンポが大事",
      "送信",
    ]);
  });
});

describe("applyCorrection: 「今のは〜の間違い」", () => {
  it("replaces the last final segment with the restated text", () => {
    expect(applyCorrection(["店舗が大事"], "今のはテンポが大事の間違い")).toEqual([
      "テンポが大事",
    ]);
  });

  it("keeps earlier segments untouched", () => {
    expect(
      applyCorrection(["最初の指示。", "店舗が大事"], "今のはテンポが大事の間違いです"),
    ).toEqual(["最初の指示。", "テンポが大事"]);
  });

  it("accepts さっきの as the referent", () => {
    expect(applyCorrection(["店舗が大事"], "さっきのはテンポが大事の間違い")).toEqual([
      "テンポが大事",
    ]);
  });

  it("returns null when there is no preceding text", () => {
    expect(applyCorrection([], "今のはテンポの間違い")).toBeNull();
  });
});

describe("applyCorrection: non-corrections", () => {
  it("returns null for ordinary speech", () => {
    expect(applyCorrection(["前の発話"], "普通の発話です")).toBeNull();
  });
});

describe("integrateFinal", () => {
  it("applies a correction when one is detected", () => {
    expect(integrateFinal(["店舗が大事"], "店舗じゃなくてテンポ")).toEqual(["テンポが大事"]);
  });

  it("appends the utterance unchanged otherwise", () => {
    expect(integrateFinal(["前の発話"], "次の発話")).toEqual(["前の発話", "次の発話"]);
  });
});

describe("integrateFinal: プロジェクト名の自動補正", () => {
  it("corrects a known misrecognition of an English project name before appending", () => {
    expect(integrateFinal([], "幼稚園のタスクを実行して", ["kindergarten"])).toEqual([
      "kindergartenのタスクを実行して",
    ]);
  });

  it("corrects a katakana rendering of the project name", () => {
    expect(integrateFinal(["前の発話"], "キンダーガーデンで実行", ["kindergarten"])).toEqual([
      "前の発話",
      "kindergartenで実行",
    ]);
  });

  it("applies project-name correction before interpreting a voice-correction command", () => {
    expect(
      integrateFinal(["テンポのタスク"], "テンポじゃなくてキンダーガーデン", ["kindergarten"]),
    ).toEqual(["kindergartenのタスク"]);
  });

  it("leaves unrelated utterances untouched even with a project list", () => {
    expect(integrateFinal(["前の発話"], "次の発話", ["kindergarten"])).toEqual([
      "前の発話",
      "次の発話",
    ]);
  });
});
