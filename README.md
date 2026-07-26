# claude-voice

音声入力でローカルの **Claude Code CLI** を操る管制塔Webアプリ。
話すだけでプロジェクトの選択・実装タスクの実行・進捗確認まで進められ、
発話の**途中**でも「それって何？」のような短い確認質問をClaudeが割り込みで返します。

## 声でできること

- 「hojokin-naviに切り替えて」→ アクティブプロジェクトが切り替わる
- 「テストを回して失敗があれば直して」→ ツール有効のClaude Codeがそのプロジェクトで実行(タスクパネルに進捗)
- 「さっきのタスクどうなった？」→ 会話Claudeがタスク状態から回答。完了時は自動で音声報告
- 「新しいアプリを作って」→ `~/projects` 直下にスキャフォールドするタスクを起動

仕組み: 会話用Claude(ツールなし・高速)が状況(プロジェクト一覧/タスク状態)を毎ターン受け取り、
実作業の依頼には `@@CV {"action":"start_task",...}` という制御行を返す。サーバーがそれを解釈して
ツール有効(`--permission-mode acceptEdits`)のClaude Codeをプロジェクトのcwdでバックグラウンド起動する。

## 使い方

```bash
npm install
npm run dev        # server(8799) + Vite(5183) を同時起動
```

ブラウザ(Chrome推奨)で http://localhost:5183 を開き、マイクボタンを押して話す。

- 話し終えて2秒沈黙すると自動送信(「送信」ボタンで即送信も可)
- 応答はストリーミング表示され、音声でも読み上げ(ヘッダーでオフ可)
- 発話中に「例の〜」「あの件」「いい感じに」等の曖昧語や未知の略語を検出すると、
  途中で確認質問が割り込む(琥珀色のバブル+音声)

### モード

| モード | 起動 | 説明 |
|---|---|---|
| CLI(既定) | `npm run dev` | ローカルの `claude` CLIをspawnし、`--resume`で会話継続 |
| モック | `CLAUDE_VOICE_MOCK=1 npm run dev:server` | CLIなしで決定的応答(デモ/テスト用) |

環境変数: `PORT`(既定8799)、`CLAUDE_VOICE_BIN`(claudeバイナリのパス上書き)、`CLAUDE_VOICE_MOCK=1`、
`CLAUDE_VOICE_PROJECTS_ROOT`(既定 `~/projects`)、`CLAUDE_VOICE_PERMISSION_MODE`(タスクの権限、既定 `acceptEdits`)

### 本番ビルド

```bash
npm run build      # 型チェック + dist/ 生成
npm run start      # 8799でAPI+静的配信(http://localhost:8799)
```

## 仕組み

- **STT**: ブラウザのWeb Speech API(interim resultsで発話途中のテキストを取得)
- **チャット**: `POST /api/chat` → SSE。サーバーが `claude -p --output-format stream-json
  --include-partial-messages` をspawnしてトークン単位で中継。セッションは `--resume` で継続
- **割り込み**: interim transcriptをデバウンス送信 → `POST /api/interject`。
  ヒューリスティック(曖昧参照/略語/曖昧指定の検出)が割り込みの要否を決め、
  Claude(haiku, 3秒タイムアウト)が質問文を洗練。失敗時はヒューリスティック質問にフォールバック
- **TTS**: SpeechSynthesis API(割り込み時は現在の読み上げをキャンセルして即発話)

## テスト

```bash
npm test           # Vitest: server(node) 31件 + client(jsdom) 9件
```

CLIはモック注入でテストするため、実行にclaude CLIは不要。

設計の詳細は `docs/superpowers/specs/2026-07-05-claude-voice-design.md` を参照。
