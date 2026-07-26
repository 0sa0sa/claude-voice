export type Directive =
  | { action: "start_task"; project?: string; instruction: string }
  | { action: "switch_project"; project: string }
  | { action: "cancel_task"; taskId: string };

const MARKER = "@@CV";

function validate(obj: any): Directive | null {
  if (!obj || typeof obj !== "object") return null;
  switch (obj.action) {
    case "start_task":
      if (typeof obj.instruction === "string" && obj.instruction.trim()) {
        return {
          action: "start_task",
          instruction: obj.instruction,
          ...(typeof obj.project === "string" ? { project: obj.project } : {}),
        };
      }
      return null;
    case "switch_project":
      return typeof obj.project === "string" && obj.project.trim()
        ? { action: "switch_project", project: obj.project }
        : null;
    case "cancel_task":
      return typeof obj.taskId === "string" && obj.taskId.trim()
        ? { action: "cancel_task", taskId: obj.taskId }
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
