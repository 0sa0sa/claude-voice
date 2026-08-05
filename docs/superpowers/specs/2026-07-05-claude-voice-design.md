# claude-voice 設計ドキュメント (2026-07-05)

> ゴールモード自律実行のため、設計判断はClaudeが行い本ドキュメントに記録する。

## 目的

音声入力でローカルのClaude Code CLIと爆速で会話し、要件を詰められるWebアプリ。
発話の**途中**でも「それって何？」のような短い割り込み質問をClaudeが返す。

## 成功基準

- マイクで話す → リアルタイムに文字起こしが見える → 発話確定でClaudeがストリーミング応答 → 音声で読み上げ
- 発話途中に曖昧語(「あれ」「例のやつ」等)や未知語があると、短い割り込み質問が出る(音声+バブル表示)
- ローカルの `claude` CLI (Claude Code) をバックエンドに使う。CLI不在でもモックモードで動作
- `npm test` が全て通る。`npm run build` が通る

## アーキテクチャ

```
[Browser]
  Web Speech API (STT, interim results)
  SpeechSynthesis (TTS)
  React UI (Vite)
    ├─ POST /api/chat        → SSE: Claude応答トークンストリーム
    ├─ POST /api/interject   → JSON: {interject, text} 割り込み判定
    └─ GET  /api/health      → {ok, mode}
[Node server (Hono, port 8790)]
  claudeRunner: spawn `claude -p --output-format stream-json --include-partial-messages --verbose`
    セッション継続: 初回応答の session_id を保持し --resume
  interjection: ヒューリスティック層(同期・即答) + Claude層(haiku, 3秒タイムアウト, 失敗時ヒューリスティックにフォールバック)
  MOCKモード: CLAUDE_VOICE_MOCK=1 でCLIを呼ばず決定的応答(テスト/デモ用)
```

## コンポーネント

### server/
- `streamJson.ts` — claude CLIのstream-json(NDJSON)行パーサ。`system:init`(session_id)、`stream_event`(text_delta)、`result` を抽出。純関数でテスト容易
- `claudeRunner.ts` — CLI spawnラッパ。`runClaude({prompt, sessionId, model, timeoutMs, onDelta})`。abort/タイムアウト対応。モック実装と同一インターフェース
- `interjection.ts` — `analyzeTranscript(text)`: 曖昧参照(それ/あれ/例の…)、カタカナ・英字ジャーゴン、数量曖昧(いい感じ/適当に)等を検出し、候補質問を返す純関数。`decideInterjection()` がヒューリスティック+Claude層を統合
- `sessions.ts` — ブラウザセッションID → claudeセッションIDのインメモリMap
- `app.ts` — Honoルート定義(注入されたrunnerを使う=テストでモック注入)
- `index.ts` — 起動エントリ

### src/ (client)
- `lib/transcript.ts` — 認識結果(interim/final)の状態リデューサ。純関数でテスト
- `hooks/useSpeechRecognition.ts` — webkitSpeechRecognitionラッパ(continuous, interimResults)
- `hooks/useTTS.ts` — SpeechSynthesisラッパ(ja-JP優先、割り込み時はcancelして即時発話)
- `hooks/useChat.ts` — SSE読み取り、メッセージ状態管理
- `App.tsx` ほかUI — マイクボタン、ライブ文字起こし、チャット、割り込みバブル

## 割り込みフロー

1. interim transcriptが変化するたびクライアントでデバウンス(800ms)
2. 12文字以上変化があれば `POST /api/interject` (直近の確定文脈も添付)
3. サーバー: ヒューリスティックで曖昧トリガー検出 → あればClaude(haiku)へ「短い確認質問を1つだけ、不要ならNONE」を3秒タイムアウトで依頼 → 失敗/タイムアウト時はヒューリスティック質問を返す
4. クライアント: バブル表示 + TTSで即読み上げ(認識は継続)
5. 同一トリガーへの重複割り込みは抑止(クールダウン5秒 + 同文言抑止)

## エラー処理

- CLI不在/spawn失敗 → 500 + ユーザー向けメッセージ、ヘルスチェックで mode: "mock"|"cli" を明示
- SSE切断/タイムアウト(120s) → プロセスkill
- Web Speech非対応ブラウザ → UI上に案内(Chrome推奨)

## テスト戦略 (Vitest)

- node環境: streamJson(パーサ)、interjection(ヒューリスティック)、sessions、app(ルート統合・runnerモック注入、SSE検証)
- jsdom環境: transcript リデューサ、Appスモーク(SpeechRecognitionモック)
- CLIは実プロセスを呼ばずモック。実CLI疎通は手動確認項目

## 技術選定の理由

- Web Speech API: サーバーSTT(whisper等)よりセットアップゼロ・低遅延。制約(Chrome依存)はローカル用途で許容
- Hono: 軽量、既存プロジェクト(hojokin-navi)と同系でユーザーに馴染みがある
- ポート8790: 8787(bun)/8788(hojokin-navi)回避

---

# v2: 管制塔化 (2026-07-26)

## 目的
人間はclaude-voiceと話すだけで、プロジェクト選択・実装タスクの実行・進捗確認まで全てを進められる。

## 追加アーキテクチャ
- projects.ts: ~/projects をスキャン(git/package.json検出)。セッションごとの activeProject
- taskManager.ts: ツール有効の claude CLI をプロジェクトcwdでspawnするジョブ管理。
  状態(running/succeeded/failed/cancelled)、ツール使用ログ、結果テキスト、キャンセル。実行レーンは並列可
- directives.ts: 会話Claudeの応答から `@@CV {json}` 行を抽出・除去。
  actions: switch_project / start_task / cancel_task。project "_root" は ~/projects 直下(新規作成用)
- 会話レーン(既存chat)は毎ターン [状況] ヘッダ(アクティブプロジェクト/一覧/タスク状態)を注入。
  ツールなし・1ターンのまま高速維持。実行はすべてディレクティブ経由でタスクレーンへ
- API: GET /api/projects, POST /api/workspace, POST /api/tasks, GET /api/tasks(+/:id),
  POST /api/tasks/:id/cancel。chat SSEに directive イベント追加
- UI: ヘッダにプロジェクトセレクタ、タスクパネル(3秒ポーリング、完了遷移をTTSで報告)
- 権限: タスクは CLAUDE_VOICE_PERMISSION_MODE (既定 acceptEdits)。ローカル専用前提
