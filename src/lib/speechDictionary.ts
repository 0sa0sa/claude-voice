/**
 * ユーザー登録の補正辞書(誤認識されがちな読み → 正しい表記)を
 * 音声認識結果テキストへ適用する。ブラウザの音声認識はカスタム語彙を
 * 指定できないため、認識後のテキスト置換で補正する。
 */

export interface DictionaryEntry {
  /** 誤認識されがちな読み(認識結果に現れる文字列) */
  wrong: string;
  /** 正しい表記 */
  right: string;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * text 中の登録済み誤認識パターンをすべて正しい表記へ置換する。
 * 1パスの置換で、置換後のテキストが別パターンに再マッチしないようにする。
 * 同じ位置に複数パターンが並ぶ場合は長い方を優先する。
 */
export function applyDictionary(text: string, entries: DictionaryEntry[]): string {
  const valid = entries.filter((e) => e.wrong.length > 0);
  if (valid.length === 0) return text;
  const byWrong = new Map(valid.map((e) => [e.wrong, e.right]));
  const pattern = [...byWrong.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return text.replace(new RegExp(pattern, "g"), (m) => byWrong.get(m) ?? m);
}
