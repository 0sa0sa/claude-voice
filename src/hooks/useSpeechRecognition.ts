import { useCallback, useEffect, useRef, useState } from "react";
import { emptyTranscript, type TranscriptState } from "../lib/transcript";
import { integrateFinal } from "../lib/correction";
import { applyDictionary, type DictionaryEntry } from "../lib/speechDictionary";

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
  /** trueを返した認識テキストはTTSのエコーとみなして破棄する。 */
  isEcho?: (text: string) => boolean;
  /** 補正辞書として使うプロジェクト名一覧。誤認識された名前を自動補正する。 */
  projectNames?: string[];
  /** ユーザー登録の補正辞書。確定セグメントの誤認識パターンを置換する。 */
  dictionary?: DictionaryEntry[];
}): UseSpeechRecognition {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript());
  // transcriptの最新値をミラーする。次状態はこのrefから同期計算し、setTranscript の
  // updater 内では副作用(onUpdate/ドラフト更新)を一切呼ばない。updater は
  // React 19/StrictMode で複数回実行されるため、内側の setState は再レンダーに
  // 反映されず、認識テキストが入力欄に出ない不具合の原因になる。
  const transcriptRef = useRef<TranscriptState>(transcript);
  const recRef = useRef<any>(null);
  const keepAliveRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const onUpdateRef = useRef(opts?.onUpdate);
  onUpdateRef.current = opts?.onUpdate;
  const isEchoRef = useRef(opts?.isEcho);
  isEchoRef.current = opts?.isEcho;
  const projectNamesRef = useRef(opts?.projectNames);
  projectNamesRef.current = opts?.projectNames;
  const dictionaryRef = useRef(opts?.dictionary);
  dictionaryRef.current = opts?.dictionary;
  const supported = isSpeechRecognitionSupported();

  const releaseMic = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

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
      // TTSの読み上げがマイクに回り込んで認識された分は破棄する
      const isEcho = isEchoRef.current;
      const keptFinals = isEcho ? finals.filter((f) => !isEcho(f)) : finals;
      if (interim && isEcho?.(interim)) interim = "";
      const prev = transcriptRef.current;
      if (keptFinals.length === 0 && interim === prev.interim) return;
      // 確定セグメントは、ユーザー辞書→プロジェクト名の誤認識補正→
      // 「〜じゃなくて〜」等の訂正コマンド解釈の順で取り込む
      const dictionary = dictionaryRef.current;
      const next: TranscriptState = {
        finals: keptFinals.reduce(
          (acc, f) =>
            integrateFinal(
              acc,
              dictionary?.length ? applyDictionary(f, dictionary) : f,
              projectNamesRef.current,
            ),
          prev.finals,
        ),
        interim,
      };
      // 次状態はrefから同期計算済み。setTranscriptは値渡しで純粋に反映し、
      // 副作用(onUpdate)はupdaterの外で1回だけ呼ぶ
      transcriptRef.current = next;
      setTranscript(next);
      onUpdateRef.current?.(next);
    };
    rec.onend = () => {
      // Chrome stops recognition after silence; restart while the mic is on.
      if (keepAliveRef.current) {
        try {
          rec.start();
        } catch {
          recRef.current = null;
          setListening(false);
          releaseMic();
        }
      } else {
        recRef.current = null;
        setListening(false);
        releaseMic();
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
    // エコーキャンセル等を有効にしたマイクストリームを認識中は保持し、
    // ブラウザのAECがTTS出力の回り込みを抑えるようにする(取得失敗でも認識は継続)。
    void navigator.mediaDevices
      ?.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      .then((stream) => {
        if (!keepAliveRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStreamRef.current = stream;
      })
      .catch(() => {});
  }, [opts?.lang, releaseMic]);

  const stop = useCallback(() => {
    keepAliveRef.current = false;
    recRef.current?.stop();
    releaseMic();
  }, [releaseMic]);

  const reset = useCallback(() => {
    const empty = emptyTranscript();
    transcriptRef.current = empty;
    setTranscript(empty);
  }, []);

  useEffect(
    () => () => {
      keepAliveRef.current = false;
      recRef.current?.stop();
      releaseMic();
    },
    [releaseMic],
  );

  return { listening, transcript, supported, start, stop, reset };
}
