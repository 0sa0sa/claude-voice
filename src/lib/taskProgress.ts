/**
 * 実行中タスクの途中経過: タスク詳細(GET /api/tasks/:id)のイベントとliveTextから、
 * 直近のツール実行と最新出力の末尾を表示用に組み立てる。
 */

export interface ProgressEventLike {
  kind: string;
  text: string;
  at: number;
}

export interface TaskDetailLike {
  events?: ProgressEventLike[] | null;
  liveText?: string | null;
}

export interface LiveProgress {
  /** 直近のツール実行(時系列順、最大MAX_TOOLS件) */
  tools: string[];
  /** 最新出力の末尾。長い場合は先頭を…で省略する */
  tail: string;
}

const MAX_TOOLS = 3;
const MAX_TAIL_CHARS = 400;

export function buildLiveProgress(detail: TaskDetailLike): LiveProgress {
  const tools = (detail.events ?? [])
    .filter((e) => e.kind === "tool")
    .slice(-MAX_TOOLS)
    .map((e) => e.text);
  const live = (detail.liveText ?? "").trim();
  const tail = live.length > MAX_TAIL_CHARS ? `…${live.slice(-MAX_TAIL_CHARS)}` : live;
  return { tools, tail };
}
