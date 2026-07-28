import type { ProjectInfo } from "./projects.js";

/**
 * プロジェクト情報のインメモリキャッシュ。
 * scanProjects は毎回 readdir + プロジェクトごとに stat×3 を叩くため、
 * 一覧のポーリングやチャットの[状況]生成のたびに走ると重い。
 * TTL付きでスキャン結果を再利用し、同時リクエストは1回のスキャンを共有する。
 */

interface ProjectIndexDeps {
  scan: (opts: { all: boolean }) => Promise<ProjectInfo[]>;
  resolve: (name: string) => Promise<string | null>;
  /** キャッシュの有効期間(ms) */
  ttlMs?: number;
  /** テスト用の時刻注入 */
  now?: () => number;
}

export const DEFAULT_TTL_MS = 10_000;

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
}

export class ProjectIndex {
  private lists = new Map<string, CacheEntry<ProjectInfo[]>>();
  private inflight = new Map<string, Promise<ProjectInfo[]>>();
  private paths = new Map<string, CacheEntry<string>>();
  private ttlMs: number;
  private now: () => number;

  constructor(private deps: ProjectIndexDeps) {
    this.ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;
    this.now = deps.now ?? Date.now;
  }

  private fresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
    return entry !== undefined && this.now() - entry.cachedAt <= this.ttlMs;
  }

  async list(opts?: { all?: boolean }): Promise<ProjectInfo[]> {
    const all = opts?.all === true;
    const key = all ? "all" : "recent";
    const cached = this.lists.get(key);
    if (this.fresh(cached)) return cached.value;
    // 同時に来たリクエストは同じスキャンを待つ(スキャンの多重起動を防ぐ)
    const running = this.inflight.get(key);
    if (running) return running;
    const scan = this.deps
      .scan({ all })
      .then((value) => {
        this.lists.set(key, { value, cachedAt: this.now() });
        return value;
      })
      .finally(() => this.inflight.delete(key)); // 失敗はキャッシュせず次回再試行
    this.inflight.set(key, scan);
    return scan;
  }

  async resolve(name: string): Promise<string | null> {
    const cached = this.paths.get(name);
    if (this.fresh(cached)) return cached.value;
    const path = await this.deps.resolve(name);
    // 見つからなかった結果はキャッシュしない: 作成直後のプロジェクトを即解決できるように
    if (path !== null) this.paths.set(name, { value: path, cachedAt: this.now() });
    return path;
  }

  /** キャッシュを全て破棄する(プロジェクトの新規作成が分かったときなど) */
  invalidate(): void {
    this.lists.clear();
    this.paths.clear();
  }
}
