/**
 * TTS読み上げのエコー(自分の合成音声がマイクに回り込んで認識された文字列)を
 * 判定するための純関数群。
 */

/** 比較用の正規化: NFKC → 小文字化 → カタカナをひらがなへ → 記号・空白を除去。 */
export function normalizeEchoText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function bigrams(s: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < s.length - 1; i++) result.push(s.slice(i, i + 2));
  return result;
}

/** 文字bigramのDice係数 (0..1)。同音異字などの部分的な認識ズレに強い。 */
export function diceSimilarity(a: string, b: string): number {
  if (a === b) return a.length > 0 ? 1 : 0;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  if (aGrams.length === 0 || bGrams.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of aGrams) counts.set(g, (counts.get(g) ?? 0) + 1);
  let intersection = 0;
  for (const g of bGrams) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      intersection++;
      counts.set(g, c - 1);
    }
  }
  return (2 * intersection) / (aGrams.length + bGrams.length);
}

/**
 * 認識テキストが直近のTTS読み上げテキストのエコーかどうか。
 * - 部分一致: interim は読み上げ文の断片として伸びていくため、包含で拾う
 * - 類似度: 認識エンジンの表記ゆれ(かな/漢字)は bigram Dice で吸収する
 */
export function isLikelyEcho(
  recognized: string,
  spokenTexts: string[],
  opts?: { similarityThreshold?: number },
): boolean {
  const threshold = opts?.similarityThreshold ?? 0.6;
  const r = normalizeEchoText(recognized);
  if (!r) return false;
  for (const spoken of spokenTexts) {
    const s = normalizeEchoText(spoken);
    if (!s) continue;
    if (s.includes(r)) return true;
    if (diceSimilarity(r, s) >= threshold) return true;
  }
  return false;
}
