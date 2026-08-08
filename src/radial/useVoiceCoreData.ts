import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceCoreSceneApi } from "./useVoiceCoreScene";

export type RadialTaskStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface RadialTask {
  id: string;
  seq: number;
  project: string;
  instruction: string;
  status: RadialTaskStatus;
  priority: "urgent" | "normal";
  startedAt: number;
  endedAt?: number | null;
  lastEvent: string | null;
  result: string | null;
  error: string | null;
  sessionId: string | null;
  branch: string | null;
}

export interface RadialProject {
  name: string;
  running: number;
  done: number;
  total: number;
}

export interface TaskEventLike {
  kind: "delta" | "tool" | "error" | "instruction";
  text: string;
  at: number;
}

export interface TaskDetail {
  events: TaskEventLike[];
  liveText: string | null;
}

const ACKED_KEY = "radial-acked";
const POLL_MS = 3000;

function loadAcked(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ACKED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

export interface UseVoiceCoreDataOptions {
  browserSessionId: string;
  /** 会話ログへ差し込むシステム行(完了/中止/エラー通知など) */
  onSystemLine: (text: string) => void;
  /** 読み上げる(緊急は割り込み優先) */
  onAnnounce: (text: string, opts?: { urgent?: boolean }) => void;
  sceneApi: React.RefObject<VoiceCoreSceneApi | null>;
}

/**
 * プロジェクト/タスクのポーリング・選択状態・操作(中止/追加指示/引き継ぎ/新規作成)・
 * 要対応(確認待ち)・完了アナウンスをまとめて扱うフック。
 * 3Dシーンへは sceneApi 経由で「実行中件数」「要対応件数」「緊急パルス」を伝える(④)。
 */
export function useVoiceCoreData({ browserSessionId, onSystemLine, onAnnounce, sceneApi }: UseVoiceCoreDataOptions) {
  const [projects, setProjects] = useState<RadialProject[]>([]);
  const [tasks, setTasks] = useState<RadialTask[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, TaskDetail>>({});
  const [acked, setAcked] = useState<Set<string>>(loadAcked);

  const prevStatusRef = useRef<Map<string, RadialTaskStatus>>(new Map());
  const onSystemLineRef = useRef(onSystemLine);
  onSystemLineRef.current = onSystemLine;
  const onAnnounceRef = useRef(onAnnounce);
  onAnnounceRef.current = onAnnounce;

  const ackTask = useCallback((id: string) => {
    setAcked((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      try {
        localStorage.setItem(ACKED_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [pr, tr] = await Promise.all([
        fetch(`/api/projects?all=1&browserSessionId=${browserSessionId}`),
        fetch("/api/tasks"),
      ]);
      const pj = await pr.json();
      const tj = await tr.json();
      const nextActive: string | null = pj.active ?? null;
      const nextTasks: RadialTask[] = Array.isArray(tj.tasks) ? tj.tasks : [];

      setActiveProject((prev) => nextActive ?? prev);
      setTasks(nextTasks);

      const withTasks = [...new Set(nextTasks.map((t) => t.project))];
      let names = withTasks.slice();
      const active = nextActive;
      if (active && !names.includes(active)) names.unshift(active);
      if (Array.isArray(pj.projects)) {
        for (const p of pj.projects as { name: string }[]) {
          if (names.length >= 8) break;
          if (!names.includes(p.name)) names.push(p.name);
        }
      }
      setProjects(
        names.map((name) => {
          const ts = nextTasks.filter((t) => t.project === name);
          return {
            name,
            running: ts.filter((t) => t.status === "running" || t.status === "queued").length,
            done: ts.filter((t) => t.status === "succeeded").length,
            total: ts.length,
          };
        }),
      );

      // 完了アナウンス: 実行中/待機 → 終了 の遷移をログ+読み上げ+シーン演出で知らせる
      const prevStatus = prevStatusRef.current;
      for (const t of nextTasks) {
        const before = prevStatus.get(t.id);
        if (
          before &&
          before !== t.status &&
          (before === "running" || before === "queued") &&
          (t.status === "succeeded" || t.status === "failed" || t.status === "cancelled")
        ) {
          const head =
            t.status === "succeeded"
              ? `タスク #${t.seq} が完了しました`
              : t.status === "failed"
                ? `タスク #${t.seq} が失敗しました`
                : `タスク #${t.seq} を中止しました`;
          const detail = t.result || t.error ? `: ${String(t.result || t.error).slice(0, 140)}` : "";
          onSystemLineRef.current(`${head}${detail}`);
          if (t.status !== "cancelled") {
            const urgent = t.priority === "urgent";
            onAnnounceRef.current(`${urgent ? "緊急タスク。" : ""}${head}`, { urgent });
            if (urgent) sceneApi.current?.pulseUrgent();
          }
        }
        prevStatus.set(t.id, t.status);
      }

      // シーンへ「実行中件数」「要対応件数」を伝える(3D演出の状態表現)
      setAcked((currentAcked) => {
        const running = nextTasks.filter((t) => t.status === "running").length;
        const review = nextTasks.filter(
          (t) => (t.status === "succeeded" || t.status === "failed") && !currentAcked.has(t.id),
        ).length;
        sceneApi.current?.setTaskState({ running, review });
        return currentAcked;
      });
    } catch {
      /* offline */
    }
  }, [browserSessionId, sceneApi]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}`);
      const json = await res.json();
      setDetailsCache((prev) => ({
        ...prev,
        [id]: { events: Array.isArray(json.events) ? json.events : [], liveText: json.liveText ?? null },
      }));
    } catch {
      /* offline */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // 選択中タスクが実行中の間は詳細を追従取得する
  useEffect(() => {
    if (!selectedTaskId) return;
    const t = tasks.find((x) => x.id === selectedTaskId);
    if (t && t.status === "running") void loadDetail(selectedTaskId);
  }, [selectedTaskId, tasks, loadDetail]);

  const selectTask = useCallback(
    (id: string | null) => {
      setSelectedTaskId((prev) => (prev === id ? null : id));
      if (id) void loadDetail(id);
    },
    [loadDetail],
  );

  const switchProject = useCallback(
    async (name: string) => {
      if (!name) return;
      setActiveProject(name);
      try {
        await fetch("/api/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ browserSessionId, project: name }),
        });
      } catch {
        /* offline */
      }
      onSystemLineRef.current(`PROJECT → ${name}`);
      void refresh();
    },
    [browserSessionId, refresh],
  );

  const cancelTask = useCallback(
    async (t: RadialTask) => {
      await fetch(`/api/tasks/${t.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" } }).catch(() => {});
      onSystemLineRef.current(`タスク #${t.seq} を中止`);
      void refresh();
    },
    [refresh],
  );

  const sendInstruction = useCallback(
    async (t: RadialTask, text: string) => {
      const v = text.trim();
      if (!v) return;
      await fetch(`/api/tasks/${t.id}/instructions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: v }),
      }).catch(() => {});
      onSystemLineRef.current(`#${t.seq} に追加指示: ${v.slice(0, 60)}`);
      void refresh();
    },
    [refresh],
  );

  const resumeTask = useCallback(
    async (t: RadialTask, text: string) => {
      const v = text.trim();
      if (!v) return;
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ browserSessionId, resume: t.id, instruction: v }),
      }).catch(() => {});
      onSystemLineRef.current(`#${t.seq} を引き継いで開始: ${v.slice(0, 60)}`);
      void refresh();
    },
    [browserSessionId, refresh],
  );

  const createTask = useCallback(
    async (text: string) => {
      const v = text.trim();
      if (!v) return;
      const target = activeProject || projects[0]?.name;
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ browserSessionId, instruction: v, ...(target ? { project: target } : {}) }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok) onSystemLineRef.current(`タスク #${j.seq ?? "?"} を開始: ${v.slice(0, 60)}`);
        else onSystemLineRef.current(`! ${j.error || "タスクを開始できませんでした"}`);
      } catch {
        onSystemLineRef.current("! タスクを開始できませんでした");
      }
      void refresh();
    },
    [activeProject, projects, browserSessionId, refresh],
  );

  const needsReview = useCallback(
    (t: RadialTask) => (t.status === "succeeded" || t.status === "failed") && !acked.has(t.id),
    [acked],
  );

  return {
    projects,
    tasks,
    activeProject,
    selectedTaskId,
    selectTask,
    detailsCache,
    acked,
    ackTask,
    needsReview,
    switchProject,
    cancelTask,
    sendInstruction,
    resumeTask,
    createTask,
  };
}
