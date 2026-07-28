/**
 * タスクフォーカスの音声/テキストコマンド解析。
 * 「タスク3」「#3」「3番」などの短い発話をフォーカス指定、
 * 「選択解除」などをクリア指定として解釈する。
 */
export type FocusCommand = { kind: "focus"; seq: number } | { kind: "clear" };

// 「タスク3」「タスク#3」「#3」「3番」+ 任意の選択動詞(を選択/を選んで/を開いて/にフォーカス)
const FOCUS_RE =
  /^(?:タスク\s*[##]?\s*(\d+)\s*番?|[##](\d+)|(\d+)\s*番)(?:\s*(?:を\s*(?:選択|選んで|開いて)|に\s*フォーカス)\s*(?:して)?)?$/;

// 「選択解除」「フォーカス解除」「タスクの選択を解除して」など
const CLEAR_RE = /^(?:タスク\s*の?\s*)?(?:選択|フォーカス)\s*を?\s*(?:解除|クリア)\s*(?:して)?$/;

export function parseTaskFocusCommand(text: string): FocusCommand | null {
  // 音声認識由来の末尾句読点・空白は落としてから判定する
  const t = text.trim().replace(/[、。..!!??\s]+$/, "");
  if (!t) return null;
  if (CLEAR_RE.test(t)) return { kind: "clear" };
  const m = FOCUS_RE.exec(t);
  if (!m) return null;
  const seq = Number(m[1] ?? m[2] ?? m[3]);
  return { kind: "focus", seq };
}
