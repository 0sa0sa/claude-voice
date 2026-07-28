import type { ThreadEntry } from "../lib/taskThread";

interface TaskThreadProps {
  /** フォーカス中タスクの連番(見出し表示用) */
  seq: number;
  project: string;
  entries: ThreadEntry[];
  onClose: () => void;
}

const KIND_LABEL: Record<ThreadEntry["kind"], string> = {
  instruction: "指示",
  appended: "追加指示",
  result: "結果",
  error: "エラー",
};

/** フォーカス中タスクの指示・追加指示・結果・追いタスクを1本の時系列で見せるスレッドビュー */
export function TaskThread({ seq, project, entries, onClose }: TaskThreadProps) {
  // スレッド1本目のタスクの連番。同じ連番のエントリにバッジを重ねて出さない
  const rootSeq = entries[0]?.seq;
  return (
    <section className="task-thread" role="region" aria-label={`タスク #${seq} のスレッド`}>
      <div className="thread-head">
        {/* 見た目の表記は「スレッド #n」: 画面の他の「タスク #n」表記(宛先チップ等)との
            重複を避け、テキスト検索でも一意になるようにする */}
        <span className="thread-title">
          スレッド #{seq} · {project}
        </span>
        <button className="thread-close" onClick={onClose} aria-label="スレッドを閉じる">
          ✕
        </button>
      </div>
      <ul className="thread-list">
        {entries.map((e, i) => (
          <li key={`${e.taskId}-${e.kind}-${e.at}-${i}`} className={`thread-entry thread-${e.kind}`}>
            <span className="thread-kind">{KIND_LABEL[e.kind]}</span>
            {e.seq !== rootSeq && <span className="thread-seq">#{e.seq}</span>}
            <p className="thread-text">{e.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
