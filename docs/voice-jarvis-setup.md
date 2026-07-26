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

ターミナルで一言:

```
jarvis                        # ~/.local/bin/jarvis — 音声会話モードで起動(--dangerously-skip-permissions付き=許可プロンプトなしの完全ハンズフリー)
```

または任意のClaude Codeセッションで:

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

## セキュリティ (2026-07-26 ハードニング済み)

- **ローカルバインド**: whisper/kokoroはインストール直後は`0.0.0.0`(LAN全体に公開)で起動する。
  両起動スクリプトを`127.0.0.1`に修正済み(ループバックテストで機能維持を確認)。
  - 対象: `~/.voicemode/services/whisper/bin/start-whisper-server.sh`(2箇所)、
    `~/.voicemode/services/kokoro/start-gpu_mac.sh`
  - **注意: `voicemode service install --force`で再インストールするとこの修正は消える**。
    再インストール後は `lsof -nP -iTCP -sTCP:LISTEN | grep -E ':2022|:8880'` で
    `127.0.0.1`になっているか確認し、必要なら再修正。
- **プライバシー**: STT/TTSとも完全ローカル処理。APIキー未設定=音声データは外部送信されない。
  録音・書き起こしの保存はデフォルト無効(`VOICEMODE_SAVE_*`)で、~/.voicemode/audioは空を確認。
- **HTTPサーブモード(`voicemode serve`)は未使用**。過去のCVE類(X-Forwarded-For信頼問題
  GHSA-2qvv-vjq9-g5r4)はserveモードのみの話で、stdio接続の本構成には非該当。
- **サプライチェーン**: mbailey/voicemode(MIT・活発)+PyPI依存を信頼する構成。
  プラグインはClaude Codeの全イベントフックでスクリプトを実行する点は認識しておく。
  自動更新はされない(更新は手動コマンドのみ)ので、意図しないコード変更は入らない。
- macOSファイアウォールは無効のまま(システム全体の設定なので変更していない)。
  localhostバインド済みのため音声サービスに関しては必須ではないが、有効化推奨。

## アップデート運用

```bash
claude plugin marketplace update voicemode   # マーケットプレイス定義を更新
claude plugin update voicemode@voicemode     # プラグイン本体を更新
uv tool upgrade voice-mode                   # グローバルCLI(MCPが実際にspawnする方)を更新
```

- **プラグインとCLIは必ずセットで更新**(バージョンずれ防止。MCP=グローバルCLI、
  フック=プラグインキャッシュ側が動くため)。
- whisper.cpp/Kokoro本体の更新: `voicemode service install whisper --force`(再ビルド)。
  → 上記の127.0.0.1修正が消えるので再適用を忘れずに。
- Whisperモデル・Kokoroモデルは更新不要(ファイル固定)。
- 更新後の動作確認: `voicemode status` と、このdocの検証結果セクションのcurlループバック。

## 補完レイヤー・代替手段 (リサーチ結果より)

- **公式 `/voice`** (Claude Code本体, 2026-03頃から段階ロールアウト): スペースキー長押しの
  プッシュトゥトーク**入力専用**(読み上げなし)。無料・設定不要のフォールバック。
  日本語品質は未検証とされる。VoiceModeの方が機能は上(双方向ループ)。
- **claude-voice Webアプリ** (このリポジトリ, `npm run dev` → http://localhost:5183):
  ブラウザからの音声会話+発話途中割り込み。要件整理・壁打ち用途に引き続き有効。
- **VOICEVOX**: より自然な日本語TTSが欲しくなったら。無料ローカル、REST API
  (localhost:50021, audio_query→synthesis)。ずんだもん等キャラボイス多数。
  ※Kokoroの日本語が「壊れている」という報告がWeb上にあるが、本環境の実測ループバック
  (Kokoro音声→Whisperで一字一句一致)で**動作することを確認済み**。VOICEVOXは品質向上の
  選択肢であって必須ではない。
- **macOS `say -v Kyoko`**: 最後の砦のTTSフォールバック。

## 運用のコツ (先行プロジェクトの知見)

- **エコー対策**: スピーカー再生中のTTS音声がマイクに回り込み誤検出する事例が多い。
  ヘッドホン/イヤホン推奨(VoiceModeは無音検出ベースなので特に)。
- **ウェイクワード**(「Hey JARVIS」)はVoiceMode未対応。常駐セッションで`converse`ループを
  維持する運用でカバー。将来足すなら openWakeWord(個人利用無料)や Porcupine(個人枠無料)、
  または実績多数の「VADプッシュトゥトーク」方式が有力。
- **長時間タスクの音声UX**: プラグインのStop/Notificationフックが効果音で完了・許可要求を
  通知する。読み上げ要約まで欲しければ nickpending/clarvis(Stopフック+LLM要約読み上げ)の
  パターンが参考になる。
- **作業中の割り込み対話**: johnmatthewtennant/mcp-voice-hooks は「Claudeが作業中でも
  話しかけて指示追加できる」パターンの参考実装。

## 検証結果 (2026-07-26, マイク以外は実測)

ループバックE2Eテスト(マイク不要で音声往復を検証):

1. **STT疎通**: `say -v Kyoko`で生成した「明日の朝九時に会議の予定を入れてください」を
   whisperサーバー(port 2022)に投げて認識成功。baseモデルでは「朝九時→朝食事」の
   誤認識があったため large-v3-turbo に切り替え → **「明日の朝9時に会議の予定を
   入れてください。」と完全一致、処理1.8秒**(M2, Metal)。
   ※voicemode組込みダウンローダは1.47GBで停止したため、HuggingFaceから
   `curl -C -` で直接レジュームして完了(正規サイズ1,624,555,275バイト一致)。
2. **TTS**: Kokoro(port 8880)に日本語テキストをPOST → 24kHz WAV生成成功(voice=jf_alpha)。
3. **完全ループバック**: KokoroのTTS出力をWhisperに再入力 →
   「こんにちはジャービスです 音声システムのテストをしています」と**一字一句正確に**認識。
4. **voicemodeパイプライン実測**: `voicemode converse --skip-stt -m "..."` で
   日本語発話成功。TTFA(初回音声まで)3.0秒、Kokoro jf_alpha 使用を確認。
5. **MCP接続**: `claude mcp list` → `plugin:voicemode:voicemode ✔ Connected`。

未検証(物理的にマイク入力が必要): 実際に人が話しての`converse`往復。
→ 新しいClaude Codeセッションで `/voicemode:converse` を実行して試す。
