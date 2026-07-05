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
