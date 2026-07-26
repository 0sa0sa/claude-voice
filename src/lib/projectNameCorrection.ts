/**
 * 音声認識が英語プロジェクト名をカタカナや別の日本語語彙に誤変換したものを、
 * サーバーのプロジェクト一覧を補正辞書として自動補正する。
 *
 * - 発音由来の誤認識(キンダーガーデン 等)は、プロジェクト名をかな読みに正規化し、
 *   認識テキスト中のカタカナ/英字トークンとの編集距離ベースの類似度で判定する。
 *   閾値未満は補正しない(誤補正の防止)。
 * - 翻訳・言語モデル由来の誤変換(幼稚園・金曜日 等)は発音類似では原理的に捉えられない
 *   ため、既知エイリアス表で対応する。該当プロジェクトが一覧に存在するときだけ有効。
 */

// 英語プロジェクト名ごとの既知誤変換。認識器が意味翻訳や頻出語への
// 言語モデル補完で置き換えてしまうパターンを列挙する(発音では検出不能)。
export const KNOWN_MISRECOGNITIONS: Record<string, string[]> = {
  kindergarten: ["幼稚園", "金曜日", "稲毛店"],
};

// 補正を許す類似度(1 - 編集距離/最大長)の下限。
// 濁音1文字違い(キンダーガーデン: 0.875)は通し、部分一致どまり(0.5前後)は弾く値
const DEFAULT_THRESHOLD = 0.75;

// 子音行 → [あ,い,う,え,お] 段のかな。英単語→かな読み変換に使う
const KANA_ROWS: Record<string, [string, string, string, string, string]> = {
  "": ["あ", "い", "う", "え", "お"],
  k: ["か", "き", "く", "け", "こ"],
  g: ["が", "ぎ", "ぐ", "げ", "ご"],
  s: ["さ", "し", "す", "せ", "そ"],
  z: ["ざ", "じ", "ず", "ぜ", "ぞ"],
  t: ["た", "ち", "つ", "て", "と"],
  d: ["だ", "ぢ", "づ", "で", "ど"],
  n: ["な", "に", "ぬ", "ね", "の"],
  h: ["は", "ひ", "ふ", "へ", "ほ"],
  b: ["ば", "び", "ぶ", "べ", "ぼ"],
  p: ["ぱ", "ぴ", "ぷ", "ぺ", "ぽ"],
  m: ["ま", "み", "む", "め", "も"],
  y: ["や", "い", "ゆ", "いぇ", "よ"],
  r: ["ら", "り", "る", "れ", "ろ"],
  w: ["わ", "うぃ", "う", "うぇ", "うぉ"],
  f: ["ふぁ", "ふぃ", "ふ", "ふぇ", "ふぉ"],
  j: ["じゃ", "じ", "じゅ", "じぇ", "じょ"],
  ch: ["ちゃ", "ち", "ちゅ", "ちぇ", "ちょ"],
  sh: ["しゃ", "し", "しゅ", "しぇ", "しょ"],
};

const VOWELS = "aiueo";
const isVowel = (c: string | undefined): boolean => !!c && VOWELS.includes(c);

// 読み済みかな(digraph母音の先頭文字)→ 段。子音行との合成に使う
const KANA_VOWEL: Record<string, string> = { あ: "a", い: "i", う: "u", え: "e", お: "o" };

// 綴り上の子音を KANA_ROWS の行キーへ正規化する。c は後続母音で音が変わる
function consonantRow(cons: string, nextVowel: string): string {
  if (cons === "c") return "ei".includes(nextVowel) ? "s" : "k";
  if (cons === "q") return "k";
  if (cons === "l") return "r";
  if (cons === "v") return "b";
  if (cons === "th") return "s";
  if (cons === "ph") return "f";
  if (cons === "ck") return "k";
  return cons;
}

/** 単語1語(小文字英字のみ)をかな読み(ひらがな+ー)へ変換する。 */
function wordToKana(raw: string): string {
  let word = raw;
  // 語末の黙字 e を落とす。"ce"/"ge" は軟音なので行だけ差し替える
  if (word.length > 2 && word.endsWith("e") && !VOWELS.includes(word[word.length - 2])) {
    word = word.slice(0, -1);
    if (word.endsWith("c")) word = word.slice(0, -1) + "s";
    if (word.endsWith("g")) word = word.slice(0, -1) + "j";
  }
  // 母音の後ろが続かない y は音節核 (sync, my) なので母音 i として読む
  word = word.replace(/y(?![aiueo])/g, "i");
  let out = "";
  let i = 0;
  while (i < word.length) {
    const ch = word[i];
    if (VOWELS.includes(ch)) {
      const v = parseVowel(word, i);
      out += kana("", v.vowel) + (v.long ? "ー" : "");
      i = v.next;
      continue;
    }
    // 促音: 同じ子音の連続 (pp, tt, ...)
    if (word[i + 1] === ch && !"nm".includes(ch)) {
      out += "っ";
      i++;
      continue;
    }
    // 撥音: n/m の後に母音が続かない
    if ("nm".includes(ch) && !isVowel(word[i + 1])) {
      out += "ん";
      i++;
      continue;
    }
    const digraph = ["sh", "ch", "th", "ph", "ck", "ts"].find((d) => word.startsWith(d, i));
    const cons = digraph ?? ch;
    const after = i + cons.length;
    if (after < word.length && VOWELS.includes(word[after])) {
      const v = parseVowel(word, after);
      out += kana(consonantRow(cons, word[after]), v.vowel) + (v.long ? "ー" : "");
      i = v.next;
    } else {
      // 子音クラスタ内・語末の子音は既定母音で読む (t→ト, d→ド, その他→ウ段)
      const row = consonantRow(cons, "u");
      out += kana(row, cons === "t" || cons === "d" ? "o" : "u");
      i = after;
    }
  }
  return out;
}

// 母音グループ(二重母音・r音性母音を含む)を読む
function parseVowel(word: string, i: number): { vowel: string; long: boolean; next: number } {
  const two = word.slice(i, i + 2);
  const rColored: Record<string, { vowel: string; long: boolean }> = {
    ar: { vowel: "a", long: true },
    er: { vowel: "a", long: true },
    ir: { vowel: "a", long: true },
    ur: { vowel: "a", long: true },
    or: { vowel: "o", long: true },
  };
  // "ar" 等でも直後に母音が続くなら r は次音節の子音 (例: "para")
  if (rColored[two] && !isVowel(word[i + 2])) {
    return { ...rColored[two], next: i + 2 };
  }
  const digraphs: Record<string, string> = {
    ee: "いー",
    ea: "いー",
    oo: "うー",
    au: "おー",
    aw: "おー",
    ai: "えい",
    ay: "えい",
    ei: "えい",
    oi: "おい",
    oy: "おい",
    ou: "あう",
    ow: "あう",
  };
  if (digraphs[two]) return { vowel: digraphs[two], long: false, next: i + 2 };
  return { vowel: word[i], long: false, next: i + 1 };
}

// row + 段をかなへ。読み済みのかな文字列(えい・おー 等)は先頭文字だけ行と合成し、
// 残り(ー や 2文字目の母音)はそのまま続ける
function kana(row: string, vowel: string): string {
  const single = VOWELS.includes(vowel) ? vowel : KANA_VOWEL[vowel[0]];
  const rest = VOWELS.includes(vowel) ? "" : vowel.slice(1);
  if (!single) return vowel;
  return (KANA_ROWS[row] ?? KANA_ROWS[""])[VOWELS.indexOf(single)] + rest;
}

/** プロジェクト名(英字・ハイフン等区切り)のかな読み。比較用の正規化形。 */
export function projectNameReading(name: string): string {
  return name
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map(wordToKana)
    .join("");
}

function katakanaToHiragana(text: string): string {
  return text.replace(/[ァ-ヴ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = cur;
    }
  }
  return dp[b.length];
}

function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

export interface CorrectProjectNamesOptions {
  /** 補正を許す類似度の下限 (0..1)。既定 0.75 */
  threshold?: number;
}

// 補正候補として拾うトークン: カタカナ連続(長音含む) または 英字トークン
const TOKEN_RE = /[ァ-ヴー]+|[A-Za-z][A-Za-z0-9._-]*/g;

/**
 * 認識テキスト中の誤認識語を、projectNames の中で発音が最も近い名前に補正する。
 * 確信が持てない(類似度が閾値未満)場合は元のまま返す。
 */
export function correctProjectNames(
  text: string,
  projectNames: string[],
  opts: CorrectProjectNamesOptions = {},
): string {
  if (projectNames.length === 0) return text;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;

  // 既知誤変換(翻訳・言語モデル起因)は完全一致置換。一覧にある名前の分だけ有効
  let result = text;
  for (const name of projectNames) {
    for (const alias of KNOWN_MISRECOGNITIONS[name.toLowerCase()] ?? []) {
      result = result.split(alias).join(name);
    }
  }

  const dict = projectNames.map((name) => ({ name, reading: projectNameReading(name) }));
  return result.replace(TOKEN_RE, (token) => {
    // 既に正しい名前ならそのまま(冪等性)
    if (projectNames.some((n) => n.toLowerCase() === token.toLowerCase())) return token;
    const tokenReading = /^[A-Za-z]/.test(token)
      ? projectNameReading(token)
      : katakanaToHiragana(token);
    let best: { name: string; score: number } | null = null;
    for (const { name, reading } of dict) {
      const score = similarity(tokenReading, reading);
      if (score >= threshold && (!best || score > best.score)) best = { name, score };
    }
    return best ? best.name : token;
  });
}
