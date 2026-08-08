import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "../hooks/useChat";
import type { ChatMessage, DirectiveResult } from "../hooks/useChat";
import { useDispatchQueue } from "../hooks/useDispatchQueue";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { useTTS } from "../hooks/useTTS";
import { useDictionary } from "../hooks/useDictionary";
import { isLikelyEcho } from "../lib/echo";
import { useCvIntent } from "./useCvIntent";
import type { CvIntentResult } from "./useCvIntent";
import type { VoiceCoreSceneApi } from "./useVoiceCoreScene";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface UseVoiceCoreVoiceOptions {
  browserSessionId: string;
  /** cv-intent の判定に使うプロジェクト名一覧(緊急/送信/フォーカスの判定用)。 */
  projectNames: string[];
  sceneApi: React.RefObject<VoiceCoreSceneApi | null>;
  onDirective?: (d: DirectiveResult) => void;
  /**
   * 発話が実際にディスパッチされる直前に、その発話の判定結果を通知する。
   * タスク/プロジェクトパネルのフォーカス・発光(UI/UX④とは別の①②連携)に使う。
   */
  onBeforeDispatch?: (result: CvIntentResult) => void;
}

/**
 * 会話(SSE)・音声認識・TTS・発話ディスパッチキューをまとめて扱うフック。
 * 既存の共有フック(useChat/useDispatchQueue/useSpeechRecognition/useTTS)を
 * そのまま再利用し、radial固有の結線(cv-intentでの緊急/送信判定、3Dコアへの
 * レベル反映)だけをここに足す。
 */
export function useVoiceCoreVoice({
  browserSessionId,
  projectNames,
  sceneApi,
  onDirective,
  onBeforeDispatch,
}: UseVoiceCoreVoiceOptions) {
  const { classify, autoSendMs } = useCvIntent();
  const tts = useTTS();
  const ttsRef = useRef(tts);
  ttsRef.current = tts;
  const dictionary = useDictionary();

  const onDirectiveHandler = useCallback(
    (d: DirectiveResult) => {
      onDirective?.(d);
    },
    [onDirective],
  );

  const chat = useChat(browserSessionId, undefined, onDirectiveHandler);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  // トークン受信ごとにコアが脈打つ(③): messages内の「ストリーミング中の最新メッセージ」の
  // 増分文字数をシーンへ流す。Reactの再レンダーとは無関係に3D側だけが動く。
  const prevLenRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1];
    if (last && last.role === "assistant") {
      const prevLen = prevLenRef.current.get(last.id) ?? 0;
      const grew = last.text.length - prevLen;
      if (grew > 0) sceneApi.current?.bumpLevel(clamp(grew * 0.012, 0, 0.22));
      prevLenRef.current.set(last.id, last.text.length);
    }
    if (chat.messages.length > 60) {
      // 古いエントリの参照を溜め込まない
      const keepIds = new Set(chat.messages.map((m) => m.id));
      for (const id of prevLenRef.current.keys()) if (!keepIds.has(id)) prevLenRef.current.delete(id);
    }
  }, [chat.messages, sceneApi]);
  useEffect(() => {
    sceneApi.current?.setStreaming(chat.busy);
  }, [chat.busy, sceneApi]);

  /** 完了報告等、任意タイミングの読み上げ(タスク完了アナウンス等から呼ばれる)。 */
  const speak = useCallback(
    (text: string, opts?: { urgent?: boolean }) => {
      sceneApi.current?.setSpeaking(true);
      if (opts?.urgent) tts.speakNow(text);
      else tts.speak(text);
    },
    [tts, sceneApi],
  );

  // ttsフックはonstart/onendの通知を外へ出さないため、speechSynthesisの発話状態を
  // ポーリングしてシーン+ステータス表示へ反映する(軽量: 120msごと)
  const [speaking, setSpeakingState] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      const nowSpeaking = tts.isSpeaking();
      sceneApi.current?.setSpeaking(nowSpeaking);
      setSpeakingState((prev) => (prev === nowSpeaking ? prev : nowSpeaking));
    }, 120);
    return () => clearInterval(timer);
  }, [tts, sceneApi]);

  const projectNamesRef = useRef(projectNames);
  projectNamesRef.current = projectNames;

  /** 実際の送信本体。ディスパッチキューから呼ばれる。 */
  const dispatch = useCallback(
    async (text: string) => {
      tts.cancel();
      await chatRef.current.send(text);
    },
    [tts],
  );

  const dispatchQueue = useDispatchQueue(dispatch, { interrupt: () => chatRef.current.interrupt() });

  /** 発話・入力を実際にキューへ積む。積む直前に判定結果を上位へ通知する(①②のパネル連携)。 */
  const enqueue = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const result = classify(trimmed, projectNamesRef.current);
      onBeforeDispatch?.(result);
      dispatchQueue.submit(trimmed);
    },
    [classify, dispatchQueue, onBeforeDispatch],
  );

  /* ---- テキスト入力(コンソール欄) ---- */
  const [draft, setDraft] = useState("");

  /* ---- 音声認識 ---- */
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // 二重送信ガード(App.tsxの既存パターンを踏襲): 音声認識の finals は明示的に
  // reset() するまで蓄積され続けるため、送信経路が speech.reset() を呼び忘れると
  // 古い確定テキストが次の onresult で再び draft に復活し、無音タイマーが同じ内容を
  // 延々と再送し続ける("同じ内容がずっとループする"バグの原因)。
  // そのため「実際にディスパッチする」処理を1箇所(sendTranscript)に集約し、
  // どの経路(自動送信/送信コマンド/手動送信)から来ても必ずここで
  // (1)同一発話の再送を弾く (2)音声認識バッファを確実にリセットする。
  const sendGuardRef = useRef(false);
  const lastSentRef = useRef("");
  // speech自体はこのコールバック定義より後に生成されるため、直接参照させず
  // ref経由で呼ぶ(App.tsxの既存パターンを踏襲)。
  const speechResetRef = useRef<() => void>(() => {});

  const sendTranscript = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || sendGuardRef.current) return;
      if (message === lastSentRef.current) {
        // 認識エンジンの再送クセ等による同一発話の再発火。送信はしないが、
        // 確定バッファはここで必ず破棄する。破棄しないと、この古いテキストが
        // 次に来る本当に新しい発話へ連結されて送られてしまう。
        setDraft("");
        speechResetRef.current();
        return;
      }
      sendGuardRef.current = true;
      queueMicrotask(() => {
        sendGuardRef.current = false;
      });
      lastSentRef.current = message;
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      setDraft("");
      tts.cancel(); // 送信したら進行中の読み上げは止める
      speechResetRef.current(); // 音声認識の確定バッファも必ず破棄する
      enqueue(message);
    },
    [enqueue, tts],
  );

  const submitDraft = useCallback(() => {
    sendTranscript(draftRef.current);
  }, [sendTranscript]);

  const isEcho = useCallback((text: string) => isLikelyEcho(text, ttsRef.current.recentSpokenTexts()), []);

  const armAutoSend = useCallback(
    (current: string) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (!current.trim()) return;
      silenceTimerRef.current = setTimeout(() => {
        sendTranscript(draftRef.current);
      }, autoSendMs());
    },
    [sendTranscript, autoSendMs],
  );

  const speech = useSpeechRecognition({
    lang: "ja-JP",
    isEcho,
    projectNames,
    dictionary: dictionary.entries,
    onUpdate: (t) => {
      const merged = t.finals.join("");
      const whole = merged + t.interim;
      if (ttsRef.current.isSpeaking() && t.finals.length) ttsRef.current.cancel(); // バージイン
      const sendCmd = classify(whole, projectNamesRef.current).send;
      if (sendCmd.triggered && sendCmd.body) {
        sendTranscript(sendCmd.body);
        // 送信された/弾かれたに関わらずバッファを掃除する。認識結果の再発火が
        // 累積して別本文を生み二重送信になるのを断つ(App.tsxの既存パターン)。
        speechResetRef.current();
        return;
      }
      setDraft(whole);
      if (merged.trim() && !t.interim) armAutoSend(whole);
      // マイク音量ではなく発話の「実際に文字が増えた」ことでもコアを軽く光らせる
      if (t.finals.length) sceneApi.current?.bumpLevel(0.15);
    },
  });
  speechResetRef.current = () => speech.reset();

  const startMic = useCallback(() => {
    lastSentRef.current = ""; // 録音を入れ直したら同一発話ガードを解除する
    speech.start();
  }, [speech]);
  const stopMic = useCallback(() => {
    speech.stop();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
  }, [speech]);

  const stopAll = useCallback(() => {
    tts.cancel();
    sceneApi.current?.setSpeaking(false);
    chatRef.current.interrupt();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    sceneApi.current?.setStreaming(false);
  }, [tts, sceneApi]);

  useEffect(
    () => () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    },
    [],
  );

  return {
    messages: chat.messages as ChatMessage[],
    busy: chat.busy,
    speaking,
    addSystem: chat.addSystem,
    speak,
    listening: speech.listening,
    supported: speech.supported,
    interim: speech.transcript.interim,
    draft,
    setDraft,
    submitDraft,
    startMic,
    stopMic,
    stopAll,
    ttsEnabled: tts.enabled,
    toggleTts: () => tts.setEnabled(!tts.enabled),
    pending: dispatchQueue.pending,
  };
}
