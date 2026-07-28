import { useEffect, useRef, useState } from "react";
import { computeBars, smoothLevel } from "../lib/micLevel";

const DEFAULT_BAR_COUNT = 5;
const SMOOTHING = 0.35;

export interface UseMicLevel {
  /** 0-1に正規化した全体の音量レベル(平滑化済み)。 */
  level: number;
  /** 周波数帯ごとのバー表示用レベル(平滑化済み、0-1)。 */
  bars: number[];
}

/**
 * マイク入力中の音量に応じたホログラム波形演出用データを提供する。
 * active が true の間だけ独自にマイクストリームを取得し、AnalyserNodeで解析する。
 */
export function useMicLevel(active: boolean, opts?: { bars?: number }): UseMicLevel {
  const barCount = opts?.bars ?? DEFAULT_BAR_COUNT;
  const [level, setLevel] = useState(0);
  const [bars, setBars] = useState<number[]>(() => new Array(barCount).fill(0));
  const barsRef = useRef(bars);
  const levelRef = useRef(level);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      setBars(new Array(barCount).fill(0));
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let rafId: number | null = null;

    const AudioContextCtor =
      (window as any).AudioContext ?? (window as any).webkitAudioContext;

    void navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        if (cancelled || !AudioContextCtor) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        ctx = new AudioContextCtor();
        const analyser = ctx!.createAnalyser();
        analyser.fftSize = 64;
        const source = ctx!.createMediaStreamSource(s);
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteFrequencyData(data);
          const targetBars = computeBars(data, barCount);
          const targetLevel = targetBars.reduce((a, b) => a + b, 0) / (targetBars.length || 1);
          const nextBars = targetBars.map((t, i) => smoothLevel(barsRef.current[i] ?? 0, t, SMOOTHING));
          const nextLevel = smoothLevel(levelRef.current, targetLevel, SMOOTHING);
          barsRef.current = nextBars;
          levelRef.current = nextLevel;
          setBars(nextBars);
          setLevel(nextLevel);
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [active, barCount]);

  return { level, bars };
}
