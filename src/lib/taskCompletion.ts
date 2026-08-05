/**
 * タスクの結果テキストが「作業完了の報告」ではなく、実装を進めずに
 * ユーザーへ質問・確認を投げ返しただけかを推定する。
 * worker Claudeはスコープが曖昧な依頼を受けると実装せずに選択肢を提示して
 * 止まることがあり、その場合もプロセス自体は正常終了するためstatusは
 * succeededになる。文面のパターンから「要確認」を検出する(あくまで推定であり、
 * 完全な精度は前提にしない)。
 */

const CLARIFICATION_PHRASES = [
  // 日本語
  "確認してください",
  "確認をお願い",
  "教えてください",
  "ご指示ください",
  "指示をお願い",
  "指示してください",
  "選んでください",
  "どちらにしますか",
  "どちらがよい",
  "いかがでしょうか",
  "いかがいたしましょう",
  "でよろしいでしょうか",
  "進めてよいですか",
  "進めても良いですか",
  "よろしいですか",
  // 英語(REPORT_STYLE_DIRECTIVEでmarkdown/箇条書きを禁じていても、
  // worker Claudeが英語で質問を返すことがあるため両方見る)
  "let me know",
  "please confirm",
  "please clarify",
  "could you clarify",
  "which of the following",
  "what would you like",
  "before i proceed",
  "before proceeding",
  "first question",
];

// 「A) …」「- **B)** …」のような選択肢の列挙。質問で選択を迫っている強いサイン
const CHOICE_MARKER = /(^|\n)\s*-?\s*\*{0,2}[A-DＡ-Ｄ][)）]/;

export function needsClarification(result: string | null | undefined): boolean {
  if (!result) return false;
  const text = result.trim();
  if (!text) return false;

  const lastLine = text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  if (/[?？]\s*$/.test(lastLine)) return true;

  const lower = text.toLowerCase();
  if (CLARIFICATION_PHRASES.some((p) => lower.includes(p.toLowerCase()))) return true;

  return CHOICE_MARKER.test(text);
}
