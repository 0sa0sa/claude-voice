import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createFavoritesApp, FavoritesStore } from "./favorites.js";

const dir = mkdtempSync(join(tmpdir(), "cv-favorites-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("FavoritesStore", () => {
  it("returns an empty list when the file does not exist", async () => {
    const store = new FavoritesStore(join(dir, "none", "favorites.json"));
    expect(await store.list()).toEqual([]);
  });

  it("persists a replaced list and reads it back from disk", async () => {
    const path = join(dir, "persist", "favorites.json");
    const store = new FavoritesStore(path);
    await store.replace(["claude-voice", "hojokin-navi"]);
    // 別インスタンスで読み直す = 再起動後も保持される
    expect(await new FavoritesStore(path).list()).toEqual(["claude-voice", "hojokin-navi"]);
  });

  it("dedupes names and drops empty strings", async () => {
    const store = new FavoritesStore(join(dir, "dedupe.json"));
    const result = await store.replace(["a", "a", "", "  ", "b"]);
    expect(result).toEqual(["a", "b"]);
  });

  it("rejects non-string entries", async () => {
    const store = new FavoritesStore(join(dir, "invalid.json"));
    await expect(store.replace([1 as unknown as string])).rejects.toThrow();
  });

  it("returns an empty list when the file is corrupted", async () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "{not json");
    expect(await new FavoritesStore(path).list()).toEqual([]);
  });
});

describe("createFavoritesApp", () => {
  it("GET / returns the stored favorites", async () => {
    const store = new FavoritesStore(join(dir, "api-get.json"));
    await store.replace(["claude-voice"]);
    const app = createFavoritesApp(store);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ favorites: ["claude-voice"] });
  });

  it("POST / replaces the favorites and returns the new list", async () => {
    const store = new FavoritesStore(join(dir, "api-post.json"));
    const app = createFavoritesApp(store);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites: ["alpha", "beta"] }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ favorites: ["alpha", "beta"] });
    expect(await store.list()).toEqual(["alpha", "beta"]);
  });

  it("POST / rejects invalid payloads with 400", async () => {
    const store = new FavoritesStore(join(dir, "api-bad.json"));
    const app = createFavoritesApp(store);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites: "not-an-array" }),
    });
    expect(res.status).toBe(400);
  });

  it("notifies onChange after a successful replace (for cache invalidation)", async () => {
    const store = new FavoritesStore(join(dir, "api-notify.json"));
    const onChange = vi.fn();
    const app = createFavoritesApp(store, onChange);
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites: ["alpha"] }),
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("does not notify onChange when the payload is invalid", async () => {
    const store = new FavoritesStore(join(dir, "api-notify-bad.json"));
    const onChange = vi.fn();
    const app = createFavoritesApp(store, onChange);
    await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ favorites: 42 }),
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
