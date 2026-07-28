import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

/**
 * サイドバーのプロジェクト一覧はお気に入り登録したものだけを表示し、
 * 「編集」から全プロジェクト一覧を開いて追加・除外できる。
 */

const recentProjects = [
  { name: "alpha", hasGit: true, hasPackageJson: true },
  { name: "beta", hasGit: true, hasPackageJson: true },
  { name: "gamma", hasGit: true, hasPackageJson: false },
];
// all=1 のときだけ返る古いプロジェクト(全一覧からの追加を確かめる用)
const allProjects = [...recentProjects, { name: "stale", hasGit: false, hasPackageJson: false }];

let favoritesState: string[];
let favoritesPosts: string[][];

beforeEach(() => {
  vi.restoreAllMocks();
  favoritesState = [];
  favoritesPosts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/favorites")) {
        if (init?.method === "POST") {
          favoritesState = JSON.parse(String(init.body)).favorites;
          favoritesPosts.push(favoritesState);
        }
        return Response.json({ favorites: favoritesState });
      }
      if (path.includes("/api/projects")) {
        // 実サーバーの契約を模す: 通常一覧は「最近触った+お気に入り」、all=1 は全件
        const recentNames = new Set(recentProjects.map((p) => p.name));
        const projects = path.includes("all=1")
          ? allProjects
          : allProjects.filter((p) => recentNames.has(p.name) || favoritesState.includes(p.name));
        return Response.json({ projects, active: null });
      }
      if (path.includes("/api/tasks")) return Response.json({ tasks: [] });
      if (path.includes("/api/workspace")) return Response.json({ ok: true, active: "alpha" });
      return Response.json({ interject: false, question: "" });
    }),
  );
});

function sidebar() {
  return screen.getByRole("complementary", { name: "プロジェクト" });
}

describe("App project favorites", () => {
  it("shows only favorited projects in the sidebar", async () => {
    favoritesState = ["alpha", "gamma"];
    render(<App />);
    await waitFor(() =>
      expect(within(sidebar()).getByRole("button", { name: "alpha" })).toBeInTheDocument(),
    );
    expect(within(sidebar()).getByRole("button", { name: "gamma" })).toBeInTheDocument();
    expect(within(sidebar()).queryByRole("button", { name: "beta" })).not.toBeInTheDocument();
  });

  it("shows all projects while no favorites are registered", async () => {
    render(<App />);
    await waitFor(() =>
      expect(within(sidebar()).getByRole("button", { name: "alpha" })).toBeInTheDocument(),
    );
    expect(within(sidebar()).getByRole("button", { name: "beta" })).toBeInTheDocument();
    expect(within(sidebar()).getByRole("button", { name: "gamma" })).toBeInTheDocument();
    // 最近触っていないプロジェクトも「全件」に含まれる(recentのみのフォールバックではない)
    expect(within(sidebar()).getByRole("button", { name: "stale" })).toBeInTheDocument();
  });

  it("adds a project to the sidebar from the full list picker", async () => {
    favoritesState = ["alpha"];
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(within(sidebar()).getByRole("button", { name: "alpha" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "プロジェクトを編集" }));
    // ピッカーは全一覧(all=1)を出すので、最近触っていない stale も選べる
    const staleToggle = await screen.findByRole("checkbox", { name: "stale" });
    expect(screen.getByRole("checkbox", { name: "alpha" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "beta" })).not.toBeChecked();

    await user.click(staleToggle);
    await waitFor(() => expect(favoritesPosts).toContainEqual(["alpha", "stale"]));
    await waitFor(() =>
      expect(within(sidebar()).getByRole("button", { name: "stale" })).toBeInTheDocument(),
    );
  });

  it("removes a project from the sidebar via the picker", async () => {
    favoritesState = ["alpha", "beta"];
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() =>
      expect(within(sidebar()).getByRole("button", { name: "beta" })).toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "プロジェクトを編集" }));
    await user.click(await screen.findByRole("checkbox", { name: "beta" }));

    await waitFor(() => expect(favoritesPosts).toContainEqual(["alpha"]));
    await waitFor(() =>
      expect(within(sidebar()).queryByRole("button", { name: "beta" })).not.toBeInTheDocument(),
    );
  });
});
