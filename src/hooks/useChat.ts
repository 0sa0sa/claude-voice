import { useCallback, useRef, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "interjection" | "system";
  text: string;
  streaming?: boolean;
}

export interface DirectiveResult {
  action: string;
  ok: boolean;
  detail?: string;
  taskId?: string;
  project?: string;
  /** fix_transcript: 音声誤認識をLLMが文脈補正した後の発話全文 */
  corrected?: string;
  /** ui_toggle_sidebar: サイドバーを開いた状態にするか */
  open?: boolean;
}

let idCounter = 0;
const nextId = () => `m${++idCounter}`;

/** Reads the /api/chat SSE stream and maintains the message list. */
export function useChat(
  browserSessionId: string,
  onReplyDone?: (text: string) => void,
  onDirective?: (d: DirectiveResult) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const onReplyDoneRef = useRef(onReplyDone);
  onReplyDoneRef.current = onReplyDone;
  const onDirectiveRef = useRef(onDirective);
  onDirectiveRef.current = onDirective;

  const addInterjection = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role: "interjection", text }]);
  }, []);

  const addSystem = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role: "system", text }]);
  }, []);

  /** 直近のユーザー発話バブルの本文を差し替える(音声誤認識の文脈補正用)。 */
  const patchLastUserMessage = useCallback((text: string) => {
    setMessages((prev) => {
      const idx = prev.map((m) => m.role).lastIndexOf("user");
      if (idx === -1) return prev;
      return prev.map((m, i) => (i === idx ? { ...m, text } : m));
    });
  }, []);

  // 進行中の応答があるバージイン発話が来たら、待たずに前の応答を打ち切って新しい発話を送る。
  const activeAbortRef = useRef<AbortController | null>(null);

  /** 進行中の応答を打ち切る(緊急発話の割り込み・発話キューの前倒し用)。 */
  const interrupt = useCallback(() => {
    activeAbortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (message: string) => {
      activeAbortRef.current?.abort(); // 前の応答が進行中なら打ち切る(バージイン)
      const controller = new AbortController();
      activeAbortRef.current = controller;

      const userMsg: ChatMessage = { id: nextId(), role: "user", text: message };
      const assistantId = nextId();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: assistantId, role: "assistant", text: "", streaming: true },
      ]);
      setBusy(true);

      const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ browserSessionId, message }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalText = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const blocks = buf.split("\n\n");
          buf = blocks.pop() ?? "";
          for (const block of blocks) {
            const event = /^event: (.*)$/m.exec(block)?.[1];
            const dataRaw = /^data: (.*)$/m.exec(block)?.[1];
            if (!event || dataRaw === undefined) continue;
            const data = JSON.parse(dataRaw);
            if (event === "delta") {
              patchAssistant((m) => ({ ...m, text: m.text + data.text }));
            } else if (event === "directive") {
              onDirectiveRef.current?.(data as DirectiveResult);
            } else if (event === "done") {
              finalText = data.text;
              patchAssistant((m) => ({ ...m, text: data.text || m.text, streaming: false }));
            } else if (event === "error") {
              patchAssistant((m) => ({
                ...m,
                text: m.text || `エラー: ${data.message}`,
                streaming: false,
              }));
            }
          }
        }
        if (finalText) onReplyDoneRef.current?.(finalText);
      } catch (err) {
        if (controller.signal.aborted) {
          // 新しい発話に打ち切られただけ: エラー表示はせず、途中までの本文で確定させる
          patchAssistant((m) => ({ ...m, streaming: false }));
        } else {
          patchAssistant((m) => ({
            ...m,
            text: `接続エラー: ${err instanceof Error ? err.message : String(err)}`,
            streaming: false,
          }));
        }
      } finally {
        // 打ち切られた古い呼び出しのfinallyが、後発の呼び出しのbusy/abort状態を
        // 上書きしないようにする
        if (activeAbortRef.current === controller) {
          activeAbortRef.current = null;
          setBusy(false);
        }
      }
    },
    [browserSessionId],
  );

  return { messages, busy, send, interrupt, addInterjection, addSystem, patchLastUserMessage };
}
