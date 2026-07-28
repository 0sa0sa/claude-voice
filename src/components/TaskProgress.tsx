interface TaskProgressProps {
  /** 直近のツール実行(時系列順) */
  tools: string[];
  /** 最新出力の末尾 */
  tail: string;
}

/** 実行中タスクの途中経過: 直近のツール実行と最新出力の末尾を見せる */
export function TaskProgress({ tools, tail }: TaskProgressProps) {
  return (
    <div className="task-progress" role="group" aria-label="途中経過">
      {tools.length > 0 && (
        <ul className="task-progress-tools">
          {tools.map((t, i) => (
            <li key={`${t}-${i}`} className="task-progress-tool">
              {t}
            </li>
          ))}
        </ul>
      )}
      {tail ? (
        <p className="task-progress-tail">{tail}</p>
      ) : (
        tools.length === 0 && <p className="task-progress-waiting">出力を待っています…</p>
      )}
    </div>
  );
}
