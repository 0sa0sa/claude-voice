import { spawn } from "node:child_process";
import { LineBuffer, parseClaudeLine, parseToolUses } from "./streamJson.js";
import type { TaskSpawner } from "./taskManager.js";
import type { ChatRunner, QuickAsk } from "./types.js";

const CLAUDE_BIN = process.env.CLAUDE_VOICE_BIN ?? "claude";
const CHAT_TIMEOUT_MS = 120_000;
const TASK_TIMEOUT_MS = 30 * 60_000;

/**
 * Streams a conversation turn through the local Claude Code CLI.
 * Uses stream-json + partial messages for token-level streaming and
 * --resume for session continuity.
 */
export function createCliRunner(): ChatRunner {
  return {
    mode: "cli",
    run({ prompt, systemPrompt, resumeSessionId, onEvent }) {
      return new Promise((resolve, reject) => {
        const args = [
          "-p",
          "--output-format",
          "stream-json",
          "--include-partial-messages",
          "--verbose",
          // 会話レーンはツール禁止(高速・テキストのみ)。実作業は @@CV でタスクレーンへ回す。
          // 注意: --allowedTools "" は「全許可」扱いになり、モデルがBash等を試して
          // max-turns超過(error_max_turns)を起こす。全無効化は --tools "" が正しい。
          "--tools",
          "",
          // ツールを封じても稀にMCPツールを試す場合があるため、1手余裕を持たせて復帰させる。
          "--max-turns",
          "3",
        ];
        if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
        if (resumeSessionId) args.push("--resume", resumeSessionId);

        const child = spawn(CLAUDE_BIN, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
        });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("claude CLI timed out"));
        }, CHAT_TIMEOUT_MS);

        let sessionId: string | undefined;
        let resultText = "";
        let stderr = "";
        const buf = new LineBuffer();

        const handleLines = (lines: string[]) => {
          for (const line of lines) {
            const e = parseClaudeLine(line);
            if (!e) continue;
            if (e.kind === "session") sessionId = e.sessionId;
            if (e.kind === "result") {
              resultText = e.text ?? "";
              if (e.sessionId) sessionId = e.sessionId;
            }
            onEvent(e);
          }
        };

        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => handleLines(buf.push(chunk)));
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => (stderr += chunk));
        child.on("error", (err) => {
          clearTimeout(timer);
          reject(new Error(`claude CLI起動に失敗しました: ${err.message}`));
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          handleLines(buf.flush());
          if (code === 0 || resultText) {
            resolve({ sessionId, text: resultText });
          } else {
            reject(new Error(`claude CLIが異常終了しました (code ${code}): ${stderr.slice(0, 400)}`));
          }
        });

        child.stdin.write(prompt);
        child.stdin.end();
      });
    },
  };
}

/** Fast one-shot ask (haiku, plain text) for interjection wording. */
export function createCliQuickAsk(): QuickAsk {
  return (prompt, opts) =>
    new Promise((resolve, reject) => {
      const timeoutMs = opts?.timeoutMs ?? 3000;
      const child = spawn(
        CLAUDE_BIN,
        ["-p", "--model", "haiku", "--tools", "", "--max-turns", "1"],
        { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } },
      );
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("quick ask timed out"));
      }, timeoutMs);
      let out = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (c: string) => (out += c));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`quick ask failed (code ${code})`));
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
}

/**
 * Tool-enabled Claude Code run in a project directory — the execution lane.
 * Unlike the chat lane this can edit files and run commands.
 */
export function createCliTaskSpawner(): TaskSpawner {
  // 既定はハンズフリー優先(ユーザーのjarvis運用に合わせる)。ヘッドレス-pでは
  // acceptEditsだとBash系が許可待ちにならず失敗するため、絞りたい場合のみ環境変数で上書き。
  const permissionMode = process.env.CLAUDE_VOICE_PERMISSION_MODE ?? "bypassPermissions";
  return ({ instruction, cwd, onEvent, signal }) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        CLAUDE_BIN,
        [
          "-p",
          "--output-format",
          "stream-json",
          "--include-partial-messages",
          "--verbose",
          "--permission-mode",
          permissionMode,
        ],
        { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } },
      );
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("タスクがタイムアウトしました(30分)"));
      }, TASK_TIMEOUT_MS);
      const onAbort = () => child.kill("SIGKILL");
      signal.addEventListener("abort", onAbort, { once: true });

      let resultText = "";
      let stderr = "";
      const buf = new LineBuffer();
      const handleLines = (lines: string[]) => {
        for (const line of lines) {
          for (const tool of parseToolUses(line)) onEvent({ kind: "tool", name: tool });
          const e = parseClaudeLine(line);
          if (e?.kind === "delta" && e.text) onEvent({ kind: "delta", text: e.text });
          if (e?.kind === "result") resultText = e.text ?? "";
          if (e?.kind === "error") onEvent({ kind: "error", text: e.text });
        }
      };
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => handleLines(buf.push(chunk)));
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`claude CLI起動に失敗しました: ${err.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        handleLines(buf.flush());
        if (signal.aborted) reject(new Error("中止されました"));
        else if (code === 0 || resultText) resolve({ text: resultText });
        else reject(new Error(`タスクが異常終了しました (code ${code}): ${stderr.slice(0, 400)}`));
      });

      child.stdin.write(instruction);
      child.stdin.end();
    });
}

/** Mock task spawner: pretends to work for a moment, then succeeds. */
export function createMockTaskSpawner(): TaskSpawner {
  return async ({ instruction, onEvent, signal }) => {
    onEvent({ kind: "tool", name: "Bash: echo mock" });
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 400));
      if (signal.aborted) throw new Error("中止されました");
      onEvent({ kind: "delta", text: `作業中(${i + 1}/3)…` });
    }
    return { text: `(モック) 「${instruction.slice(0, 30)}」を完了しました` };
  };
}

/** Deterministic runner for tests / demo without the CLI. */
export function createMockRunner(): ChatRunner {
  return {
    mode: "mock",
    async run({ prompt, resumeSessionId, onEvent }) {
      const sessionId = resumeSessionId ?? `mock-${Math.random().toString(36).slice(2, 8)}`;
      onEvent({ kind: "session", sessionId });
      const reply = `(モック応答) 「${prompt.slice(-40)}」について理解しました。次にどう進めますか？`;
      for (const ch of reply.match(/.{1,6}/g) ?? []) {
        await new Promise((r) => setTimeout(r, 30));
        onEvent({ kind: "delta", text: ch });
      }
      onEvent({ kind: "result", text: reply, sessionId });
      return { sessionId, text: reply };
    },
  };
}

export const mockQuickAsk: QuickAsk = async () => "NONE";
