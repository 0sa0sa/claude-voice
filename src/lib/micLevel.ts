/** マイクの発光・波形演出に使う純粋計算部分(Web Audio APIには依存しない)。 */

/** 周波数データ(0-255)を barCount 個のバーに均等分割し、0-1に正規化した平均値を返す。 */
export function computeBars(freqData: Uint8Array, barCount: number): number[] {
  if (barCount <= 0) return [];

  const sums = new Array(barCount).fill(0);
  const counts = new Array(barCount).fill(0);
  for (let j = 0; j < freqData.length; j++) {
    const bar = Math.min(barCount - 1, Math.floor((j * barCount) / freqData.length));
    sums[bar] += freqData[j];
    counts[bar]++;
  }
  return sums.map((sum, i) => (counts[i] === 0 ? 0 : sum / counts[i] / 255));
}

/** prev から target へ factor の割合だけ近づける指数移動平均。急激な変化を滑らかにする。 */
export function smoothLevel(prev: number, target: number, factor: number): number {
  const next = prev + (target - prev) * factor;
  return Math.min(1, Math.max(0, next));
}
