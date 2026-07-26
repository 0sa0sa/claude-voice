import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Hono } from "hono";

/**
 * 音声認識の補正辞書(誤認識されがちな読み → 正しい表記)のサーバー側永続化。
 * ブラウザの音声認識はカスタム語彙を指定できないため、クライアントが
 * この辞書を取得して認識結果テキストへ後処理補正を掛ける。
 */

export interface DictionaryEntry {
  wrong: string;
  right: string;
}

/** 初期辞書: プロジェクト名・開発頻出用語の既知誤認識パターン(UIから編集可能) */
export const DEFAULT_ENTRIES: DictionaryEntry[] = [
  { wrong: "クロードボイス", right: "claude-voice" },
  { wrong: "タイプ チェック", right: "タイプチェック" },
  { wrong: "混みっと", right: "コミット" },
  { wrong: "凛と", right: "リント" },
  { wrong: "毎時して", right: "マージして" },
  { wrong: "振る陸", right: "プルリク" },
  { wrong: "手酢と", right: "テスト" },
  { wrong: "美流度", right: "ビルド" },
];

function normalize(entries: unknown): DictionaryEntry[] {
  if (!Array.isArray(entries)) throw new Error("entries must be an array");
  const byWrong = new Map<string, string>();
  for (const e of entries) {
    if (typeof e?.wrong !== "string" || typeof e?.right !== "string") {
      throw new Error("each entry must have string wrong/right");
    }
    const wrong = e.wrong.trim();
    const right = e.right.trim();
    if (!wrong || !right) continue; // 空エントリは黙って捨てる(UIの空行対策)
    byWrong.set(wrong, right); // 同じ読みは後勝ち
  }
  return [...byWrong.entries()].map(([wrong, right]) => ({ wrong, right }));
}

export class DictionaryStore {
  constructor(private filePath: string) {}

  /** 現在の辞書。ファイルが無い・壊れているときは初期辞書を返す */
  async list(): Promise<DictionaryEntry[]> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf8"));
      return normalize(raw.entries);
    } catch {
      return DEFAULT_ENTRIES;
    }
  }

  /** 辞書全体を置き換えて永続化する。不正な入力は例外 */
  async replace(entries: DictionaryEntry[]): Promise<DictionaryEntry[]> {
    const normalized = normalize(entries);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ entries: normalized }, null, 2), "utf8");
    return normalized;
  }
}

/** /api/dictionary 配下にマウントするサブアプリ。GET: 取得、POST: 全置換 */
export function createDictionaryApp(store: DictionaryStore) {
  const app = new Hono();
  app.get("/", async (c) => c.json({ entries: await store.list() }));
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json({ entries: await store.replace(body.entries) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });
  return app;
}
