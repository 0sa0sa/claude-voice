# Claude Code 完全音声化 (JARVIS化) セットアップ — 2026-07-26

Claude Codeとのやりとりを音声入出力で行うための構成。結論: **VoiceModeプラグイン**(ローカルWhisper STT + Kokoro TTS)を本命とし、既存の`claude-voice` Webアプリを補完として併用する。

## アーキテクチャ

```
あなたの声
  └→ [マイク] → whisper.cpp サーバー (port 2022, large-v3-turbo, 日本語)
        └→ voicemode MCP (converse ツール) → Claude Code 本体セッション
              └→ 応答テキスト → Kokoro TTS (port 8880, jf_alpha 日本語ボイス)
                    └→ [スピーカー]
```

- **会話ループ**: Claudeが`converse`ツールで「話す→黙って聞く→無音検出で自動送信」を繰り返す。
  ターミナル入力は一切不要になる(=JARVIS体験)。
- **フック**: プラグインがStop/Notification/PermissionRequest等6種のフックを設置済み。
  ツール実行や許可要求時に効果音(サウンドフォント)が鳴る。
- **すべてローカル**: APIキー不要・オフライン動作・課金なし(Apple M2で動作確認)。

## 使い方

任意のClaude Codeセッションで:

```
/voicemode:converse           # 音声会話開始(以降ずっと音声でやりとり)
/voicemode:converse jf_alpha こんにちは   # ボイスと最初の一言を指定
/voicemode:status             # サービス稼働確認
```

いったん`converse`が始まると、Claudeは応答を読み上げ→マイクで待ち受け、を繰り返す。
「もう音声いいよ」と言えば通常モードに戻る。

## インストール済みの構成

| コンポーネント | 状態 | 備考 |
|---|---|---|
| voicemode プラグイン 8.12.0 | `claude plugin install voicemode@voicemode` | marketplace: `mbailey/voicemode` |
| voice-mode CLI (uv tool) | `uv tool install voice-mode` | **必須**: これがないとMCPが`Failed to spawn`で接続失敗(下記トラブルシュート) |
| whisper.cpp サーバー | `voicemode service install whisper` | port 2022, launchd常駐 |
| Whisperモデル | `voicemode whisper model large-v3-turbo` | 日本語精度優先(~1.6GB)。遅ければ`small`へ |
| Kokoro TTS | `voicemode service install kokoro` | port 8880, launchd常駐, 日本語G2P(pyopenjtalk-plus)入り |
| portaudio / ffmpeg | brew | 録音・変換用 |

## 日本語設定 (`~/.voicemode/voicemode.env`)

```bash
VOICEMODE_VOICES=jf_alpha,af_sky   # Kokoroの日本語女声を最優先(jm_kumo=男声等もある)
VOICEMODE_WHISPER_LANGUAGE=ja      # 文字起こしを日本語固定(autoより誤認識が減る)
```

環境変数が同名で設定されているとそちらが優先される点に注意。

## トラブルシュート

- **MCPが`✘ Failed to connect`**: プラグインのMCPはcwd=カレントプロジェクトで`uv run voicemode`を
  実行するため、グローバルに`voice-mode`が入っていないとspawnに失敗する。
  → `uv tool install voice-mode` で解決(実測で確認済み)。
- **サービス状態確認**: `voicemode status` / `voicemode service logs whisper|kokoro`
- **初回起動が遅い**: Kokoroは初回にPython依存+モデル(~300MB)をダウンロードする。
- **ポート**: whisper=2022, kokoro=8880。既存アプリ(8787/8788/8791/8799)とは干渉しない。

## 補完レイヤー

- **claude-voice Webアプリ** (このリポジトリ, `npm run dev` → http://localhost:5183):
  ブラウザからの音声会話+発話途中割り込み。要件整理・壁打ち用途に引き続き有効。
- **macOS `say -v Kyoko`**: 最後の砦のTTSフォールバック。
- ウェイクワード(「Hey JARVIS」で起動)はVoiceMode未対応。常時起動セッションで
  `converse`ループを維持する運用でカバーする。

## 検証結果 (2026-07-26, マイク以外は実測)

ループバックE2Eテスト(マイク不要で音声往復を検証):

1. **STT疎通**: `say -v Kyoko`で生成した「明日の朝九時に会議の予定を入れてください」を
   whisperサーバー(port 2022)に投げて認識成功。baseモデルでは「朝九時→朝食事」の
   誤認識があったため large-v3-turbo に切り替え。
2. **TTS**: Kokoro(port 8880)に日本語テキストをPOST → 24kHz WAV生成成功(voice=jf_alpha)。
3. **完全ループバック**: KokoroのTTS出力をWhisperに再入力 →
   「こんにちはジャービスです 音声システムのテストをしています」と**一字一句正確に**認識。
4. **voicemodeパイプライン実測**: `voicemode converse --skip-stt -m "..."` で
   日本語発話成功。TTFA(初回音声まで)3.0秒、Kokoro jf_alpha 使用を確認。
5. **MCP接続**: `claude mcp list` → `plugin:voicemode:voicemode ✔ Connected`。

未検証(物理的にマイク入力が必要): 実際に人が話しての`converse`往復。
→ 新しいClaude Codeセッションで `/voicemode:converse` を実行して試す。
