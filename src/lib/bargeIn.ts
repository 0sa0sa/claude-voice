import { isLikelyEcho } from "./echo";

export interface BargeInInput {
  /** この更新で新たに確定した認識テキスト。確定が増えていなければ空文字。 */
  freshFinal: string;
  /** 読み上げ中〜直後のTTSテキスト一覧。 */
  spokenTexts: string[];
  /** 直近に送信した本文。reset後の同一発話の再発火をバージインから除外する。 */
  lastSent: string;
}

/**
 * 読み上げ中の認識更新でTTSを中断(バージイン)すべきかどうか。
 *
 * interim はかな未変換のまま届くことが多く、読み上げテキスト(漢字)との
 * 文字照合をすり抜けてエコーでも「本物の発話」に見えてしまう。そのため
 * 中断の根拠は新たに確定したテキストに限定し、さらにそれが読み上げの拾い直し
 * や送信済み発話の再発火でないときだけ中断する。
 */
export function shouldBargeIn({ freshFinal, spokenTexts, lastSent }: BargeInInput): boolean {
  if (!freshFinal.trim()) return false;
  const refs = lastSent ? [...spokenTexts, lastSent] : spokenTexts;
  return !isLikelyEcho(freshFinal, refs);
}
