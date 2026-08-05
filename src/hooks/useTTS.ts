import { useCallback, useRef, useState } from "react";

// 読み上げ速度(1が標準)。既定はやや速めの1.2倍。UIから変更でき、localStorageに保存される
export const DEFAULT_TTS_RATE = 1.2;
export const TTS_RATE_STORAGE_KEY = "claude-voice:tts-rate";
const MIN_TTS_RATE = 0.5;
const MAX_TTS_RATE = 3;

// 読み上げ終了後もこの猶予の間はエコー判定の対象に残す(認識の確定が遅れて届くため)
const ECHO_GRACE_MS = 2500;
// onend が取りこぼされた場合の保険。これより古いエントリは無条件に捨てる
const SPOKEN_TTL_MS = 60_000;

interface SpokenEntry {
  text: string;
  startedAt: number;
  endedAt: number | null;
}

function loadStoredRate(): number {
  try {
    const v = Number(window.localStorage?.getItem(TTS_RATE_STORAGE_KEY));
    return Number.isFinite(v) && v >= MIN_TTS_RATE && v <= MAX_TTS_RATE ? v : DEFAULT_TTS_RATE;
  } catch {
    return DEFAULT_TTS_RATE;
  }
}

export interface UseTTS {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** 読み上げ速度(1が標準)。 */
  rate: number;
  setRate: (v: number) => void;
  /** Speak, cancelling anything currently being spoken (used for interjections). */
  speakNow: (text: string) => void;
  /** Queue after current speech (used for chat replies). */
  speak: (text: string) => void;
  cancel: () => void;
  /** 現在読み上げ中かどうか(バージイン判定用)。 */
  isSpeaking: () => boolean;
  /** エコー判定に使う、読み上げ中〜直後のテキスト一覧。 */
  recentSpokenTexts: () => string[];
}

export function useTTS(): UseTTS {
  const [enabled, setEnabled] = useState(true);
  const enabledRef = useRef(true);
  const [rate, setRate] = useState(loadStoredRate);
  const rateRef = useRef(rate);
  const spokenRef = useRef<SpokenEntry[]>([]);

  const prune = useCallback(() => {
    const now = Date.now();
    spokenRef.current = spokenRef.current.filter(
      (e) =>
        now - e.startedAt <= SPOKEN_TTL_MS &&
        (e.endedAt === null || now - e.endedAt <= ECHO_GRACE_MS),
    );
  }, []);

  const markAllEnded = useCallback(() => {
    const now = Date.now();
    for (const e of spokenRef.current) if (e.endedAt === null) e.endedAt = now;
  }, []);

  const setEnabledBoth = useCallback(
    (v: boolean) => {
      enabledRef.current = v;
      setEnabled(v);
      if (!v) {
        window.speechSynthesis?.cancel();
        markAllEnded();
      }
    },
    [markAllEnded],
  );

  const setRateBoth = useCallback((v: number) => {
    const clamped = Math.min(MAX_TTS_RATE, Math.max(MIN_TTS_RATE, v));
    rateRef.current = clamped;
    setRate(clamped);
    try {
      window.localStorage?.setItem(TTS_RATE_STORAGE_KEY, String(clamped));
    } catch {
      /* private mode等で保存できなくても動作は継続 */
    }
  }, []);

  const utter = useCallback(
    (text: string) => {
      const entry: SpokenEntry = { text, startedAt: Date.now(), endedAt: null };
      prune();
      spokenRef.current.push(entry);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ja-JP";
      u.rate = rateRef.current;
      u.onend = () => {
        entry.endedAt = Date.now();
      };
      u.onerror = () => {
        entry.endedAt = Date.now();
      };
      window.speechSynthesis.speak(u);
    },
    [prune],
  );

  const speak = useCallback(
    (text: string) => {
      if (!enabledRef.current || !window.speechSynthesis || !text.trim()) return;
      utter(text);
    },
    [utter],
  );

  const speakNow = useCallback(
    (text: string) => {
      if (!enabledRef.current || !window.speechSynthesis || !text.trim()) return;
      window.speechSynthesis.cancel();
      utter(text);
    },
    [utter],
  );

  const cancel = useCallback(() => {
    window.speechSynthesis?.cancel();
    markAllEnded();
  }, [markAllEnded]);

  const isSpeaking = useCallback(() => window.speechSynthesis?.speaking === true, []);

  const recentSpokenTexts = useCallback(() => {
    prune();
    return spokenRef.current.map((e) => e.text);
  }, [prune]);

  return {
    enabled,
    setEnabled: setEnabledBoth,
    rate,
    setRate: setRateBoth,
    speakNow,
    speak,
    cancel,
    isSpeaking,
    recentSpokenTexts,
  };
}
