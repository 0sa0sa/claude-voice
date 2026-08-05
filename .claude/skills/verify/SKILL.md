---
name: verify
description: claude-voiceの検証手順 — モック/CLI両モードのAPI駆動とGUI確認
---

# claude-voice の検証

## ビルドと起動

```bash
npm install && npm run build
# モックモード(決定的、claude CLI不要)。8787/8788/8791は他アプリが使用中なので避ける
CLAUDE_VOICE_MOCK=1 PORT=8797 npx tsx server/index.ts &
# CLIモード(実claudeを呼ぶ。1リクエストごとに実APIコストが発生する点に注意)
PORT=8798 npx tsx server/index.ts &
```

`npm run start` / ビルド済み `dist/` はサーバーcwd相対で静的配信される。

## 駆動する面

1. `GET /api/health` → `{"ok":true,"mode":"mock"|"cli"}`
2. チャットSSE: `curl -sN -X POST :PORT/api/chat -H 'content-type: application/json' -d '{"browserSessionId":"v1","message":"..."}'`
   → `event: session` → `delta`(複数) → `done` の順で来ること
3. セッション継続(CLIモード): 同じbrowserSessionIdで2通目を送り、1通目の内容を覚えているか聞く
4. 割り込み: `POST /api/interject` に `例のダッシュボードをいい感じにしたい` → `interject:true`。
   同一transcript再送 → `interject:false`(発話が伸びるまで抑止)。明確な発話 → `false`
5. GUI: Chrome DevTools MCPで `http://localhost:8797/` を開き、テキスト入力→送信→
   ユーザーバブルとストリーミング応答バブルを確認。コンソールエラーゼロを確認

## エラーパスのプローブ

- message欠落/空白のみ/JSON壊れ → 400 `{"error":"message is required"}`
- interjectのtranscript欠落 → 400
- GET /api/chat → 404

## 注意

- 音声認識(Web Speech API)はヘッドレスでは駆動できない。GUI検証はキーボード入力経路で行い、
  音声経路は transcript ライブラリ+hooks のユニットテストとマイク実機で担保
- jsdomには `scrollTo` がない(App.tsxでガード済み)。RTLのcleanupは `src/test-setup.ts` で明示

## v2 (管制塔) の検証面

1. `GET /api/projects?browserSessionId=x` → ~/projects のスキャン結果 + active
2. `POST /api/workspace` {project} → 切替。不明プロジェクト → 404
3. `POST /api/tasks` {instruction} → 実タスク起動(読み取り専用の安全な指示で: 「README.mdの1行目を読んで報告して。変更しないで」)。`GET /api/tasks/:id` をポーリングして succeeded + result を確認
4. オーケストレーター: chatで「◯◯プロジェクトで××するタスクを開始して」→ SSEに `directive` イベント(ok:true, taskId)が出て、doneテキストに @@CV が残らないこと
5. 状況照会: 「さっきのタスクどうなった？」→ [状況]コンテキストから実結果で回答すること
6. GUI: タスクパネル(ステータスドット+結果)、プロジェクトセレクタ表示
