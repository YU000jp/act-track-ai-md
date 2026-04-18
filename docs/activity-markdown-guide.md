# ActTrack AI MD 日次ログ & Markdown 出力ガイド

このドキュメントは、ActTrack AI MD を使って **PC 利用履歴を日次で記録し、AI 振り返りやアプリ利用統計を含む Markdown に出力する**ための技術ガイドです。  
実装済み機能と、Markdown 自動出力を組み込むための拡張ポイントをまとめています。

---

## 1. 機能概要

ActTrack AI MD のコア機能は以下です。

1. アクティブウィンドウを定期取得（`tracker.ts`）
2. Gemini で活動カテゴリを分類（`gemini.ts` + `classifier.ts`）
3. SQLite に履歴を保存（`db.ts`）
4. 日次統計と AI サマリーを生成（`summarizer.ts`）
5. ダッシュボード表示と設定変更（`rpc.ts` + `src/views/dashboard`）

Markdown 日報出力は、上記データを整形する `md-exporter` 相当のモジュールを追加することで実現できます。

---

## 2. 収集ログの種類と保存タイミング

### 2.1 収集対象

`activity_log` には以下を保存します。

- `timestamp`: サンプル取得時刻（ms）
- `process_name`: 実行プロセス名（例: `code.exe`）
- `window_title`: ウィンドウタイトル（最大 200 文字）
- `category`: `productive / distraction / neutral / unknown`
- `label`: 分類ラベル
- `duration_ms`: 次サンプル確定時に更新される滞在時間

### 2.2 収集タイミング

- 既定のポーリング間隔: `3000ms`（`pollIntervalMs`）
- アイドル判定: `idleTimeoutMs` 以上入力がない場合は記録スキップ
- 前回サンプルとウィンドウが変わった時点で、前回行の `duration_ms` を確定

### 2.3 日次集計

- `getStatsForDay(date)` でカテゴリ別合計を取得
- `getTopAppsForDay(date, limit)` でアプリ利用上位を取得
- `daily_summary` に統計 + AI 要約を保存

---

## 3. Markdown 出力仕様（提案）

### 3.1 出力先・命名

- 出力先例: `logs/daily/`
- ファイル名: `YYYY-MM-DD.md`

### 3.2 セクション構成

1. タイトル（日付）
2. AI 振り返り
3. 統計サマリー（総時間、カテゴリ比率、上位アプリ）
4. 詳細テーブル（時刻、アプリ、タイトル、滞在時間、カテゴリ）

### 3.3 サンプル

```markdown
# Activity Log - 2026-04-18

## AI Summary
本日は午前中に開発作業へ集中できました。午後はコミュニケーション時間がやや多めでした。明日は通知系アプリの確認時間をまとめると、より集中しやすくなります。

## Stats
- Total tracked: 8h 45m
- Productive: 5h 10m (59%)
- Distraction: 1h 20m (15%)
- Neutral: 2h 15m (26%)

### Top Apps
1. code.exe - 4h 35m (productive)
2. chrome.exe - 2h 05m (productive)
3. slack.exe - 1h 10m (neutral)

## Timeline
| Time | App | Window Title | Duration | Category |
| --- | --- | --- | --- | --- |
| 09:00 | code.exe | act-track-ai-md - VS Code | 1h 25m | productive |
| 10:30 | chrome.exe | Pull Request - GitHub | 35m | productive |
| 11:10 | slack.exe | #dev-general | 20m | neutral |
```

---

## 4. Gemini AI 要約の活用方法

### 4.1 必須設定

- `.env` に `GEMINI_API_KEY` を設定
- またはダッシュボード設定 `geminiApiKey` に保存

### 4.2 要約生成フロー

1. 日付ごとの集計値を取得
2. 上位アプリとカテゴリ情報をプロンプト化
3. Gemini (`gemini-2.0-flash`) を呼び出し
4. `daily_summary.ai_summary` に保存

### 4.3 運用上の注意

- API エラー時は要約を `null` として保存（処理継続）
- 要約本文の言語・トーンは `summarizer.ts` のプロンプトで調整可能

---

## 5. 設定方法とカスタマイズ例

主要設定キー（`settings` テーブル）:

- `geminiApiKey`
- `pollIntervalMs`
- `idleTimeoutMs`
- `notificationCooldownMs`
- `gracePeriodMs`
- `notificationsEnabled`

### 例1: 記録粒度を上げる

- `pollIntervalMs`: `3000` → `1000`
- メリット: タイムライン精度向上
- 注意点: サンプル数増加により DB サイズ増

### 例2: アイドル判定を長くする

- `idleTimeoutMs`: `300000` → `600000`
- メリット: 短時間離席で記録が途切れにくい

### 例3: Markdown 出力先を切り替える（拡張時）

- エクスポータに `outputDir` を設定可能にし、`~/Documents/act-track-logs` などへ保存

---

## 6. インストール手順と依存ソフト

1. リポジトリ取得
2. `bun install`
3. `cp .env.example .env`（API キー設定）
4. `bun --hot src/bun/index.ts` で起動

依存ソフト:

- Bun
- Electrobun
- Windows 10/11
- WebView2 Runtime

---

## 7. データ取り扱い・セキュリティ注意点

1. **ウィンドウタイトルの機密性**  
   メール件名、社内システム情報などが含まれる場合があります。
2. **API キー管理**  
   `.env` は git 管理外で運用し、公開リポジトリへ含めないでください。
3. **外部送信の最小化**  
   AI 利用時は必要最小限の情報のみ送る設計を維持してください。
4. **ローカルデータ保護**  
   `data/*.db` の OS 権限やバックアップ方針を明確化してください。

---

## 8. 拡張 API / 今後の展望

### 8.1 拡張 API の候補

- `exportDailyMarkdown(date: string): Promise<string>`
- `exportRangeMarkdown(from: string, to: string): Promise<string[]>`
- `setExportSettings({ outputDir, includeTimeline, includeAISummary })`

### 8.2 実装ステップ例

1. `src/bun/md-exporter.ts` を追加
2. `db.ts` の `getActivityRange` / 日次集計 API を利用
3. `rpc.ts` に `exportTodayMarkdown` を追加
4. 日付切り替わりタイミングで自動エクスポート

### 8.3 将来展望

- 週次・月次レポート生成
- カテゴリルールのユーザー定義
- Markdown 以外（JSON/CSV）への同時出力
- チーム向け匿名化レポート
