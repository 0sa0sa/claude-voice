import { describe, expect, it } from "vitest";
import { isSelectableTask, resolveTaskReference } from "./taskSelection";

const base = {
  id: "t1",
  project: "claude-voice",
  instruction: "テストを実行する",
  startedAt: 0,
  lastEvent: null,
  result: null,
  error: null,
  resumedFrom: null,
};

describe("isSelectableTask", () => {
  it("allows a succeeded task that kept a session", () => {
    expect(isSelectableTask({ ...base, status: "succeeded", sessionId: "s1" })).toBe(true);
  });

  it("allows a failed task that kept a session (retry follow-up)", () => {
    expect(isSelectableTask({ ...base, status: "failed", sessionId: "s1" })).toBe(true);
  });

  it("rejects a running task even with a session", () => {
    expect(isSelectableTask({ ...base, status: "running", sessionId: "s1" })).toBe(false);
  });

  it("rejects a finished task without a session", () => {
    expect(isSelectableTask({ ...base, status: "succeeded", sessionId: null })).toBe(false);
  });
});

describe("resolveTaskReference", () => {
  const tasks = [
    { id: "abc12345", seq: 1 },
    { id: "def67890", seq: 2 },
  ];

  it("resolves by exact task id", () => {
    expect(resolveTaskReference(tasks, "abc12345")?.seq).toBe(1);
  });

  it("resolves by sequence number, with or without a leading #", () => {
    expect(resolveTaskReference(tasks, "2")?.id).toBe("def67890");
    expect(resolveTaskReference(tasks, "#1")?.id).toBe("abc12345");
    expect(resolveTaskReference(tasks, " #2 ")?.id).toBe("def67890");
  });

  it("returns undefined for unknown references", () => {
    expect(resolveTaskReference(tasks, "99")).toBeUndefined();
    expect(resolveTaskReference(tasks, "zzz")).toBeUndefined();
    expect(resolveTaskReference(tasks, "")).toBeUndefined();
  });
});
