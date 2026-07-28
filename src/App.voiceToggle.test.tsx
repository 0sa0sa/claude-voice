import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

class FakeUtterance {
  static instances: FakeUtterance[] = [];
  text: string;
  lang = "";
  rate = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
    FakeUtterance.instances.push(this);
  }
}

const fakeSynthesis = {
  speaking: false,
  speak: vi.fn(() => {
    fakeSynthesis.speaking = true;
  }),
  cancel: vi.fn(() => {
    fakeSynthesis.speaking = false;
  }),
};

beforeEach(() => {
  FakeUtterance.instances = [];
  fakeSynthesis.speaking = false;
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  vi.stubGlobal("speechSynthesis", fakeSynthesis);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      if (path.includes("/api/health")) return Response.json({ ok: true, mode: "mock" });
      if (path.includes("/api/projects")) return Response.json({ projects: [], active: null });
      if (path.includes("/api/tasks")) return Response.json({ tasks: [] });
      if (path.includes("/api/dictionary")) return Response.json({ entries: [] });
      return Response.json({ interject: false, question: "" });
    }),
  );
});

afterEach(() => {
  fakeSynthesis.speak.mockClear();
  fakeSynthesis.cancel.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function sendText(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(screen.getByPlaceholderText("キーボードでも話せます"), text);
  await user.click(screen.getByRole("button", { name: "送信" }));
}

function chatCalls() {
  return vi.mocked(fetch).mock.calls.filter(([u]) => String(u).includes("/api/chat"));
}

describe("音声コマンドによる読み上げのオンオフ切り替え", () => {
  it("「ボイスオフ」で読み上げが無効になり、チャットには送られない", async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole("checkbox", { name: "読み上げ" });
    expect(toggle).toBeChecked();

    await sendText(user, "ボイスオフ");

    await screen.findByText(/読み上げをオフにしました/);
    expect(toggle).not.toBeChecked();
    expect(chatCalls()).toHaveLength(0);
  });

  it("「ボイスオン」で読み上げが再開し、確認を読み上げる", async () => {
    const user = userEvent.setup();
    render(<App />);
    await sendText(user, "ボイスオフ");
    await screen.findByText(/読み上げをオフにしました/);
    FakeUtterance.instances = [];

    await sendText(user, "ボイスオン");

    await screen.findByText(/読み上げをオンにしました/);
    expect(screen.getByRole("checkbox", { name: "読み上げ" })).toBeChecked();
    // 再開の確認は音声でも伝える(オフ解除が耳で分かるように)
    expect(FakeUtterance.instances.some((u) => u.text.includes("読み上げをオンにしました"))).toBe(
      true,
    );
    expect(chatCalls()).toHaveLength(0);
  });

  it("「voice off」などの表記ゆれもコマンドとして消費する", async () => {
    const user = userEvent.setup();
    render(<App />);

    await sendText(user, "voice off");

    await screen.findByText(/読み上げをオフにしました/);
    expect(screen.getByRole("checkbox", { name: "読み上げ" })).not.toBeChecked();
    expect(chatCalls()).toHaveLength(0);
  });
});
