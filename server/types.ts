export interface ClaudeEvent {
  kind: "session" | "delta" | "result" | "error";
  text?: string;
  sessionId?: string;
}

export interface ChatRunner {
  mode: "cli" | "mock";
  run(opts: {
    prompt: string;
    systemPrompt?: string;
    resumeSessionId?: string;
    onEvent: (e: ClaudeEvent) => void;
    signal?: AbortSignal;
  }): Promise<{ sessionId?: string; text: string }>;
}

/** One-shot, low-latency question to Claude (used for interjections). */
export type QuickAsk = (prompt: string, opts?: { timeoutMs?: number }) => Promise<string>;
