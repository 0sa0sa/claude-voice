import type { QuickAsk } from "./types.js";

export type InterjectionReason = "vague-ref" | "vague-spec" | "jargon";

export interface InterjectionHit {
  trigger: string;
  question: string;
  reason: InterjectionReason;
}

const COMMON_ACRONYMS = new Set([
  "API", "URL", "HTML", "CSS", "JS", "TS", "SQL", "DB", "UI", "UX", "OK", "NG",
  "PC", "OS", "CPU", "GPU", "RAM", "SSD", "HTTP", "HTTPS", "JSON", "XML", "CSV",
  "PDF", "PNG", "JPG", "GIF", "SVG", "AI", "ML", "LLM", "CLI", "SDK", "IDE",
  "PR", "CI", "CD", "QA", "SNS", "LINE", "AWS", "GCP", "ID", "IP", "DNS", "SSH",
  "TDD", "MVP", "SPA", "SSR", "SEO", "REST", "GRPC", "JWT", "OAUTH", "TTS", "STT",
]);

// 「例の」等の後ろは、助詞・句読点に当たるまでを対象語として切り出す
const VAGUE_REF_PREFIXES = ["例の", "あの件", "この前の", "いつもの"];
const BOUNDARY = /[をがはにでともへ、。！？!?\s]/;

function extractVagueRef(text: string): string | null {
  for (const prefix of VAGUE_REF_PREFIXES) {
    const i = text.indexOf(prefix);
    if (i === -1) continue;
    if (prefix === "あの件") return prefix;
    let end = i + prefix.length;
    while (end < text.length && end - i < prefix.length + 10 && !BOUNDARY.test(text[end])) {
      end++;
    }
    const trigger = text.slice(i, end);
    if (trigger.length > prefix.length) return trigger;
  }
  return null;
}

const VAGUE_SPEC_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /いい感じに?/g, label: "いい感じ" },
  { re: /適当に/g, label: "適当に" },
  { re: /うまいこと|うまい具合に/g, label: "うまいこと" },
  { re: /ちゃちゃっと|ささっと/g, label: "ちゃちゃっと" },
];

const MIN_LENGTH = 6;

function firstMatch(
  text: string,
  patterns: Array<{ re: RegExp; label: string }>,
): { trigger: string; label: string } | null {
  for (const { re, label } of patterns) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) return { trigger: m[0], label };
  }
  return null;
}

function findAcronym(text: string): string | null {
  const re = /\b([A-Z]{2,6})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!COMMON_ACRONYMS.has(m[1])) return m[1];
  }
  return null;
}

/**
 * Heuristic layer: finds the first "worth interrupting" ambiguity in a live
 * transcript. Pure and synchronous so it can run on every interim update.
 */
export function analyzeTranscript(
  text: string,
  opts?: { seenTriggers?: string[] },
): InterjectionHit | null {
  if (text.trim().length < MIN_LENGTH) return null;
  const seen = new Set(opts?.seenTriggers ?? []);

  const ref = extractVagueRef(text);
  if (ref && !seen.has(ref)) {
    return {
      trigger: ref,
      reason: "vague-ref",
      question: `「${ref}」というのは、具体的にどれのことですか？`,
    };
  }

  const acronym = findAcronym(text);
  if (acronym && !seen.has(acronym)) {
    return {
      trigger: acronym,
      reason: "jargon",
      question: `${acronym} というのは何のことですか？`,
    };
  }

  const spec = firstMatch(text, VAGUE_SPEC_PATTERNS);
  if (spec && !seen.has(spec.trigger)) {
    return {
      trigger: spec.trigger,
      reason: "vague-spec",
      question: `「${spec.label}」の基準を教えてもらえますか？例えば見た目・速さ・使いやすさのどれを優先しますか？`,
    };
  }

  return null;
}

export interface InterjectionDecision {
  interject: boolean;
  question: string;
  trigger?: string;
  reason?: InterjectionReason;
  source?: "claude" | "heuristic";
}

/**
 * Combines the heuristic layer with an optional low-latency Claude refinement.
 * The heuristic decides IF we interject; Claude only improves the wording,
 * so a slow or failing Claude never blocks or suppresses an interjection.
 */
export async function decideInterjection(opts: {
  transcript: string;
  recentContext?: string;
  seenTriggers: string[];
  ask: QuickAsk;
}): Promise<InterjectionDecision> {
  const hit = analyzeTranscript(opts.transcript, { seenTriggers: opts.seenTriggers });
  if (!hit) return { interject: false, question: "" };

  let question = hit.question;
  let source: "claude" | "heuristic" = "heuristic";
  try {
    const prompt = [
      "あなたは音声で要件ヒアリング中のアシスタント。ユーザーはまだ話している途中。",
      "以下の発話に含まれる曖昧な点について、短い確認質問を日本語で1つだけ返して。",
      "質問文のみを返すこと。確認が不要なら NONE とだけ返して。40文字以内。",
      opts.recentContext ? `これまでの文脈: ${opts.recentContext}` : "",
      `発話(途中): ${opts.transcript}`,
      `曖昧な箇所: ${hit.trigger}`,
    ]
      .filter(Boolean)
      .join("\n");
    const refined = (await opts.ask(prompt, { timeoutMs: 3000 })).trim();
    if (refined && refined !== "NONE" && refined.length <= 120) {
      question = refined;
      source = "claude";
    }
  } catch {
    // keep heuristic question
  }

  return { interject: true, question, trigger: hit.trigger, reason: hit.reason, source };
}
