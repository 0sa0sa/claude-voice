import { describe, expect, it } from "vitest";
import { visibleProjects } from "./projectFavorites";

interface P {
  name: string;
}

const projects: P[] = [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }];

describe("visibleProjects", () => {
  it("shows every project when no favorites are registered (first-run fallback)", () => {
    expect(visibleProjects(projects, [], null)).toEqual(projects);
  });

  it("shows only favorited projects, keeping the scanned order", () => {
    expect(visibleProjects(projects, ["gamma", "alpha"], null).map((p) => p.name)).toEqual([
      "alpha",
      "gamma",
    ]);
  });

  it("keeps the active project visible even when it is not favorited", () => {
    expect(visibleProjects(projects, ["alpha"], "beta").map((p) => p.name)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("ignores favorites that no longer exist on disk", () => {
    expect(visibleProjects(projects, ["alpha", "deleted"], null).map((p) => p.name)).toEqual([
      "alpha",
    ]);
  });
});
