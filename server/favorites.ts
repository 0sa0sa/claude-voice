import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Hono } from "hono";

/**
 * サイドバーに表示するお気に入りプロジェクト名の永続化。
 * ブラウザを跨いでも同じ一覧になるよう、辞書と同じ ~/.claude-voice 配下に保存する。
 */

function normalize(names: unknown): string[] {
  if (!Array.isArray(names)) throw new Error("favorites must be an array");
  const seen = new Set<string>();
  for (const n of names) {
    if (typeof n !== "string") throw new Error("each favorite must be a string");
    const name = n.trim();
    if (name) seen.add(name); // 空エントリは黙って捨てる、重複は先勝ち
  }
  return [...seen];
}

export class FavoritesStore {
  constructor(private filePath: string) {}

  /** お気に入り一覧。ファイルが無い・壊れているときは空(=全件表示のフォールバック) */
  async list(): Promise<string[]> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8"));
      return normalize(raw.favorites);
    } catch {
      return [];
    }
  }

  /** 一覧全体を置き換えて永続化する。不正な入力は例外 */
  async replace(names: string[]): Promise<string[]> {
    const normalized = normalize(names);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ favorites: normalized }, null, 2), "utf8");
    return normalized;
  }
}

/**
 * /api/favorites 配下にマウントするサブアプリ。GET: 取得、POST: 全置換。
 * onChange は保存成功時に呼ばれる(プロジェクト一覧キャッシュの無効化用)。
 */
export function createFavoritesApp(store: FavoritesStore, onChange?: () => void) {
  const app = new Hono();
  app.get("/", async (c) => c.json({ favorites: await store.list() }));
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const favorites = await store.replace(body.favorites);
      onChange?.();
      return c.json({ favorites });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
  return app;
}
