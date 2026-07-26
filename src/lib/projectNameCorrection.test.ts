import { describe, expect, it } from "vitest";
import { correctProjectNames, projectNameReading } from "./projectNameCorrection";

describe("projectNameReading: 英語プロジェクト名のかな読み", () => {
  it("converts an English word to its katakana-style hiragana reading", () => {
    expect(projectNameReading("kindergarten")).toBe("きんだーがーてん");
  });

  it("handles nasal consonants before other consonants", () => {
    expect(projectNameReading("tempo")).toBe("てんぽ");
  });

  it("splits hyphenated names and joins the word readings", () => {
    expect(projectNameReading("claude-voice")).toBe("くろーどぼいす");
  });

  it("reads y as a vowel when it is the syllable nucleus", () => {
    expect(projectNameReading("sync")).toBe("しんく");
  });
});

describe("correctProjectNames: 発音類似度による補正", () => {
  it("corrects a katakana rendering of the project name", () => {
    expect(correctProjectNames("キンダーガーテンのテストを直して", ["kindergarten"])).toBe(
      "kindergartenのテストを直して",
    );
  });

  it("corrects a near-miss katakana rendering (voiced consonant difference)", () => {
    expect(correctProjectNames("キンダーガーデンのタスクを実行して", ["kindergarten"])).toBe(
      "kindergartenのタスクを実行して",
    );
  });

  it("picks the closest project name when several are registered", () => {
    expect(correctProjectNames("キンダーガーデンで実行", ["tempo", "kindergarten"])).toBe(
      "kindergartenで実行",
    );
  });

  it("corrects a hyphenated project name spoken as katakana", () => {
    expect(correctProjectNames("クロードボイスのビルドを回して", ["claude-voice"])).toBe(
      "claude-voiceのビルドを回して",
    );
  });
});

describe("correctProjectNames: 既知の誤変換(翻訳・言語モデル起因)", () => {
  it.each(["幼稚園", "金曜日", "稲毛店"])(
    "corrects %s to kindergarten when the project exists",
    (wrong) => {
      expect(correctProjectNames(`${wrong}のタスクを実行して`, ["kindergarten"])).toBe(
        "kindergartenのタスクを実行して",
      );
    },
  );

  it("leaves known aliases alone when the project is not in the list", () => {
    expect(correctProjectNames("幼稚園のタスクを実行して", ["tempo"])).toBe(
      "幼稚園のタスクを実行して",
    );
  });
});

describe("correctProjectNames: 誤補正の防止", () => {
  it("leaves unrelated katakana words untouched", () => {
    expect(correctProjectNames("タスクをキャンセルして", ["kindergarten"])).toBe(
      "タスクをキャンセルして",
    );
  });

  it("leaves dissimilar katakana words untouched even below the名前長", () => {
    expect(correctProjectNames("テンポが大事", ["kindergarten"])).toBe("テンポが大事");
  });

  it("leaves ordinary Japanese sentences untouched", () => {
    expect(correctProjectNames("今日のテストを全部直して", ["kindergarten"])).toBe(
      "今日のテストを全部直して",
    );
  });

  it("is idempotent: text already containing the correct name is unchanged", () => {
    expect(correctProjectNames("kindergartenのタスクを実行して", ["kindergarten"])).toBe(
      "kindergartenのタスクを実行して",
    );
  });

  it("returns the text unchanged when the project list is empty", () => {
    expect(correctProjectNames("キンダーガーデンのタスク", [])).toBe("キンダーガーデンのタスク");
  });

  it("does not correct when similarity is below the threshold", () => {
    // ガーデンセンター: 一部の音(がーでん)は共通するが全体としては別物
    expect(correctProjectNames("ガーデンセンターに行く", ["kindergarten"])).toBe(
      "ガーデンセンターに行く",
    );
  });
});
