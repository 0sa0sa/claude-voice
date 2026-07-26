/**
 * 音声認識の誤認識をユーザーが声で訂正するためのコマンド検出・適用。
 * 「AじゃなくてB」「今のは〜の間違い」を送信前の認識バッファに適用する。
 */
import { detectSendCommand } from "./transcript";
import { correctProjectNames } from "./projectNameCorrection";

// 「今のは/さっきのは X の間違い」→ 直前セグメントを X で言い直す
const RESTATE_RE =
  /^(?:今の|いまの|さっきの)(?:発言|やつ)?は(.+?)の(?:間違い|まちがい)(?:です|でした|だ|だよ)?$/;

// 「A じゃなくて B」→ 直前テキスト中の A を B に置換(長い接続詞を先に試す)
const REPLACE_RE = /^(.+?)(?:じゃなくて|ではなくて|じゃなく|ではなく)(.+)$/;

// 置換対象を探すときの最短一致長。1文字マッチは誤爆しやすいので許可しない
const MIN_MATCH_LEN = 2;

const trimPunct = (s: string): string =>
  s.replace(/^[。、,.!?！？\s]+/, "").replace(/[。、,.!?！？\s]+$/, "");

function restate(finals: string[], core: string): string[] | null {
  const m = RESTATE_RE.exec(core);
  if (!m) return null;
  const right = trimPunct(m[1]);
  if (!right) return null;
  return [...finals.slice(0, -1), right];
}

function replaceWrong(finals: string[], core: string): string[] | null {
  const m = REPLACE_RE.exec(core);
  if (!m) return null;
  const wrong = trimPunct(m[1]);
  const right = trimPunct(m[2]);
  if (!wrong || !right) return null;
  const joined = finals.join("");
  // 認識には「えっと」等の前置きが混ざるため、wrong の末尾側から最長一致を探す
  for (let start = 0; start <= wrong.length - MIN_MATCH_LEN; start++) {
    const candidate = wrong.slice(start);
    const idx = joined.lastIndexOf(candidate);
    if (idx !== -1) {
      return [joined.slice(0, idx) + right + joined.slice(idx + candidate.length)];
    }
  }
  return null;
}

/**
 * utterance が訂正コマンドなら、それを finals に適用した新しい finals を返す。
 * 訂正でない(または対象が見つからない)場合は null。誤爆を避けるため、
 * 「AじゃなくてB」は A が既存テキストに実在するときだけ訂正として扱う。
 * 末尾の「送信」等はコマンドとして残す(訂正後にそのまま送信できるように)。
 */
export function applyCorrection(finals: string[], utterance: string): string[] | null {
  if (finals.length === 0) return null;
  const send = detectSendCommand(utterance);
  const core = trimPunct(send.triggered ? send.body : utterance);
  if (!core) return null;
  const corrected = restate(finals, core) ?? replaceWrong(finals, core);
  if (!corrected) return null;
  return send.triggered ? [...corrected, "送信"] : corrected;
}

/**
 * 確定セグメントを1つ取り込む: 訂正コマンドなら適用、そうでなければ追記。
 * projectNames があれば、誤認識された英語プロジェクト名を先に自動補正してから
 * 取り込む(「AじゃなくてB」の B に誤認識が混ざっていても訂正が成立する)。
 */
export function integrateFinal(
  finals: string[],
  utterance: string,
  projectNames?: string[],
): string[] {
  const fixed = projectNames?.length ? correctProjectNames(utterance, projectNames) : utterance;
  return applyCorrection(finals, fixed) ?? [...finals, fixed];
}
