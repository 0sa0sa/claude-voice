import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDictionaryApp, DEFAULT_ENTRIES, DictionaryStore } from "./dictionary.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cv-dict-"));
  path = join(dir, "nested", "dictionary.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("DictionaryStore", () => {
  it("seeds default entries when the file does not exist", async () => {
    const store = new DictionaryStore(path);
    const entries = await store.list();
    expect(entries).toEqual(DEFAULT_ENTRIES);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("persists replaced entries across instances", async () => {
    const store = new DictionaryStore(path);
    await store.replace([{ wrong: "毎時", right: "マージ" }]);
    const reloaded = new DictionaryStore(path);
    expect(await reloaded.list()).toEqual([{ wrong: "毎時", right: "マージ" }]);
  });

  it("writes valid JSON to the file", async () => {
    const store = new DictionaryStore(path);
    await store.replace([{ wrong: "凛と", right: "リント" }]);
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.entries).toEqual([{ wrong: "凛と", right: "リント" }]);
  });

  it("trims fields and drops empty or duplicate entries", async () => {
    const store = new DictionaryStore(path);
    const saved = await store.replace([
      { wrong: " 毎時 ", right: " マージ " },
      { wrong: "", right: "x" },
      { wrong: "凛と", right: "" },
      { wrong: "毎時", right: "merge" }, // 後勝ち
    ]);
    expect(saved).toEqual([{ wrong: "毎時", right: "merge" }]);
  });

  it("rejects malformed input", async () => {
    const store = new DictionaryStore(path);
    await expect(store.replace("not an array" as never)).rejects.toThrow();
    await expect(store.replace([{ wrong: 1, right: "x" }] as never)).rejects.toThrow();
  });

  it("returns defaults when the file is corrupt", async () => {
    const store = new DictionaryStore(path);
    await store.replace([{ wrong: "a", right: "b" }]);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "{broken json", "utf8");
    const reloaded = new DictionaryStore(path);
    expect(await reloaded.list()).toEqual(DEFAULT_ENTRIES);
  });
});

describe("dictionary API", () => {
  it("GET / returns the current entries", async () => {
    const app = createDictionaryApp(new DictionaryStore(path));
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { entries: unknown };
    expect(json.entries).toEqual(DEFAULT_ENTRIES);
  });

  it("POST / replaces the entries", async () => {
    const store = new DictionaryStore(path);
    const app = createDictionaryApp(store);
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: [{ wrong: "毎時", right: "マージ" }] }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { entries: unknown };
    expect(json.entries).toEqual([{ wrong: "毎時", right: "マージ" }]);
    expect(await store.list()).toEqual([{ wrong: "毎時", right: "マージ" }]);
  });

  it("POST / with malformed entries returns 400", async () => {
    const app = createDictionaryApp(new DictionaryStore(path));
    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entries: [{ wrong: 1 }] }),
    });
    expect(res.status).toBe(400);
  });
});
