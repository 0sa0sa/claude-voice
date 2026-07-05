/** In-memory per-browser-session state. */
export interface SessionState {
  claudeSessionId?: string;
  seenTriggers: string[];
  /** Transcript length at the last interjection; only re-interject once the user has said more. */
  lastInterjectLen: number;
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
