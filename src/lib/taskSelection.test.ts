import { describe, expect, it } from "vitest";
import {
  focusTargetKind,
  isSelectableTask,
  resolveTaskReference,
  shortTaskId,
  taskLabel,
} from "./taskSelection";

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

  it("rejects a legacy payload that omits sessionId entirely", () => {
    // 旧サーバーの /api/tasks は sessionId キー自体を返さない。
    // undefined を「セッションあり」と誤認して選択可にしない
    expect(isSelectableTask({ ...base, status: "succeeded", sessionId: undefined })).toBe(false);
  });
});

describe("focusTargetKind", () => {
  it("実行中タスクへのフォーカスは追加指示(append)として送る", () => {
    expect(focusTargetKind({ ...base, status: "running", sessionId: null })).toBe("append");
    expect(focusTargetKind({ ...base, status: "running", sessionId: "s1" })).toBe("append");
  });

  it("セッションを残した完了タスクへのフォーカスは追いタスク(resume)として送る", () => {
    expect(focusTargetKind({ ...base, status: "succeeded", sessionId: "s1" })).toBe("resume");
    expect(focusTargetKind({ ...base, status: "failed", sessionId: "s1" })).toBe("resume");
    expect(focusTargetKind({ ...base, status: "cancelled", sessionId: "s1" })).toBe("resume");
  });

  it("セッションのない完了タスクはフォーカスできない", () => {
    expect(focusTargetKind({ ...base, status: "succeeded", sessionId: null })).toBeNull();
  });

  it("sessionIdキーの無いレガシーな完了タスクはフォーカスできない(resume誤判定しない)", () => {
    expect(focusTargetKind({ ...base, status: "succeeded", sessionId: undefined })).toBeNull();
  });
});

describe("taskLabel", () => {
  it("連番があれば #n で示す", () => {
    expect(taskLabel({ id: "abc12345", seq: 3 })).toBe("#3");
  });

  it("連番の無いレガシーなタスクは短縮IDで示す(#undefined を出さない)", () => {
    expect(taskLabel({ id: "0f3c9a7e-1234-4abc-9def-000000000001" })).toBe("0f3c9a7e");
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

  it("resolves a legacy long id by its displayed short id (unique prefix)", () => {
    const legacy = [
      { id: "0f3c9a7e-1234-4abc-9def-000000000001", seq: 1 },
      { id: "def67890", seq: 2 },
    ];
    expect(resolveTaskReference(legacy, "0f3c9a7e")?.seq).toBe(1);
  });

  it("does not resolve an ambiguous prefix", () => {
    const twins = [
      { id: "abcd1111", seq: 1 },
      { id: "abcd2222", seq: 2 },
    ];
    expect(resolveTaskReference(twins, "abcd")).toBeUndefined();
  });

  it("prefers sequence numbers over numeric id prefixes", () => {
    const tricky = [
      { id: "12345678", seq: 1 },
      { id: "def67890", seq: 12 },
    ];
    // "12" は seq 12 のタスク(短縮IDのプレフィックスではなく連番として解決)
    expect(resolveTaskReference(tricky, "12")?.seq).toBe(12);
  });

  it("does not prefix-match too-short references", () => {
    const legacy = [{ id: "abcdef12-3456-7890-abcd-ef1234567890", seq: 1 }];
    expect(resolveTaskReference(legacy, "abc")).toBeUndefined();
  });
});

describe("shortTaskId", () => {
  it("returns the first 8 characters of a long id", () => {
    expect(shortTaskId("0f3c9a7e-1234-4abc-9def-000000000001")).toBe("0f3c9a7e");
  });

  it("returns short ids unchanged", () => {
    expect(shortTaskId("abc12345")).toBe("abc12345");
  });
});
