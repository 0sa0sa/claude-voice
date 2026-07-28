import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// testing-library は fake timer の検知に jest グローバルを見るため、
// vitest の vi.useFakeTimers() を使うテストでは検知に失敗し
// findBy*/waitFor が永久に固まる。vi へのブリッジで検知と自動送りを有効にする。
// 実タイマー時は setTimeout に clock プロパティが無いので挙動は変わらない。
(globalThis as { jest?: unknown }).jest = {
  advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
};

afterEach(() => cleanup());
