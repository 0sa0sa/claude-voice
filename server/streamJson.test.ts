import { describe, expect, it } from "vitest";
import { LineBuffer, parseClaudeLine } from "./streamJson.js";

describe("LineBuffer", () => {
  it("splits complete lines from a chunk", () => {
    const buf = new LineBuffer();
    expect(buf.push('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("holds partial lines across chunks", () => {
    const buf = new LineBuffer();
    expect(buf.push('{"a"')).toEqual([]);
    expect(buf.push(':1}\n{"b"')).toEqual(['{"a":1}']);
    expect(buf.flush()).toEqual(['{"b"']);
  });

  it("ignores empty lines", () => {
    const buf = new LineBuffer();
    expect(buf.push("\n\n{\"a\":1}\n\n")).toEqual(['{"a":1}']);
  });
});

describe("parseClaudeLine", () => {
  it("extracts session id from system init", () => {
    const e = parseClaudeLine(
      JSON.stringify({ type: "system", subtype: "init", session_id: "abc-123" }),
    );
    expect(e).toEqual({ kind: "session", sessionId: "abc-123" });
  });

  it("extracts text deltas from stream_event", () => {
    const e = parseClaudeLine(
      JSON.stringify({
        type: "stream_event",
        event: {
          type: "content_block_delta",
          delta: { type: "text_delta", text: "こんにちは" },
        },
      }),
    );
    expect(e).toEqual({ kind: "delta", text: "こんにちは" });
  });

  it("ignores non-text deltas", () => {
    const e = parseClaudeLine(
      JSON.stringify({
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "x" } },
      }),
    );
    expect(e).toBeNull();
  });

  it("extracts final result text and session id", () => {
    const e = parseClaudeLine(
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "回答です",
        session_id: "abc-123",
      }),
    );
    expect(e).toEqual({ kind: "result", text: "回答です", sessionId: "abc-123" });
  });

  it("maps error results to error events", () => {
    const e = parseClaudeLine(
      JSON.stringify({ type: "result", subtype: "error_max_turns", session_id: "s" }),
    );
    expect(e?.kind).toBe("error");
  });

  it("returns null for unparseable lines", () => {
    expect(parseClaudeLine("not json")).toBeNull();
  });

  it("returns null for assistant message events (deltas already streamed)", () => {
    const e = parseClaudeLine(
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hi" }] } }),
    );
    expect(e).toBeNull();
  });
});
