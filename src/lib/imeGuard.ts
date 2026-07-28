/**
 * IME変換中(composition中)のキーイベントかどうかを判定する。
 * 変換確定のEnterで送信が走らないようにするためのガード。
 * keyCode 229 は isComposing を立てないブラウザ(古いSafari等)向けのフォールバック。
 */
export function isImeComposing(e: { isComposing?: boolean; keyCode?: number }): boolean {
  return e.isComposing === true || e.keyCode === 229;
}
