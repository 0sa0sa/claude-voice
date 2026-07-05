import { describe, expect, it } from "vitest";
import { analyzeTranscript, decideInterjection } from "./interjection.js";

describe("analyzeTranscript", () => {
  it("detects 例の〜 vague references", () => {
    const hit = analyzeTranscript("例のやつをいい感じにしたいんだけど");
    expect(hit).not.toBeNull();
    expect(hit!.reason).toBe("vague-ref");
    expect(hit!.trigger).toContain("例の");
  });

  it("detects あの件/この前の vague references", () => {
    expect(analyzeTranscript("あの件どうなったか教えて")?.reason).toBe("vague-ref");
    expect(analyzeTranscript("この前のデータを使って")?.reason).toBe("vague-ref");
  });

  it("detects vague specs like いい感じに/適当に", () => {
    const hit = analyzeTranscript("トップページをいい感じにして");
    expect(hit?.reason).toBe("vague-spec");
    expect(hit?.question).toContain("いい感じ");
  });

  it("detects unexplained acronyms", () => {
    const hit = analyzeTranscript("QZSSのデータを取り込みたい");
    expect(hit?.reason).toBe("jargon");
    expect(hit?.trigger).toBe("QZSS");
  });

  it("ignores common acronyms", () => {
    expect(analyzeTranscript("APIとURLとHTMLを使う")).toBeNull();
  });

  it("returns null for clear speech", () => {
    expect(analyzeTranscript("ログイン画面にパスワードリセット機能を追加したい")).toBeNull();
  });

  it("returns null for very short input", () => {
    expect(analyzeTranscript("例の")).toBeNull();
  });

  it("skips triggers already seen", () => {
    expect(analyzeTranscript("例のやつをお願いしたい", { seenTriggers: ["例のやつ"] })).toBeNull();
  });

  it("prefers vague-ref over vague-spec when both present", () => {
    const hit = analyzeTranscript("例のやつを適当に直しておいて");
    expect(hit?.reason).toBe("vague-ref");
  });
});

describe("decideInterjection", () => {
  it("returns no interjection when transcript is clear", async () => {
    const res = await decideInterjection({
      transcript: "ログイン画面を作りたい。メール認証つきで。",
      seenTriggers: [],
      ask: async () => "NONE",
    });
    expect(res.interject).toBe(false);
  });

  it("uses the ask function's refined question when available", async () => {
    const res = await decideInterjection({
      transcript: "例のダッシュボードをいい感じにしたい",
      seenTriggers: [],
      ask: async () => "例のダッシュボードとは、先週の売上ダッシュボードのことですか？",
    });
    expect(res.interject).toBe(true);
    expect(res.question).toContain("売上ダッシュボード");
  });

  it("falls back to the heuristic question when ask fails", async () => {
    const res = await decideInterjection({
      transcript: "例のダッシュボードを直したい",
      seenTriggers: [],
      ask: async () => {
        throw new Error("timeout");
      },
    });
    expect(res.interject).toBe(true);
    expect(res.question.length).toBeGreaterThan(0);
    expect(res.trigger).toContain("例の");
  });

  it("respects NONE from the ask function but still interjects with heuristic", async () => {
    // ask says NONE → trust the heuristic hit and use its canned question
    const res = await decideInterjection({
      transcript: "例のダッシュボードを直したい",
      seenTriggers: [],
      ask: async () => "NONE",
    });
    expect(res.interject).toBe(true);
  });

  it("does not interject twice for the same trigger", async () => {
    const first = await decideInterjection({
      transcript: "例のダッシュボードを直したい",
      seenTriggers: [],
      ask: async () => "NONE",
    });
    const second = await decideInterjection({
      transcript: "例のダッシュボードを直したい、色は青で",
      seenTriggers: [first.trigger!],
      ask: async () => "NONE",
    });
    expect(second.interject).toBe(false);
  });
});
