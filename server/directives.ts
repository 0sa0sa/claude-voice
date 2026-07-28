export type Directive =
  | { action: "start_task"; project?: string; instruction: string; resume?: string }
  | { action: "append_task"; taskId: string; instruction: string }
  | { action: "switch_project"; project: string }
  | { action: "cancel_task"; taskId: string }
  | { action: "fix_transcript"; corrected: string }
  | { action: "ui_focus_task"; taskId: string }
  | { action: "ui_toggle_sidebar"; open: boolean }
  | { action: "ui_highlight_project"; project: string };

const MARKER = "@@CV";

/**
 * タスク参照(taskId / resume)の正規化。連番指定を促しているため、
 * モデルがJSON数値で出してきても文字列に寄せて受理する。
 */
function taskRef(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function validate(obj: any): Directive | null {
  if (!obj || typeof obj !== "object") return null;
  switch (obj.action) {
    case "start_task":
      if (typeof obj.instruction === "string" && obj.instruction.trim()) {
        const resume = taskRef(obj.resume);
        return {
          action: "start_task",
          instruction: obj.instruction,
          ...(typeof obj.project === "string" ? { project: obj.project } : {}),
          ...(resume !== null ? { resume } : {}),
        };
      }
      return null;
    case "append_task": {
      const taskId = taskRef(obj.taskId);
      if (taskId !== null && typeof obj.instruction === "string" && obj.instruction.trim()) {
        return { action: "append_task", taskId, instruction: obj.instruction };
      }
      return null;
    }
    case "switch_project":
      return typeof obj.project === "string" && obj.project.trim()
        ? { action: "switch_project", project: obj.project }
        : null;
    case "cancel_task": {
      const taskId = taskRef(obj.taskId);
      return taskId !== null ? { action: "cancel_task", taskId } : null;
    }
    case "fix_transcript":
      return typeof obj.corrected === "string" && obj.corrected.trim()
        ? { action: "fix_transcript", corrected: obj.corrected }
        : null;
    case "ui_focus_task": {
      const taskId = taskRef(obj.taskId);
      return taskId !== null ? { action: "ui_focus_task", taskId } : null;
    }
    case "ui_toggle_sidebar":
      return typeof obj.open === "boolean" ? { action: "ui_toggle_sidebar", open: obj.open } : null;
    case "ui_highlight_project":
      return typeof obj.project === "string" && obj.project.trim()
        ? { action: "ui_highlight_project", project: obj.project }
        : null;
    default:
      return null;
  }
}

/**
 * Pulls `@@CV {json}` control lines out of the conversation Claude's reply.
 * Marker lines are always removed from the text shown/spoken to the user,
 * even when their payload is invalid.
 */
export function extractDirectives(text: string): { directives: Directive[]; cleanText: string } {
  const directives: Directive[] = [];
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(MARKER)) {
      kept.push(line);
      continue;
    }
    try {
      const d = validate(JSON.parse(trimmed.slice(MARKER.length).trim()));
      if (d) directives.push(d);
    } catch {
      // malformed marker line: drop it silently
    }
  }
  return { directives, cleanText: kept.join("\n").trim() };
}
