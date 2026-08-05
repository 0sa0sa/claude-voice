/**
 * 発話・指示の緊急度判定(クライアント側)。
 * サーバーの server/taskPriority.ts と同じ語彙を保つこと。
 * 緊急発話は発話キューで通常発話より先にディスパッチされる。
 */
export type Urgency = "urgent" | "normal";

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

export function classifyUrgency(text: string): Urgency {
  return URGENT_PATTERNS.some((re) => re.test(text)) ? "urgent" : "normal";
}
