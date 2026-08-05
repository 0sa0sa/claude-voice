import type { ClaudeEvent } from "./types.js";

/** Accumulates stream chunks and yields complete lines. */
export class LineBuffer {
  private rest = "";

  push(chunk: string): string[] {
    this.rest += chunk;
    const lines = this.rest.split("\n");
    this.rest = lines.pop() ?? "";
    return lines.filter((l) => l.trim() !== "");
  }

  flush(): string[] {
    const out = this.rest.trim() === "" ? [] : [this.rest];
    this.rest = "";
    return out;
  }
}

/**
 * Parses one NDJSON line of `claude -p --output-format stream-json
 * --include-partial-messages` output into a simplified event.
 */
export function parseClaudeLine(line: string): ClaudeEvent | null {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object") return null;

  if (obj.type === "system" && obj.subtype === "init" && typeof obj.session_id === "string") {
    return { kind: "session", sessionId: obj.session_id };
  }
  if (obj.type === "stream_event") {
    const delta = obj.event?.delta;
    if (obj.event?.type === "content_block_delta" && delta?.type === "text_delta") {
      return { kind: "delta", text: delta.text ?? "" };
    }
    return null;
  }
  if (obj.type === "assistant") {
    return null;
  }
  if (obj.type === "result") {
    if (obj.subtype === "success") {
      return { kind: "result", text: obj.result ?? "", sessionId: obj.session_id };
    }
    return { kind: "error", text: obj.subtype ?? "unknown error", sessionId: obj.session_id };
  }
  return null;
}

/**
 * Extracts tool invocations (name + short argument hint) from an assistant
 * message line, for task activity display.
 */
export function parseToolUses(line: string): string[] {
  let obj: any;
  try {
    obj = JSON.parse(line);
  } catch {
    return [];
  }
  if (obj?.type !== "assistant" || !Array.isArray(obj.message?.content)) return [];
  const out: string[] = [];
  for (const block of obj.message.content) {
    if (block?.type !== "tool_use") continue;
    const input = block.input ?? {};
    const hint =
      typeof input.command === "string"
        ? input.command
        : typeof input.file_path === "string"
          ? input.file_path
          : typeof input.pattern === "string"
            ? input.pattern
            : "";
    out.push(hint ? `${block.name}: ${hint.slice(0, 60)}` : String(block.name ?? "tool"));
  }
  return out;
}
