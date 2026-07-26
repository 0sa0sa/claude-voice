// 読み上げ用のクリップ。表示は全文のまま、音声だけ文の区切りで自然に省略する。
export const SPEECH_CLIP_MAX_CHARS = 200;

const BOUNDARY = new Set(["。", "！", "？", "!", "?", "\n"]);

/**
 * maxChars を超えるテキストを、収まる範囲の最後の文境界で切り詰める。
 * 境界が見つからない場合のみ文字数で切って「…」を付ける。
 */
export function clipForSpeech(text: string, maxChars = SPEECH_CLIP_MAX_CHARS): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  let cut = -1;
  for (let i = 0; i < maxChars; i++) {
    const ch = t[i];
    // ASCIIピリオドは小数点(1.2等)を文境界と誤認しないよう、直後が空白か末尾のときだけ境界扱い
    if (BOUNDARY.has(ch) || (ch === "." && (i + 1 >= t.length || /\s/.test(t[i + 1])))) {
      cut = i + 1;
    }
  }
  if (cut > 0) return t.slice(0, cut).trim();
  return `${t.slice(0, maxChars).trim()}…`;
}
