/**
 * 音声認識の確定テキストと、送信前ドラフトへのユーザーの手動編集をマージする。
 *
 * - 未編集(draft === prevFinals)なら認識結果に完全追従する。訂正コマンドによる
 *   過去セグメントの書き換えもそのまま反映される。
 * - 手動編集済みなら編集内容を土台に、新しく増えた認識分だけを末尾に追記する。
 * - 編集済みかつ認識側の過去が書き換わった(追記でない)場合は、手動編集を
 *   壊さないことを優先し、編集内容をそのまま保持する。
 */
export function mergeRecognizedText(
  draft: string,
  prevFinals: string,
  nextFinals: string,
): string {
  if (draft === prevFinals) return nextFinals;
  if (nextFinals === prevFinals) return draft;
  if (nextFinals.startsWith(prevFinals)) return draft + nextFinals.slice(prevFinals.length);
  return draft;
}
