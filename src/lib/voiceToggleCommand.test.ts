import { describe, expect, it } from "vitest";
import { parseVoiceToggleCommand } from "./voiceToggleCommand";

describe("parseVoiceToggleCommand", () => {
  it("「ボイスオフ」を読み上げ無効化コマンドとして解釈する", () => {
    expect(parseVoiceToggleCommand("ボイスオフ")).toBe("off");
    expect(parseVoiceToggleCommand("ボイス オフ")).toBe("off");
    expect(parseVoiceToggleCommand("ヴォイスオフ")).toBe("off");
  });

  it("「ボイスオン」を読み上げ再開コマンドとして解釈する", () => {
    expect(parseVoiceToggleCommand("ボイスオン")).toBe("on");
    expect(parseVoiceToggleCommand("ボイス オン")).toBe("on");
  });

  it("英語表記(voice off / voice on)も大文字小文字を問わず受け付ける", () => {
    expect(parseVoiceToggleCommand("voice off")).toBe("off");
    expect(parseVoiceToggleCommand("Voice Off")).toBe("off");
    expect(parseVoiceToggleCommand("VOICE ON")).toBe("on");
    expect(parseVoiceToggleCommand("voiceoff")).toBe("off");
  });

  it("「読み上げオフ」「読み上げオン」も受け付ける", () => {
    expect(parseVoiceToggleCommand("読み上げオフ")).toBe("off");
    expect(parseVoiceToggleCommand("読み上げオン")).toBe("on");
  });

  it("「にして」などの軽い動詞つきも受け付ける", () => {
    expect(parseVoiceToggleCommand("ボイスオフにして")).toBe("off");
    expect(parseVoiceToggleCommand("ボイスをオンにして")).toBe("on");
    expect(parseVoiceToggleCommand("読み上げをオフにして")).toBe("off");
  });

  it("「オンエア」「オフエア」の言い回しもオン/オフとして受け付ける", () => {
    expect(parseVoiceToggleCommand("ボイスオンエア")).toBe("on");
    expect(parseVoiceToggleCommand("ボイスオフエア")).toBe("off");
    expect(parseVoiceToggleCommand("ボイス オンエア")).toBe("on");
    expect(parseVoiceToggleCommand("読み上げオフエア")).toBe("off");
    expect(parseVoiceToggleCommand("voice onair")).toBe("on");
    expect(parseVoiceToggleCommand("Voice Offair")).toBe("off");
    expect(parseVoiceToggleCommand("ボイスをオンエアにして")).toBe("on");
    expect(parseVoiceToggleCommand("読み上げをオフエアにして")).toBe("off");
  });

  it("末尾の句読点や空白は無視する", () => {
    expect(parseVoiceToggleCommand(" ボイスオフ。 ")).toBe("off");
    expect(parseVoiceToggleCommand("ボイスオン!")).toBe("on");
  });

  it("通常の指示や依頼はコマンドとして扱わない", () => {
    expect(parseVoiceToggleCommand("ボイスオフの実装をして")).toBeNull();
    expect(parseVoiceToggleCommand("ボイスオフ機能のテストを直して")).toBeNull();
    expect(parseVoiceToggleCommand("ボイス")).toBeNull();
    expect(parseVoiceToggleCommand("オフ")).toBeNull();
    expect(parseVoiceToggleCommand("テストを回して")).toBeNull();
    expect(parseVoiceToggleCommand("")).toBeNull();
    expect(parseVoiceToggleCommand("   ")).toBeNull();
  });
});
