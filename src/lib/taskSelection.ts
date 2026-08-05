/**
 * 追いタスク(フォローアップ)の選択対象になれるタスクの条件。
 * サーバーの resolveResume と同じ制約: 実行中は不可、セッションを残していないタスクも不可。
 */
export interface SelectableTaskLike {
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  /** 旧サーバーのペイロードにはキー自体が無い(undefined)ことがある */
  sessionId?: string | null;
}

export function isSelectableTask(task: SelectableTaskLike): boolean {
  return task.status !== "running" && task.sessionId != null;
}

/**
 * フォーカス(選択)したタスクへ次の指示をどう届けるか。
 * 実行中なら追加指示API(append)、セッションを残した完了タスクなら
 * 追いタスク(resume)。どちらもできないタスクはフォーカス不可(null)。
 */
export function focusTargetKind(task: SelectableTaskLike): "append" | "resume" | null {
  if (task.status === "running") return "append";
  return task.sessionId != null ? "resume" : null;
}

/** サイドバー等で見せる短縮IDの桁数。サーバーの新規IDはもともとこの長さ */
const SHORT_ID_LENGTH = 8;

/** 表示用の短縮ID。レガシーな長いUUIDは先頭8文字に切り詰める */
export function shortTaskId(id: string): string {
  return id.slice(0, SHORT_ID_LENGTH);
}

/**
 * 画面表示・読み上げで使うタスクの呼び名。連番があれば「#3」。
 * 旧サーバーのペイロードには連番が無いため、その場合は短縮IDで示し、
 * 「タスク #undefined」のような表示を出さない。
 */
export function taskLabel(task: { id: string; seq?: number }): string {
  return typeof task.seq === "number" ? `#${task.seq}` : shortTaskId(task.id);
}

/**
 * タスク参照(ID、または連番 "3" / "#3")からタスクを引く。
 * サーバーの TaskManager.resolve と同じ解決規則。
 * 加えて、画面に見えている短縮IDでもレガシーな長いIDを引けるように
 * 一意なプレフィックス(短縮ID桁数以上)での解決を許す。
 */
export function resolveTaskReference<T extends { id: string; seq: number }>(
  tasks: T[],
  ref: string,
): T | undefined {
  const trimmed = ref.trim();
  const byId = tasks.find((t) => t.id === trimmed);
  if (byId) return byId;
  const num = /^#?(\d+)$/.exec(trimmed);
  if (num) {
    const seq = Number(num[1]);
    const bySeq = tasks.find((t) => t.seq === seq);
    if (bySeq) return bySeq;
  }
  if (trimmed.length >= SHORT_ID_LENGTH) {
    const byPrefix = tasks.filter((t) => t.id.startsWith(trimmed));
    if (byPrefix.length === 1) return byPrefix[0];
  }
  return undefined;
}
