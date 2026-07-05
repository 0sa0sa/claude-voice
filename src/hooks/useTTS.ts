import { useCallback, useRef, useState } from "react";

export interface UseTTS {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** Speak, cancelling anything currently being spoken (used for interjections). */
  speakNow: (text: string) => void;
  /** Queue after current speech (used for chat replies). */
  speak: (text: string) => void;
  cancel: () => void;
}

export function useTTS(): UseTTS {
  const [enabled, setEnabled] = useState(true);
  const enabledRef = useRef(true);

  const setEnabledBoth = useCallback((v: boolean) => {
    enabledRef.current = v;
    setEnabled(v);
    if (!v) window.speechSynthesis?.cancel();
  }, []);

  const utter = useCallback((text: string) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    u.rate = 1.15;
    window.speechSynthesis.speak(u);
  }, []);

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

  const cancel = useCallback(() => window.speechSynthesis?.cancel(), []);

  return { enabled, setEnabled: setEnabledBoth, speakNow, speak, cancel };
}
