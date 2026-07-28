import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  start() {
    FakeRecognition.last = this;
  }
  stop() {
    this.onend?.();
  }
}

function emit(finals: string[], interim = "") {
  const results = [
    ...finals.map((f) => Object.assign([{ transcript: f }], { isFinal: true })),
    ...(interim ? [Object.assign([{ transcript: interim }], { isFinal: false })] : []),
  ];
  FakeRecognition.last!.onresult?.({ resultIndex: 0, results });
}

beforeEach(() => {
  FakeRecognition.last = null;
  vi.stubGlobal("SpeechRecognition", FakeRecognition);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks: [] });
      return Response.json({ interject: false, question: "" });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startMic(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "マイクを開始" }));
}

const LONG_UTTERANCE =
  "今日やってほしいことを順番に説明すると、まずテストを全部回して、落ちたものがあれば原因を調べて直してほしい。";

describe("発話テキストの全文表示", () => {
  it("長い発話では全文トグルが現れ、クリックで展開・折りたたみできる", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await startMic(user);
    act(() => emit([LONG_UTTERANCE]));

    const toggle = screen.getByRole("button", { name: "全文" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const strip = container.querySelector(".live-strip")!;
    expect(strip).not.toHaveClass("expanded");

    await user.click(toggle);
    expect(strip).toHaveClass("expanded");
    const collapse = screen.getByRole("button", { name: "たたむ" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    await user.click(collapse);
    expect(strip).not.toHaveClass("expanded");
    expect(screen.getByRole("button", { name: "全文" })).toBeInTheDocument();
  });

  it("短い発話ではトグルを出さない", async () => {
    const user = userEvent.setup();
    render(<App />);
    await startMic(user);
    act(() => emit(["テスト回して"]));

    expect(screen.getByRole("textbox", { name: "認識テキスト(編集できます)" })).toHaveValue(
      "テスト回して",
    );
    expect(screen.queryByRole("button", { name: "全文" })).toBeNull();
  });

  it("送信で入力欄がクリアされると展開状態も解除される", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await startMic(user);
    act(() => emit([LONG_UTTERANCE]));
    await user.click(screen.getByRole("button", { name: "全文" }));
    expect(container.querySelector(".live-strip")).toHaveClass("expanded");

    act(() => emit(["送信"]));
    expect(container.querySelector(".live-strip")).not.toHaveClass("expanded");
    expect(screen.getByRole("textbox", { name: "認識テキスト(編集できます)" })).toHaveValue("");
  });
});
