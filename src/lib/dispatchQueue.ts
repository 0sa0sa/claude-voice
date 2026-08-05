import { classifyUrgency, type Urgency } from "./urgency.js";

/**
 * 発話ディスパッチキュー(純粋ロジック)。
 *
 * ユーザーが立て続けに話しても発話を取りこぼさず、順番に処理するための待ち行列。
 * 緊急(urgent)発話は通常(normal)発話より前に割り込むが、同じ緊急度内では
 * 発話順(FIFO)を保つ。実際のディスパッチ(送信/割り込み)は呼び出し側が行い、
 * ここは「次に処理すべき発話」を決める順序付けだけを担う。
 */
export interface QueuedUtterance {
  id: string;
  text: string;
  urgency: Urgency;
}

export function makeUtterance(id: string, text: string): QueuedUtterance {
  return { id, text, urgency: classifyUrgency(text) };
}

/**
 * 優先度を保った位置に発話を挿入する。
 * - normal は末尾へ。
 * - urgent は「既存の urgent 群の直後・最初の normal の直前」へ(urgent同士はFIFO)。
 */
export function insertByPriority(
  queue: QueuedUtterance[],
  item: QueuedUtterance,
): QueuedUtterance[] {
  if (item.urgency === "normal") return [...queue, item];
  const firstNormal = queue.findIndex((q) => q.urgency === "normal");
  if (firstNormal === -1) return [...queue, item];
  return [...queue.slice(0, firstNormal), item, ...queue.slice(firstNormal)];
}

/** 先頭(最優先)の発話を取り出す。 */
export function takeNext(queue: QueuedUtterance[]): {
  next?: QueuedUtterance;
  rest: QueuedUtterance[];
} {
  if (queue.length === 0) return { rest: [] };
  const [next, ...rest] = queue;
  return { next, rest };
}
