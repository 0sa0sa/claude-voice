export interface TranscriptState {
  finals: string[];
  interim: string;
}

export function emptyTranscript(): TranscriptState {
  return { finals: [], interim: "" };
}

/** Applies one SpeechRecognition result batch: newly finalized segments + current interim. */
export function applyRecognition(
  state: TranscriptState,
  finalsToAppend: string[],
  interim: string,
): TranscriptState {
  return {
    finals: finalsToAppend.length > 0 ? [...state.finals, ...finalsToAppend] : state.finals,
    interim,
  };
}

export function fullText(state: TranscriptState): string {
  return state.finals.join("") + state.interim;
}

/** Only ping the interjection endpoint once enough new speech has accumulated. */
export function shouldQueryInterjection(prev: string, next: string, minDelta = 12): boolean {
  if (next === prev) return false;
  return next.length - prev.length >= minDelta;
}

// 末尾に来たら送信とみなす音声コマンド。長い順に並べ、最初にマッチしたものを剥がす。
const SEND_COMMANDS = ["送信して", "そうしんして", "送信", "そうしん", "送って", "おくって"];

/**
 * 発話末尾の「送信」等のコマンドを検出する。triggered時、body はコマンドを
 * 取り除いた本文。body が空(コマンドのみ)の場合は送信すべきでない。
 */
export function detectSendCommand(text: string): { triggered: boolean; body: string } {
  const trimmed = text.replace(/[。、,.!?！？\s]+$/, "");
  for (const cmd of SEND_COMMANDS) {
    if (trimmed.endsWith(cmd)) {
      const body = trimmed.slice(0, trimmed.length - cmd.length).replace(/[。、,.!?！？\s]+$/, "");
      return { triggered: true, body };
    }
  }
  return { triggered: false, body: text };
}
