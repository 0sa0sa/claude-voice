/** In-memory per-browser-session state. */
export interface SessionState {
  claudeSessionId?: string;
  activeProject?: string;
  seenTriggers: string[];
  /** Transcript length at the last interjection; only re-interject once the user has said more. */
  lastInterjectLen: number;
  /** バージインで打ち切るための、現在進行中の /api/chat 呼び出しのAbortController。 */
  activeChatAbort?: AbortController;
}

export class SessionStore {
  private map = new Map<string, SessionState>();

  get(browserSessionId: string): SessionState {
    let s = this.map.get(browserSessionId);
    if (!s) {
      s = { seenTriggers: [], lastInterjectLen: -1 };
      this.map.set(browserSessionId, s);
    }
    return s;
  }
}
