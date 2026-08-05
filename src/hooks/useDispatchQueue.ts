import { useCallback, useRef, useState } from "react";
import {
  insertByPriority,
  makeUtterance,
  takeNext,
  type QueuedUtterance,
} from "../lib/dispatchQueue";

export interface DispatchQueueOptions {
  /**
   * 進行中の処理を打ち切るための割り込み。緊急発話が来たとき、または「止めて」等の
   * 割り込み発話のときに呼ばれ、直列処理を前倒しする。省略時は割り込みなし。
   */
  interrupt?: () => void;
}

/**
 * 発話ディスパッチキュー(非同期・優先度つき)。
 *
 * ユーザーが立て続けに話しても取りこぼさず、1件ずつ順に処理する。応答が終わるまで
 * 次の通常発話は待機し、緊急発話は待機列の先頭へ割り込んで進行中を打ち切る。
 * これにより「話す→順に処理される→緊急は最優先」という非同期のやりとりが成立する。
 *
 * dispatch は1発話の処理(チャット送信/タスク指示など)。チャットは応答完了まで、
 * タスク系はキュー投入まででresolveする想定。処理の完了を await して直列化する。
 */
export function useDispatchQueue(
  dispatch: (text: string) => void | Promise<void>,
  options: DispatchQueueOptions = {},
) {
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const interruptRef = useRef(options.interrupt);
  interruptRef.current = options.interrupt;

  const queueRef = useRef<QueuedUtterance[]>([]);
  const runningRef = useRef(false);
  const idRef = useRef(0);
  // 待機中(まだ処理を始めていない)発話。UIの「順番待ち」表示用。
  const [pending, setPending] = useState<QueuedUtterance[]>([]);
  const sync = () => setPending(queueRef.current.slice());

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      for (;;) {
        const { next, rest } = takeNext(queueRef.current);
        if (!next) break;
        queueRef.current = rest;
        sync();
        try {
          await dispatchRef.current(next.text);
        } catch {
          // 1件の失敗で列を止めない
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const item = makeUtterance(`u${++idRef.current}`, trimmed);
      queueRef.current = insertByPriority(queueRef.current, item);
      sync();
      // 緊急発話は進行中を打ち切って、割り込みで先に処理させる
      if (item.urgency === "urgent") interruptRef.current?.();
      void pump();
    },
    [pump],
  );

  return { submit, pending };
}
