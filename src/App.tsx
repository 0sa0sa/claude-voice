import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "./hooks/useChat";
import type { DirectiveResult } from "./hooks/useChat";
import { useDictionary } from "./hooks/useDictionary";
import { useSpeechRecognition } from "./hooks/useSpeechRecognition";
import { useTTS } from "./hooks/useTTS";
import { DictionaryPanel } from "./components/DictionaryPanel";
import {
  detectSendCommand,
  shouldQueryInterjection,
  type TranscriptState,
} from "./lib/transcript";
import { mergeRecognizedText } from "./lib/liveDraft";
import { syncLiveInputView } from "./lib/liveInput";
import { isLikelyEcho } from "./lib/echo";
import { clipForSpeech } from "./lib/speechClip";
import { groupByProject, splitTasks } from "./lib/taskDisplay";
import { isSelectableTask, resolveTaskReference } from "./lib/taskSelection";

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
  /** 作成順の連番(1始まり)。音声・テキストでタスクを指定しやすくする */
  seq: number;
  project: string;
  instruction: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number | null;
  lastEvent: string | null;
  result: string | null;
  error: string | null;
  sessionId: string | null;
  resumedFrom: string | null;
  /** worktree分離で実行した場合の作業ディレクトリ(完了後も残る。マージは人間が判断) */
  worktreePath: string | null;
  branch: string | null;
  /** worktree作成に失敗してプロジェクト直下で実行したときの記録 */
  worktreeNote: string | null;
}

/** Hide orchestrator control lines if they slip into streamed text. */
function displayText(text: string): string {
  return text
    .split("\n")
    .filter((l) => !l.trim().startsWith("@@CV"))
    .join("\n");
}

const TTS_RATES = [1, 1.2, 1.5, 2];

// localStorageに規定外の値が保存されていてもセレクタが空表示にならないよう、現在値を選択肢に含める
function ttsRateOptions(current: number): number[] {
  return TTS_RATES.includes(current)
    ? TTS_RATES
    : [...TTS_RATES, current].sort((a, b) => a - b);
}

const STATUS_LABEL: Record<TaskSummary["status"], string> = {
  running: "実行中",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "中止",
};

const STATUS_ICON: Record<TaskSummary["status"], string> = {
  running: "●",
  succeeded: "✓",
  failed: "✕",
  cancelled: "⊘",
};

/** 直近に作成されたタスクだけ着信フラッシュの対象にする(リロード時の既存分は光らせない) */
const NEW_TASK_FLASH_WINDOW_MS = 10_000;
const FLASH_DURATION_MS = 2400;

function timeAgo(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return "たった今";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}時間前`;
  return `${Math.floor(hr / 24)}日前`;
}

export default function App() {
  const [mode, setMode] = useState<string>("...");
  const [interjection, setInterjection] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // 音声認識の確定テキストの送信前ドラフト。キーボードで編集・削除でき、
  // 新しい認識結果は手動編集を壊さず末尾に追記される
  const [liveDraft, setLiveDraft] = useState("");
  const liveDraftRef = useRef("");
  const prevFinalsRef = useRef("");
  // 長い発話の全文表示トグルと、認識追記時だけ末尾へ追従スクロールするためのフラグ
  const [liveExpanded, setLiveExpanded] = useState(false);
  const liveInputRef = useRef<HTMLTextAreaElement | null>(null);
  const liveFollowRef = useRef(false);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  // タスク一覧の表示絞り込み(null = 全プロジェクト)。ワークスペース切替とは独立したUI状態
  const [taskFilter, setTaskFilter] = useState<string | null>(null);
  // 直近に作成/状態変化したタスクID。カードを一時的にフラッシュ表示する
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set());
  // 完了済みセクションの開閉と、本文をクリックで全文展開したタスクID
  const [finishedOpen, setFinishedOpen] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // 実行中タスクへの追加指示: 入力フォームを開いているタスクIDとその下書き
  const [instructTargetId, setInstructTargetId] = useState<string | null>(null);
  const [instructDraft, setInstructDraft] = useState("");
  // 追いタスクの対象として選択中のタスクID。選択中の送信はチャットではなく
  // そのタスクのセッションを引き継いだフォローアップタスクとして起動される
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const tts = useTTS();
  const ttsRef = useRef(tts);
  ttsRef.current = tts;

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
      // 音声誤認識の文脈補正: ユーザーバブルの表示を静かに差し替えるだけ(読み上げなし)
      if (d.action === "fix_transcript") {
        if (d.corrected) chatApi.current?.patchLastUserMessage(d.corrected);
        return;
      }
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
      speechResetRef.current();
      void dispatchRef.current(message);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tts],
  );
  const sendTranscriptRef = useRef(sendTranscript);
  const speechResetRef = useRef<() => void>(() => {});
  // タスク選択中は発話/入力を追いタスクへ回すため、送信先を毎レンダー差し替える
  const dispatchRef = useRef<(message: string) => void | Promise<void>>(() => {});

  const onTranscriptUpdate = useCallback(
    (t: TranscriptState) => {
      // 確定テキストを編集可能ドラフトへマージする。手動編集は上書きせず、
      // 新しく増えた認識分だけを末尾に追記する
      const finalsText = t.finals.join("");
      const merged = mergeRecognizedText(liveDraftRef.current, prevFinalsRef.current, finalsText);
      prevFinalsRef.current = finalsText;
      liveDraftRef.current = merged;
      setLiveDraft(merged);
      liveFollowRef.current = true; // 認識による追記は最新部分が見えるよう末尾へ追従
      const text = merged + t.interim;

      // バージイン: エコーは認識段階で破棄済みなので、ここに届いた発話は本物。
      // 読み上げ中なら止めてユーザーの発話を優先する。
      if (text.trim() && ttsRef.current.isSpeaking()) ttsRef.current.cancel();

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
      if (merged.trim() !== "" && t.interim === "") {
        // 発火時点のドラフトを送る: タイマー待ちの間の手動編集を反映する
        autoSendTimerRef.current = setTimeout(
          () => sendTranscriptRef.current(liveDraftRef.current),
          AUTO_SEND_SILENCE_MS,
        );
      }
    },
    [queryInterjection],
  );

  // TTS読み上げ中もマイク・認識は止めず、読み上げテキストと似た認識結果を捨てる
  const isEcho = useCallback(
    (text: string) => isLikelyEcho(text, ttsRef.current.recentSpokenTexts()),
    [],
  );
  // サーバーのプロジェクト一覧とユーザー登録辞書を補正辞書に:
  // 英語名や開発頻出用語の音声誤認識を自動補正する
  const dictionary = useDictionary();
  const speech = useSpeechRecognition({
    onUpdate: onTranscriptUpdate,
    isEcho,
    projectNames: projects.map((p) => p.name),
    dictionary: dictionary.entries,
  });
  sendTranscriptRef.current = sendTranscript;
  // 認識バッファと編集ドラフトをまとめて破棄する(送信後・音声コマンド送信後)
  speechResetRef.current = () => {
    prevFinalsRef.current = "";
    liveDraftRef.current = "";
    setLiveDraft("");
    setLiveExpanded(false);
    speech.reset();
  };

  // 入力欄の高さを内容に合わせる(field-sizing非対応ブラウザ含む)。
  // 認識追記時は末尾へスクロールし、発話の最新部分が隠れないようにする
  useEffect(() => {
    const el = liveInputRef.current;
    if (el) syncLiveInputView(el, { expanded: liveExpanded, follow: liveFollowRef.current });
    liveFollowRef.current = false;
  }, [liveDraft, liveExpanded]);

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
    const flashed: string[] = [];
    for (const t of tasks) {
      const before = prev.get(t.id);
      if (before === undefined) {
        // 新規タスク。ただしリロード直後に既存タスクが一斉に光るのは避ける
        if (Date.now() - t.startedAt < NEW_TASK_FLASH_WINDOW_MS) flashed.push(t.id);
      } else if (before !== t.status) {
        flashed.push(t.id);
      }
      if (before === "running" && t.status !== "running") {
        const prefix =
          t.status === "succeeded"
            ? `${t.project} のタスクが完了しました。`
            : t.status === "failed"
              ? `${t.project} のタスクが失敗しました。`
              : `${t.project} のタスクを中止しました`;
        const detail =
          t.status === "succeeded" ? (t.result ?? "") : t.status === "failed" ? (t.error ?? "") : "";
        // 表示は全文、読み上げは長い場合のみ文の区切りで省略する
        addSystem(`⚙ ${prefix}${detail}`);
        tts.speak(`${prefix}${clipForSpeech(detail)}`);
      }
      prev.set(t.id, t.status);
    }
    if (flashed.length > 0) {
      setFlashIds((old) => new Set([...old, ...flashed]));
      setTimeout(() => {
        setFlashIds((old) => {
          const next = new Set(old);
          for (const id of flashed) next.delete(id);
          return next;
        });
      }, FLASH_DURATION_MS);
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

  /** 実行中タスクへ追加指示を送る。現在の実行完了後に同じセッションで消化される。 */
  const sendInstruction = async (task: TaskSummary) => {
    const text = instructDraft.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/tasks/${task.id}/instructions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) {
        addSystem(`⚙ タスク #${task.seq} に追加指示を送りました: ${text}`);
      } else {
        addSystem(`⚠ 追加指示を送れませんでした: ${json.error ?? `HTTP ${res.status}`}`);
      }
    } catch (err) {
      addSystem(
        `⚠ 追加指示を送れませんでした: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    setInstructTargetId(null);
    setInstructDraft("");
    void refreshTasks();
  };

  const liveText = liveDraft + speech.transcript.interim;

  const onLiveDraftEdit = (value: string) => {
    liveDraftRef.current = value;
    setLiveDraft(value);
    // 手動編集中に自動送信が発火すると編集途中の文が飛ぶので止める(次の発話で再アーム)
    if (autoSendTimerRef.current) clearTimeout(autoSendTimerRef.current);
  };
  const runningCount = tasks.filter((t) => t.status === "running").length;

  // サイドバー用: プロジェクトごとのタスク状態サマリ
  const countsByProject = new Map<string, { running: number; succeeded: number; failed: number }>();
  for (const t of tasks) {
    const c = countsByProject.get(t.project) ?? { running: 0, succeeded: 0, failed: 0 };
    if (t.status === "running") c.running++;
    else if (t.status === "succeeded") c.succeeded++;
    else if (t.status === "failed") c.failed++;
    countsByProject.set(t.project, c);
  }
  const visibleTasks = taskFilter ? tasks.filter((t) => t.project === taskFilter) : tasks;
  // 実行中を上部に固定し、完了済みは折りたたみ可能なセクションにまとめる
  const { running: runningTasks, finished: finishedTasks } = splitTasks(visibleTasks);
  // 絞り込みチップ用: 全タスクからプロジェクトと件数を出す(絞り込み中も他チップを出すため全件から)
  const projectGroups = groupByProject(tasks);

  const toggleExpanded = (id: string) => {
    setExpandedIds((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // タスクサイドバー用: 状態ごとの件数サマリ(一目で全体の状況が分かるように)
  const statusTotals: Record<TaskSummary["status"], number> = {
    running: 0,
    succeeded: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const t of tasks) statusTotals[t.status]++;

  const selectProject = (name: string) => {
    setTaskFilter(name);
    if (name !== activeProject) void switchProject(name);
  };

  // 追いタスクの選択対象。ID・連番("3" / "#3")どちらの参照でも解決し、
  // タスク一覧の更新で引き継げなくなったら自動的に外れる
  const selectedCandidate = selectedTaskId ? resolveTaskReference(tasks, selectedTaskId) : undefined;
  const selectedTask =
    selectedCandidate && isSelectableTask(selectedCandidate) ? selectedCandidate : null;

  /** 選択中タスクのセッションを引き継いで追いタスクを起動する(チャットレーンは通さない)。 */
  const startFollowUpTask = async (task: TaskSummary, instruction: string) => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ browserSessionId, resume: task.id, instruction }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 失敗時は選択を保持したままエラーを見せ、指示を出し直せるようにする
        addSystem(`⚠ ${json.error ?? `追いタスクの起動に失敗しました (HTTP ${res.status})`}`);
        return;
      }
      setSelectedTaskId(null);
      const detail = `タスク #${task.seq} を引き継いで追いタスクを開始しました`;
      addSystem(`⚙ ${detail}`);
      tts.speak(detail);
      void refreshTasks();
    } catch (err) {
      addSystem(
        `⚠ 追いタスクの起動に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const dispatchMessage = async (message: string) => {
    if (selectedTask) {
      await startFollowUpTask(selectedTask, message);
      // チャットレーンを通らずbusyが遷移しないため、二重送信ガードをここで解除する
      sendGuardRef.current = false;
    } else {
      await send(message);
    }
  };
  dispatchRef.current = dispatchMessage;

  const submitDraft = () => {
    if (draft.trim()) {
      tts.cancel(); // 送信したら進行中の読み上げは止める
      void dispatchMessage(draft.trim());
      setDraft("");
    }
  };

  const renderTask = (t: TaskSummary) => {
    const expanded = expandedIds.has(t.id);
    const selectable = isSelectableTask(t);
    const selected = selectedTask?.id === t.id;
    return (
      <li
        key={t.id}
        className={`task task-${t.status} ${flashIds.has(t.id) ? "task-flash" : ""} ${selected ? "task-selected" : ""}`}
      >
        <span className={`task-icon icon-${t.status}`} aria-hidden>
          {STATUS_ICON[t.status]}
        </span>
        <button
          type="button"
          className="task-main"
          aria-expanded={expanded}
          aria-pressed={selectable ? selected : undefined}
          onClick={() => {
            toggleExpanded(t.id);
            // 引き継ぎ可能なタスクはクリックで追いタスクの対象として選択/解除する
            if (selectable) setSelectedTaskId(selected ? null : t.id);
          }}
          title={
            selectable
              ? selected
                ? "クリックで選択解除"
                : "クリックで選択(次の指示をこのタスクへの追い指示にする)"
              : expanded
                ? "クリックで省略表示に戻す"
                : "クリックで全文を表示"
          }
        >
          <span className="task-meta">
            {/* 主表示は口頭で言いやすい連番。16進IDはtitleでだけ補助的に参照できる */}
            {/* プロジェクト名はカードごとではなくグループ見出しで示す */}
            <span className="task-seq" title={`ID: ${t.id}`}>
              #{t.seq}
            </span>
            {t.branch && (
              <span className="task-branch" title={t.worktreePath ?? undefined}>
                {t.branch}
              </span>
            )}
            <span className={`task-state state-${t.status}`}>{STATUS_LABEL[t.status]}</span>
            <span className="task-time">{timeAgo(t.endedAt ?? t.startedAt)}</span>
            {selected && <span className="task-selected-badge">選択中</span>}
          </span>
          <span className={`task-instruction ${expanded ? "" : "clamped"}`}>{t.instruction}</span>
          {/* worktree分離の詳細: パスは展開時のみ、フォールバックの記録は常時表示 */}
          {expanded && t.worktreePath && (
            <span className="task-worktree">worktree: {t.worktreePath}</span>
          )}
          {t.worktreeNote && <span className="task-worktree-note">{t.worktreeNote}</span>}
          {t.status === "running" && t.lastEvent && (
            <span className="task-activity">{t.lastEvent}</span>
          )}
          {t.status === "succeeded" && t.result && (
            <span className={`task-activity task-result ${expanded ? "" : "clamped"}`}>
              {t.result}
            </span>
          )}
          {t.status === "failed" && t.error && (
            <span className={`task-activity task-result ${expanded ? "" : "clamped"}`}>
              {t.error}
            </span>
          )}
        </button>
        {t.status === "running" ? (
          <span className="task-actions">
            <button
              className="task-append"
              aria-expanded={instructTargetId === t.id}
              onClick={() => {
                setInstructTargetId((cur) => (cur === t.id ? null : t.id));
                setInstructDraft("");
              }}
              title="実行中のタスクに追加の指示を送る(今の作業が一区切りした後に反映)"
            >
              追加指示
            </button>
            <button className="task-cancel" onClick={() => void cancelTask(t.id)}>
              中止
            </button>
          </span>
        ) : (
          t.sessionId && (
            <button
              className="task-resume"
              onClick={() => setDraft(`タスク #${t.seq} の続きをお願い: `)}
              title="このタスクの文脈を引き継いで続きを依頼"
            >
              続きを依頼
            </button>
          )
        )}
        {t.status === "running" && instructTargetId === t.id && (
          <div className="task-instruct-form">
            <input
              className="task-instruct-input"
              aria-label="追加の指示"
              placeholder="追加の指示を入力"
              value={instructDraft}
              autoFocus
              onChange={(e) => setInstructDraft(e.target.value)}
              onKeyDown={(e) => {
                // IME確定のEnterでは送らない
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void sendInstruction(t);
                }
              }}
            />
            <button
              className="task-instruct-send"
              aria-label="追加指示を送信"
              onClick={() => void sendInstruction(t)}
              disabled={!instructDraft.trim()}
            >
              送信
            </button>
          </div>
        )}
      </li>
    );
  };

  /** セクション内のタスクをプロジェクトごとにまとめ、見出し付きで並べる */
  const renderGroupedLists = (list: TaskSummary[]) =>
    groupByProject(list).map((g) => (
      <div className="task-group" key={g.project}>
        <p className="task-group-head">{g.project}</p>
        <ul className="task-list">{g.tasks.map(renderTask)}</ul>
      </div>
    ));

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
          <select
            className="rate-select"
            name="ttsRate"
            aria-label="読み上げ速度"
            value={String(tts.rate)}
            onChange={(e) => tts.setRate(Number(e.target.value))}
          >
            {ttsRateOptions(tts.rate).map((r) => (
              <option key={r} value={String(r)}>
                {r}x
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="body">
        <aside className="sidebar" aria-label="プロジェクト">
          <p className="sidebar-title">プロジェクト</p>
          <ul className="proj-list">
            <li>
              <button
                className={`proj-row ${taskFilter === null ? "is-viewing" : ""}`}
                onClick={() => setTaskFilter(null)}
              >
                <span className="proj-name">すべてのタスク</span>
                {runningCount > 0 && <span className="count count-running">{runningCount}</span>}
              </button>
            </li>
            {projects.map((p) => {
              const c = countsByProject.get(p.name);
              return (
                <li key={p.name}>
                  <button
                    className={`proj-row ${taskFilter === p.name ? "is-viewing" : ""}`}
                    onClick={() => selectProject(p.name)}
                    title={activeProject === p.name ? `${p.name}(作業中)` : p.name}
                  >
                    {activeProject === p.name && (
                      <span className="proj-active-dot" aria-label="作業中" />
                    )}
                    <span className="proj-name">{p.name}</span>
                    {c && c.running > 0 && (
                      <span className="count count-running">{c.running}</span>
                    )}
                    {c && c.failed > 0 && <span className="count count-failed">{c.failed}</span>}
                    {c && c.succeeded > 0 && (
                      <span className="count count-succeeded">{c.succeeded}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <DictionaryPanel
            entries={dictionary.entries}
            onAdd={(w, r) => void dictionary.add(w, r)}
            onRemove={(w) => void dictionary.remove(w)}
          />
        </aside>

        <div className="main">
          <main className="chat" aria-live="polite" ref={chatRef}>
        {messages.length === 0 && (
          <div className="empty">
            <p className="empty-title">マイクをオンにして話しかけてください</p>
            <p className="empty-sub">
              「◯◯のテストを回して」「新しいアプリを作って」— 話すだけでプロジェクトの選択から
              実装タスクの実行・進捗確認まで進められます。文末に「送信」と言えばその場で送れます
              (2秒黙っても自動送信)。認識が間違っていたら「◯◯じゃなくて△△」と言えば言い直せます。
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

      {interjection && (
        <div className="interjection-pop" role="status">
          {interjection}
        </div>
      )}

      <footer className="dock">
        <div className={`live-strip ${speech.listening ? "on-air" : ""}`}>
          <span className="live-label">{speech.listening ? "ON AIR" : "OFF"}</span>
          <span className="live-text">
            <textarea
              className="live-input"
              aria-label="認識テキスト(編集できます)"
              value={liveDraft}
              placeholder="ここに発話が表示されます"
              rows={1}
              onChange={(e) => onLiveDraftEdit(e.target.value)}
              onKeyDown={(e) => {
                // IME確定のEnterでは送らない
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendTranscript(liveText);
                }
              }}
            />
            {speech.transcript.interim && (
              <span className="live-interim">{speech.transcript.interim}</span>
            )}
          </span>
          {liveText.trim() !== "" && (
            <button className="send-now" onClick={() => sendTranscript(liveText)} disabled={busy}>
              送信
            </button>
          )}
        </div>
        {selectedTask && (
          <div className="followup-strip" role="status">
            <span className="followup-label">追いタスク:</span>
            <span className="followup-text">
              タスク #{selectedTask.seq} · {selectedTask.project} — {selectedTask.instruction}
            </span>
            <button
              className="followup-clear"
              onClick={() => setSelectedTaskId(null)}
              aria-label="追いタスクの選択を解除"
            >
              ✕
            </button>
          </div>
        )}
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

        <aside className="tasks" aria-label="タスク">
          <div className="tasks-head">
            <span className="tasks-title">タスク</span>
            {taskFilter && (
              <button
                className="tasks-filter"
                onClick={() => setTaskFilter(null)}
                aria-label={`${taskFilter} の絞り込みを解除`}
              >
                {taskFilter} ✕
              </button>
            )}
          </div>
          {projectGroups.length > 1 && (
            <div className="task-chips" role="group" aria-label="プロジェクトで絞り込み">
              <button
                className={`task-chip ${taskFilter === null ? "is-active" : ""}`}
                aria-pressed={taskFilter === null}
                onClick={() => setTaskFilter(null)}
              >
                すべて
              </button>
              {projectGroups.map((g) => (
                <button
                  key={g.project}
                  className={`task-chip ${taskFilter === g.project ? "is-active" : ""}`}
                  aria-pressed={taskFilter === g.project}
                  onClick={() => setTaskFilter(g.project)}
                  title={`${g.project} のタスクだけ表示`}
                >
                  {`${g.project} (${g.tasks.length})`}
                </button>
              ))}
            </div>
          )}
          {tasks.length > 0 && (
            <div className="tasks-summary">
              {(Object.keys(STATUS_LABEL) as TaskSummary["status"][]).map(
                (s) =>
                  statusTotals[s] > 0 && (
                    <span key={s} className={`summary-chip state-${s}`}>
                      <span aria-hidden>{STATUS_ICON[s]}</span> {statusTotals[s]} {STATUS_LABEL[s]}
                    </span>
                  ),
              )}
            </div>
          )}
          {visibleTasks.length === 0 ? (
            <p className="tasks-empty">
              {taskFilter ? `${taskFilter} のタスクはまだありません` : "タスクはまだありません"}
            </p>
          ) : (
            <>
              {runningTasks.length > 0 && (
                <section className="task-section">
                  <p className="task-section-head">
                    <span className="task-section-title">実行中のタスク</span>
                    <span className="task-section-count">{runningTasks.length}</span>
                  </p>
                  {renderGroupedLists(runningTasks)}
                </section>
              )}
              {finishedTasks.length > 0 && (
                <section className="task-section">
                  <button
                    type="button"
                    className="task-section-toggle"
                    aria-expanded={finishedOpen}
                    onClick={() => setFinishedOpen((v) => !v)}
                  >
                    <span className="task-section-title">完了済み</span>
                    <span className="task-section-count">{finishedTasks.length}</span>
                    <span className="task-section-chevron" aria-hidden>
                      {finishedOpen ? "▾" : "▸"}
                    </span>
                  </button>
                  {finishedOpen && renderGroupedLists(finishedTasks)}
                </section>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
