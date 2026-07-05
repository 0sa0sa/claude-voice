import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "./hooks/useChat";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useTTS } from "./hooks/useTTS";
import {
  fullText,
  shouldQueryInterjection,
  type TranscriptState,
} from "./lib/transcript";

const browserSessionId = `bs-${Math.random().toString(36).slice(2, 10)}`;

const INTERJECT_DEBOUNCE_MS = 800;
const AUTO_SEND_SILENCE_MS = 2000;

export default function App() {
  const [mode, setMode] = useState<string>("...");
  const [interjection, setInterjection] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const tts = useTTS();

  const { messages, busy, send, addInterjection } = useChat(browserSessionId, (reply) =>
    tts.speak(reply),
  );

  const lastQueriedRef = useRef("");
  const interjectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const queryInterjection = useCallback(
    async (text: string) => {
      lastQueriedRef.current = text;
      try {
        const res = await fetch("/api/interject", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ browserSessionId, transcript: text }),
        });
        const json = await res.json();
        if (json.interject && json.question) {
          setInterjection(json.question);
          addInterjection(json.question);
          tts.speakNow(json.question);
          setTimeout(() => setInterjection(null), 6000);
        }
      } catch {
        // interjection is best-effort
      }
    },
    [addInterjection, tts],
  );

  const sendTranscript = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || busyRef.current) return;
      lastQueriedRef.current = "";
      speech.reset();
      void send(message);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send],
  );
  const sendTranscriptRef = useRef(sendTranscript);

  const onTranscriptUpdate = useCallback(
    (t: TranscriptState) => {
      const text = fullText(t);
      // 発話途中の割り込み判定(デバウンス)
      if (interjectTimerRef.current) clearTimeout(interjectTimerRef.current);
      if (shouldQueryInterjection(lastQueriedRef.current, text)) {
        interjectTimerRef.current = setTimeout(() => queryInterjection(text), INTERJECT_DEBOUNCE_MS);
      }
      // 沈黙で自動送信
      if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
      if (t.finals.length > 0 && t.interim === "") {
        autoSendTimerRef.current = setTimeout(
          () => sendTranscriptRef.current(text),
          AUTO_SEND_SILENCE_MS,
        );
      }
    },
    [queryInterjection],
  );

  const speech = useSpeechRecognition({ onUpdate: onTranscriptUpdate });
  sendTranscriptRef.current = sendTranscript;

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setMode(j.mode))
      .catch(() => setMode("offline"));
  }, []);

  const chatRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = chatRef.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [messages]);

  const liveText = fullText(speech.transcript);

  const submitDraft = () => {
    if (draft.trim()) {
      void send(draft.trim());
      setDraft("");
    }
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◉
          </span>
          <h1>claude-voice</h1>
        </div>
        <div className="header-right">
          <span className={`mode-badge mode-${mode}`}>{mode === "cli" ? "Claude Code接続" : mode === "mock" ? "モックモード" : mode}</span>
          <label className="tts-toggle">
            <input
              type="checkbox"
              checked={tts.enabled}
              onChange={(e) => tts.setEnabled(e.target.checked)}
            />
            読み上げ
          </label>
        </div>
      </header>

      <main className="chat" aria-live="polite" ref={chatRef}>
        {messages.length === 0 && (
          <div className="empty">
            <p className="empty-title">マイクをオンにして話しかけてください</p>
            <p className="empty-sub">
              要件を話すと、曖昧な言葉には途中で「それって何？」と確認が入ります。
              {!speech.supported && " ※このブラウザは音声認識非対応です。Chromeを使うか、下の入力欄をどうぞ。"}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.role}`}>
            {m.role === "interjection" && <span className="interject-label">割り込み</span>}
            <p>{m.text || (m.streaming ? "…" : "")}</p>
          </div>
        ))}
      </main>

      {interjection && (
        <div className="interjection-pop" role="status">
          {interjection}
        </div>
      )}

      <footer className="dock">
        <div className={`live-strip ${speech.listening ? "on-air" : ""}`}>
          <span className="live-label">{speech.listening ? "ON AIR" : "OFF"}</span>
          <span className="live-text">
            {speech.transcript.finals.join("")}
            <span className="live-interim">{speech.transcript.interim}</span>
            {!liveText && <span className="live-placeholder">ここに発話が表示されます</span>}
          </span>
          {liveText && (
            <button className="send-now" onClick={() => sendTranscript(liveText)} disabled={busy}>
              送信
            </button>
          )}
        </div>
        <div className="controls">
          <button
            className={`mic ${speech.listening ? "mic-on" : ""}`}
            onClick={() => (speech.listening ? speech.stop() : speech.start())}
            disabled={!speech.supported}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? "マイクを止める" : "マイクを開始"}
          >
            {speech.listening ? "■" : "●"}
          </button>
          <input
            className="draft"
            name="draft"
            value={draft}
            placeholder="キーボードでも話せます"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitDraft()}
          />
          <button className="send" onClick={submitDraft} disabled={busy || !draft.trim()}>
            送信
          </button>
        </div>
      </footer>
    </div>
  );
}
