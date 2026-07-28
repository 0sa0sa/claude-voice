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

const KANA_CHAR = /[ぁ-ゖー]/u;
const ALL_KANA = /^[ぁ-ゖー]+$/u;
// 漢字1文字の読みはおおむね1〜4モーラ。読み(かな)側で許すギャップ幅の上限
const READING_CHARS_PER_NON_KANA = 4;
// 拾い始めの遅れで読みの先頭が欠けた場合に許す先頭ギャップ
const LOOSE_LEAD_GAP = 6;
// 偶然の一致を弾くため、最低このかな文字数の一致を要求する
const MIN_MATCHED_KANA = 5;
const TAIL_SLACK = 3;

interface KanaRun {
  text: string;
  /** このかな連の直前にある非かな(漢字等)の文字数。 */
  precedingNonKana: number;
}

function kanaRuns(s: string): { runs: KanaRun[]; trailingNonKana: number } {
  const runs: KanaRun[] = [];
  let gap = 0;
  let cur = "";
  for (const ch of s) {
    if (KANA_CHAR.test(ch)) {
      cur += ch;
    } else {
      if (cur) {
        runs.push({ text: cur, precedingNonKana: gap });
        cur = "";
        gap = 0;
      }
      gap++;
    }
  }
  if (cur) runs.push({ text: cur, precedingNonKana: gap });
  return { runs, trailingNonKana: cur ? 0 : gap };
}

/** r の pos 以降・maxGap 以内から始まり r の末尾で切れる runText の先頭部分の長さ。 */
function partialRunAtTail(r: string, runText: string, pos: number, maxGap: number): number {
  for (let gap = 0; gap <= maxGap; gap++) {
    const start = pos + gap;
    const len = r.length - start;
    if (len <= 0) break;
    if (len < runText.length && r.slice(start) === runText.slice(0, len)) return len;
  }
  return 0;
}

/**
 * 認識結果(全文かな)が spoken の「読み」かどうか。
 *
 * TTSエコーの確定結果は漢字がかな読みのまま届くことが多く、bigram照合では
 * 拾えない。読み上げテキストのかな部分(助詞・送りがな)は読みの中にも同じ
 * 順序でそのまま現れるため、かな連が順序どおり・漢字読み分のギャップ内で
 * 追跡できたらエコーとみなす。漢字を含む認識結果は変換に成功した本物の発話の
 * 可能性が高いため適用しない(語彙の近い割り込みを殺さない)。
 */
function matchesKanaReading(spokenNorm: string, recognizedNorm: string): boolean {
  if (!ALL_KANA.test(recognizedNorm)) return false;
  const { runs, trailingNonKana } = kanaRuns(spokenNorm);
  const r = recognizedNorm;
  for (let start = 0; start < runs.length; start++) {
    let pos = 0;
    let matched = 0;
    let runsConsumed = 0;
    let exhausted = false; // 認識が読みの途中で切れた(部分エコー)
    let failed = false;
    for (let i = start; i < runs.length; i++) {
      const run = runs[i];
      const readingGap = run.precedingNonKana * READING_CHARS_PER_NON_KANA;
      const maxGap = i === start && start > 0 ? Math.max(readingGap, LOOSE_LEAD_GAP) : readingGap;
      if (pos >= r.length) {
        exhausted = true;
        break;
      }
      const idx = r.indexOf(run.text, pos);
      if (idx !== -1 && idx - pos <= maxGap) {
        matched += run.text.length;
        pos = idx + run.text.length;
        runsConsumed++;
        continue;
      }
      const partial = partialRunAtTail(r, run.text, pos, maxGap);
      if (partial > 0) {
        matched += partial;
        pos = r.length;
        runsConsumed++;
        exhausted = true;
      } else {
        failed = true;
      }
      break;
    }
    if (failed || matched < MIN_MATCHED_KANA) continue;
    // 裏付けとなる連が1つだけの一致は、活用語尾などの偶然一致になりやすいため
    // 末尾のゆるい許容(TAIL_SLACK)を与えない(読みが途中で切れた場合を除く)
    const tailAllowance =
      trailingNonKana * READING_CHARS_PER_NON_KANA + (runsConsumed > 1 ? TAIL_SLACK : 0);
    if (exhausted || r.length - pos <= tailAllowance) return true;
  }
  return false;
}

/**
 * 認識テキストが直近のTTS読み上げテキストのエコーかどうか。
 * - 部分一致: interim は読み上げ文の断片として伸びていくため、包含で拾う
 * - 類似度: 認識エンジンの表記ゆれ(かな/漢字)は bigram Dice で吸収する
 * - 読み照合: 漢字変換されずかなのまま確定したエコーは、かな連の順序追跡で拾う
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
    if (matchesKanaReading(s, r)) return true;
  }
  return false;
}
