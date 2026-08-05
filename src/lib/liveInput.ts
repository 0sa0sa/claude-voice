/**
 * 発話認識テキスト欄(live-strip の textarea)の表示制御。
 * ブラウザ差(field-sizing 非対応)に依存せず、内容に合わせて高さを伸ばし、
 * 認識で追記された最新の発話が常に見えるよう末尾へ追従スクロールする。
 */

/** 折りたたみ表示の高さ上限(約3行ぶん) */
export const COLLAPSED_MAX_PX = 63;
/** 展開表示の高さ上限。これを超える長文は欄内スクロールで全文を確認できる */
export const EXPANDED_MAX_PX = 280;

/** これを超える長さ(または改行入り)の発話に全文展開トグルを出す */
const OFFER_EXPAND_CHARS = 40;

interface LiveInputLike {
  scrollHeight: number;
  scrollTop: number;
  style: { height: string };
}

export function syncLiveInputView(
  el: LiveInputLike,
  opts: { expanded: boolean; follow: boolean },
): void {
  // 非表示中などで高さが測れないときは何もしない(0pxに潰さない)
  if (el.scrollHeight <= 0) return;
  // scrollHeightは明示heightより小さくならないため、一度リセットしてから測る(縮み対応)
  el.style.height = "auto";
  const cap = opts.expanded ? EXPANDED_MAX_PX : COLLAPSED_MAX_PX;
  el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  // 認識による追記のときだけ末尾へ追従する。手動編集中はカーソル位置の視界を保つ
  if (opts.follow) el.scrollTop = el.scrollHeight;
}

export function shouldOfferExpand(text: string): boolean {
  return text.length > OFFER_EXPAND_CHARS || text.includes("\n");
}
