import { describe, expect, it } from "vitest";
import { insertByPriority, makeUtterance, takeNext } from "./dispatchQueue";
import type { QueuedUtterance } from "./dispatchQueue";

const u = (id: string, text: string): QueuedUtterance => makeUtterance(id, text);

describe("makeUtterance", () => {
  it("classifies urgency from the text", () => {
    expect(u("1", "緊急でデプロイ").urgency).toBe("urgent");
    expect(u("2", "テストを回して").urgency).toBe("normal");
  });
});

describe("insertByPriority", () => {
  it("appends normal utterances to the tail", () => {
    const q = [u("a", "ふつう1"), u("b", "ふつう2")];
    expect(insertByPriority(q, u("c", "ふつう3")).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("inserts urgent before the first normal, keeping urgents FIFO", () => {
    const q = [u("u1", "至急1"), u("n1", "ふつう1"), u("n2", "ふつう2")];
    const out = insertByPriority(q, u("u2", "緊急2"));
    expect(out.map((x) => x.id)).toEqual(["u1", "u2", "n1", "n2"]);
  });

  it("appends urgent to the tail when there is no normal yet", () => {
    const q = [u("u1", "至急1")];
    expect(insertByPriority(q, u("u2", "緊急2")).map((x) => x.id)).toEqual(["u1", "u2"]);
  });
});

describe("takeNext", () => {
  it("pops the head and returns the rest", () => {
    const { next, rest } = takeNext([u("a", "1"), u("b", "2")]);
    expect(next?.id).toBe("a");
    expect(rest.map((x) => x.id)).toEqual(["b"]);
  });

  it("returns nothing for an empty queue", () => {
    expect(takeNext([]).next).toBeUndefined();
  });
});
