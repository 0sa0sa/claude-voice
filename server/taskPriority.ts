import type { QueuePriority } from "./taskQueue.js";

/**
 * 指示文から緊急度を判定する。「緊急」「至急」「今すぐ」等を含む依頼は
 * urgent として実行キューで優先され、戻ってきた結果も最優先で通知される。
 * クライアント側 src/lib/urgency.ts と同じ語彙を保つこと。
 */
const URGENT_PATTERNS = [
  /緊急/,
  /大至急/,
  /至急/,
  /今すぐ/,
  /いますぐ/,
  /すぐに/,
  /急いで/,
  /最優先/,
  /優先(で|して|的)/,
  /\basap\b/i,
  /\burgent\b/i,
];

export function classifyTaskPriority(instruction: string): QueuePriority {
  return URGENT_PATTERNS.some((re) => re.test(instruction)) ? "urgent" : "normal";
}
