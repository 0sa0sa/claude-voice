import { describe, expect, it } from "vitest";
import { groupByProject, splitTasks } from "./taskDisplay";

type Status = "running" | "succeeded" | "failed" | "cancelled";

function task(id: string, status: Status, startedAt: number, endedAt?: number | null) {
  return { id, status, startedAt, endedAt: endedAt ?? null };
}

describe("splitTasks", () => {
  it("pins running tasks in the running group regardless of order", () => {
    const { running, finished } = splitTasks([
      task("a", "succeeded", 100, 200),
      task("b", "running", 50),
      task("c", "failed", 120, 180),
    ]);
    expect(running.map((t) => t.id)).toEqual(["b"]);
    expect(finished.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("sorts running tasks newest-first by start time", () => {
    const { running } = splitTasks([
      task("old", "running", 100),
      task("new", "running", 300),
      task("mid", "running", 200),
    ]);
    expect(running.map((t) => t.id)).toEqual(["new", "mid", "old"]);
  });

  it("sorts finished tasks newest-first by end time, falling back to start time", () => {
    const { finished } = splitTasks([
      task("endedEarly", "succeeded", 100, 150),
      task("noEnd", "cancelled", 400),
      task("endedLate", "failed", 100, 500),
    ]);
    expect(finished.map((t) => t.id)).toEqual(["endedLate", "noEnd", "endedEarly"]);
  });

  it("returns empty groups for an empty list", () => {
    expect(splitTasks([])).toEqual({ running: [], finished: [] });
  });
});

describe("groupByProject", () => {
  const pt = (id: string, project: string) => ({ id, project });

  it("groups tasks by project preserving first-appearance order", () => {
    const groups = groupByProject([
      pt("a", "voice"),
      pt("b", "navi"),
      pt("c", "voice"),
      pt("d", "navi"),
    ]);
    expect(groups.map((g) => g.project)).toEqual(["voice", "navi"]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["a", "c"]);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(["b", "d"]);
  });

  it("keeps the order of tasks inside each group as given", () => {
    const groups = groupByProject([pt("z", "voice"), pt("a", "voice")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["z", "a"]);
  });

  it("returns an empty list for no tasks", () => {
    expect(groupByProject([])).toEqual([]);
  });
});
