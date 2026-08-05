import { useCallback, useEffect, useState } from "react";
import type { DictionaryEntry } from "../lib/speechDictionary";

export interface UseDictionary {
  entries: DictionaryEntry[];
  add: (wrong: string, right: string) => Promise<void>;
  remove: (wrong: string) => Promise<void>;
}

/**
 * サーバー永続化された音声補正辞書の取得・編集。
 * 取得した entries は useSpeechRecognition の dictionary に渡して使う。
 */
export function useDictionary(): UseDictionary {
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);

  useEffect(() => {
    fetch("/api/dictionary")
      .then((r) => r.json())
      .then((j) => setEntries(j.entries ?? []))
      .catch(() => {
        /* offline */
      });
  }, []);

  const save = useCallback(async (next: DictionaryEntry[]) => {
    try {
      const res = await fetch("/api/dictionary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entries: next }),
      });
      if (res.ok) setEntries((await res.json()).entries ?? []);
    } catch {
      /* offline */
    }
  }, []);

  const add = useCallback(
    (wrong: string, right: string) =>
      save([...entries, { wrong: wrong.trim(), right: right.trim() }]),
    [entries, save],
  );

  const remove = useCallback(
    (wrong: string) => save(entries.filter((e) => e.wrong !== wrong)),
    [entries, save],
  );

  return { entries, add, remove };
}
