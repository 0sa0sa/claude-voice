import { useCallback, useEffect, useRef, useState } from "react";
import { applyRecognition, emptyTranscript, type TranscriptState } from "../lib/transcript";

type SpeechRecognitionCtor = new () => any;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

export interface UseSpeechRecognition {
  listening: boolean;
  transcript: TranscriptState;
  supported: boolean;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useSpeechRecognition(opts?: {
  lang?: string;
  onUpdate?: (t: TranscriptState) => void;
}): UseSpeechRecognition {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript());
  const recRef = useRef<any>(null);
  const keepAliveRef = useRef(false);
  const onUpdateRef = useRef(opts?.onUpdate);
  onUpdateRef.current = opts?.onUpdate;
  const supported = isSpeechRecognitionSupported();

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = opts?.lang ?? "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (event: any) => {
      const finals: string[] = [];
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finals.push(r[0].transcript);
        else interim += r[0].transcript;
      }
      setTranscript((prev) => {
        const next = applyRecognition(prev, finals, interim);
        onUpdateRef.current?.(next);
        return next;
      });
    };
    rec.onend = () => {
      // Chrome stops recognition after silence; restart while the mic is on.
      if (keepAliveRef.current) {
        try {
          rec.start();
        } catch {
          recRef.current = null;
          setListening(false);
        }
      } else {
        recRef.current = null;
        setListening(false);
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        keepAliveRef.current = false;
      }
    };
    keepAliveRef.current = true;
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [opts?.lang]);

  const stop = useCallback(() => {
    keepAliveRef.current = false;
    recRef.current?.stop();
  }, []);

  const reset = useCallback(() => setTranscript(emptyTranscript()), []);

  useEffect(() => () => {
    keepAliveRef.current = false;
    recRef.current?.stop();
  }, []);

  return { listening, transcript, supported, start, stop, reset };
}
