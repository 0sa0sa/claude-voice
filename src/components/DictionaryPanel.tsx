import { useState } from "react";
import { isImeComposing } from "../lib/imeGuard";
import type { DictionaryEntry } from "../lib/speechDictionary";

export interface DictionaryPanelProps {
  entries: DictionaryEntry[];
  onAdd: (wrong: string, right: string) => void;
  onRemove: (wrong: string) => void;
}

/**
 * 音声補正辞書の一覧・追加・削除UI。
 * 「誤認識されがちな読み → 正しい表記」のペアを編集する。
 */
export function DictionaryPanel({ entries, onAdd, onRemove }: DictionaryPanelProps) {
  const [wrong, setWrong] = useState("");
  const [right, setRight] = useState("");

  const submit = () => {
    if (!wrong.trim() || !right.trim()) return;
    onAdd(wrong.trim(), right.trim());
    setWrong("");
    setRight("");
  };

  return (
    <details className="dict-panel">
      <summary className="dict-summary">音声補正辞書</summary>
      {entries.length === 0 ? (
        <p className="dict-empty">登録はまだありません</p>
      ) : (
        <ul className="dict-list">
          {entries.map((e) => (
            <li key={e.wrong} className="dict-row">
              <span className="dict-wrong">{e.wrong}</span>
              <span className="dict-arrow" aria-hidden>
                →
              </span>
              <span className="dict-right">{e.right}</span>
              <button
                className="dict-remove"
                onClick={() => onRemove(e.wrong)}
                aria-label={`${e.wrong} を削除`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="dict-add">
        <input
          className="dict-input"
          name="dictWrong"
          value={wrong}
          placeholder="誤認識される読み"
          onChange={(e) => setWrong(e.target.value)}
        />
        <input
          className="dict-input"
          name="dictRight"
          value={right}
          placeholder="正しい表記"
          onChange={(e) => setRight(e.target.value)}
          onKeyDown={(e) => {
            // IME確定のEnterでは登録しない
            if (e.key === "Enter" && !isImeComposing(e.nativeEvent)) submit();
          }}
        />
        <button className="dict-add-btn" onClick={submit}>
          登録
        </button>
      </div>
    </details>
  );
}
