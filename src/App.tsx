import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "./hooks/useChat";
import type { DirectiveResult } from "./hooks/useChat";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useTTS } from "./hooks/useTTS";
import {
  detectSendCommand,
  fullText,
  shouldQueryInterjection,
  type TranscriptState,
} from "./lib/transcript";

const browserSessionId = `bs-${Math.random().toString(36).slice(2, 10)}`;

const INTERJECT_DEBOUNCE_MS = 800;
const AUTO_SEND_SILENCE_MS = 2000;
const TASK_POLL_MS = 3000;

interface ProjectInfo {
  name: string;
  hasGit: boolean;
  hasPackageJson: boolean;
}

interface TaskSummary {
  id: string;
  project: string;
  instruction: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  lastEvent: string | null;
  result: string | null;
  error: string | null;
}

/** Hide orchestrator control lines if they slip into streamed text. */
function displayText(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("@@CV"))
    .join("\n");
}

const STATUS_LABEL: Record<TaskSummary["status"], string> = {
  running: "実行中",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "中止",
};

export default function App() {
  const [mode, setMode] = useState<string>("...");
  const [interjection, setInterjection] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const tts = useTTS();

  const refreshProjects = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects?browserSessionId=${browserSessionId}`);
      const json = await res.json();
      setProjects(json.projects ?? []);
      setActiveProject(json.active ?? null);
    } catch {
      /* offline */
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks");
      const json = await res.json();
      setTasks(json.tasks ?? []);
    } catch {
      /* offline */
    }
  }, []);

  const onDirective = useCallback(
    (d: DirectiveResult) => {
      const text = d.ok ? `⚙ ${d.detail}` : `⚠ ${d.detail}`;
      chatApi.current?.addSystem(text);
      tts.speak(d.detail ?? "");
      void refreshProjects();
      void refreshTasks();
    },
    [refreshProjects, refreshTasks, tts],
  );

  const chat = useChat(browserSessionId, (reply) => tts.speak(reply), onDirective);
  const chatApi = useRef<typeof chat | null>(null);
  chatApi.current = chat;
  const { messages, busy, send, addInterjection, addSystem } = chat;

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

  // 二重送信ガード:
  // - sendGuardRef: busy state が反映される前の連続発火を同期的に弾く
  // - lastSentRef: reset後もブラウザの認識結果が同一発話を再発火するため、
  //   同じ本文の連続送信を抑制(busyサイクルをまたぐ再発火にも効く)
  const sendGuardRef = useRef(false);
  const lastSentRef = useRef("");
  useEffect(() => {
    if (!busy) sendGuardRef.current = false;
  }, [busy]);

  const sendTranscript = useCallback(
    (text: string) => {
      const message = text.trim();
      if (!message || busyRef.current || sendGuardRef.current) return;
      if (message === lastSentRef.current) return; // 同一発話の再発火は無視
      sendGuardRef.current = true;
      lastSentRef.current = message;
      lastQueriedRef.current = "";
      tts.cancel(); // 送信したら進行中の読み上げは止める
      speech.reset();
      void send(message);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [send, tts],
  );
  const sendTranscriptRef = useRef(sendTranscript);
  const speechResetRef = useRef<() => void>(() => {});

  const onTranscriptUpdate = useCallback(
    (t: TranscriptState) => {
      const text = fullText(t);

      // 末尾に「送信」等の音声コマンドが来たら即送信(本文がある場合のみ)
      const sendCmd = detectSendCommand(text);
      if (sendCmd.triggered && sendCmd.body) {
        if (interjectTimerRef.current) clearTimeout(interjectTimerRef.current);
        if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
        sendTranscriptRef.current(sendCmd.body);
        // 送信された/抑制されたに関わらずバッファを掃除。認識結果の再発火が
        // 累積して別本文を生み二重送信になるのを断つ。
        speechResetRef.current();
        return;
      }

      if (interjectTimerRef.current) clearTimeout(interjectTimerRef.current);
      if (shouldQueryInterjection(lastQueriedRef.current, text)) {
        interjectTimerRef.current = setTimeout(() => queryInterjection(text), INTERJECT_DEBOUNCE_MS);
      }
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
  speechResetRef.current = speech.reset;

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setMode(j.mode))
      .catch(() => setMode("offline"));
    void refreshProjects();
    void refreshTasks();
  }, [refreshProjects, refreshTasks]);

  // タスク状態のポーリング。完了/失敗への遷移は音声とシステムバブルで報告
  const prevStatusRef = useRef<Map<string, TaskSummary["status"]>>(new Map());
  useEffect(() => {
    const timer = setInterval(refreshTasks, TASK_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshTasks]);
  useEffect(() => {
    const prev = prevStatusRef.current;
    for (const t of tasks) {
      const before = prev.get(t.id);
      if (before === "running" && t.status !== "running") {
        const summary =
          t.status === "succeeded"
            ? `${t.project} のタスクが完了しました。${(t.result ?? "").slice(0, 80)}`
            : t.status === "failed"
              ? `${t.project} のタスクが失敗しました。${(t.error ?? "").slice(0, 80)}`
              : `${t.project} のタスクを中止しました`;
        addSystem(`⚙ ${summary}`);
        tts.speak(summary);
      }
      prev.set(t.id, t.status);
    }
  }, [tasks, addSystem, tts]);

  const chatRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = chatRef.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [messages]);

  const switchProject = async (name: string) => {
    if (!name) return;
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ browserSessionId, project: name }),
      });
      if (res.ok) {
        setActiveProject(name);
        addSystem(`⚙ ${name} に切り替えました`);
      }
    } catch {
      /* offline */
    }
  };

  const cancelTask = async (id: string) => {
    await fetch(`/api/tasks/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    }).catch(() => {});
    void refreshTasks();
  };

  const liveText = fullText(speech.transcript);
  const runningCount = tasks.filter((t) => t.status === "running").length;

  const submitDraft = () => {
    if (draft.trim()) {
      tts.cancel(); // 送信したら進行中の読み上げは止める
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
          <select
            className="project-select"
            name="project"
            aria-label="プロジェクト"
            value={activeProject ?? ""}
            onChange={(e) => void switchProject(e.target.value)}
          >
            <option value="" disabled>
              プロジェクト選択
            </option>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <span className={`mode-badge mode-${mode}`}>
            {mode === "cli" ? "Claude Code接続" : mode === "mock" ? "モックモード" : mode}
          </span>
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
              「◯◯のテストを回して」「新しいアプリを作って」— 話すだけでプロジェクトの選択から
              実装タスクの実行・進捗確認まで進められます。文末に「送信」と言えばその場で送れます
              (2秒黙っても自動送信)。
              {!speech.supported && " ※このブラウザは音声認識非対応です。Chromeを使うか、下の入力欄をどうぞ。"}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`bubble bubble-${m.role}`}>
            {m.role === "interjection" && <span className="interject-label">割り込み</span>}
            <p>{displayText(m.text) || (m.streaming ? "…" : "")}</p>
          </div>
        ))}
      </main>

      {tasks.length > 0 && (
        <section className="tasks" aria-label="タスク">
          <div className="tasks-head">
            <span className="tasks-title">タスク</span>
            {runningCount > 0 && <span className="tasks-running">{runningCount} 実行中</span>}
          </div>
          <ul className="task-list">
            {tasks.map((t) => (
              <li key={t.id} className={`task task-${t.status}`}>
                <span className={`task-dot dot-${t.status}`} aria-hidden />
                <span className="task-main">
                  <span className="task-meta">
                    {t.project} · {STATUS_LABEL[t.status]}
                  </span>
                  <span className="task-instruction">{t.instruction}</span>
                  {t.status === "running" && t.lastEvent && (
                    <span className="task-activity">{t.lastEvent}</span>
                  )}
                  {t.status === "succeeded" && t.result && (
                    <span className="task-activity">{t.result.slice(0, 120)}</span>
                  )}
                  {t.status === "failed" && t.error && (
                    <span className="task-activity">{t.error.slice(0, 120)}</span>
                  )}
                </span>
                {t.status === "running" && (
                  <button className="task-cancel" onClick={() => void cancelTask(t.id)}>
                    中止
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

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
            onClick={() => {
              if (speech.listening) {
                speech.stop();
              } else {
                lastSentRef.current = ""; // 録音を入れ直したら同一発話ガードを解除
                speech.start();
              }
            }}
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
