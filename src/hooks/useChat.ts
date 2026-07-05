import { useCallback, useRef, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "interjection";
  text: string;
  streaming?: boolean;
}

let idCounter = 0;
const nextId = () => `m${++idCounter}`;

/** Reads the /api/chat SSE stream and maintains the message list. */
export function useChat(browserSessionId: string, onReplyDone?: (text: string) => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const onReplyDoneRef = useRef(onReplyDone);
  onReplyDoneRef.current = onReplyDone;

  const addInterjection = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role: "interjection", text }]);
  }, []);

  const send = useCallback(
    async (message: string) => {
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
        patchAssistant((m) => ({
          ...m,
          text: `接続エラー: ${err instanceof Error ? err.message : String(err)}`,
          streaming: false,
        }));
      } finally {
        setBusy(false);
      }
    },
    [browserSessionId],
  );

  return { messages, busy, send, addInterjection };
}
