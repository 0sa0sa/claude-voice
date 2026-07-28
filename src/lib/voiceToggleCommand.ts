/**
 * TTS読み上げのオンオフを切り替える音声/テキストコマンド解析。
 * 「ボイスオフ」「voice off」「ボイスオンエア」などを無効化/再開として解釈する。
 */
export type VoiceToggleCommand = "on" | "off";

// 「ボイスオフ」「ボイス オフ」「voice off」「読み上げをオフにして」「ボイスオンエア」など。
// 「オンエア」「オフエア」は「オン」「オフ」の言い回しバリエーションとして扱う。
// 誤爆を避けるため文全体がコマンドの場合のみ受け付ける。
// 前方一致の短い語(オン/off)より先に長い語(オンエア/offair)を試す必要がある。
const TOGGLE_RE =
  /^(?:ボイス|ヴォイス|voice|読み上げ|音声)\s*を?\s*(オンエア|オフエア|オン|オフ|onair|offair|on|off)(?:\s*に\s*(?:して|する)\s*(?:ください)?)?$/i;

export function parseVoiceToggleCommand(text: string): VoiceToggleCommand | null {
  // 音声認識由来の末尾句読点・空白は落としてから判定する
  const t = text.trim().replace(/[、。..!!??\s]+$/, "");
  if (!t) return null;
  const m = TOGGLE_RE.exec(t);
  if (!m) return null;
  return /^(?:オン|オンエア|on|onair)$/i.test(m[1]) ? "on" : "off";
}
