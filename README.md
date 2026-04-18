# ActTrack AI MD

ActTrack AI MD は、PC のアクティブウィンドウ履歴を収集し、Gemini による分類・日次サマリーを使って振り返りを支援する Windows 向けデスクトップアプリです。  
このリポジトリには、**日次ログを Markdown 化するための設計・運用ガイド**も含まれています。

## プロジェクト概要

- アクティブなアプリ/ウィンドウを一定間隔で収集
- `productive / distraction / neutral` に自動分類（キャッシュ優先）
- SQLite にローカル保存してダッシュボードで可視化
- 注意散漫状態の通知（猶予時間・クールダウン付き）
- 日次の AI サマリーを生成して保存
- 日次 Markdown エクスポート（既定: `~/act-track-logs/YYYY-MM-DD.md`）
- 日次 Markdown 出力の仕様と実装ガイドを `docs/` で提供

## 特徴とユースケース

### 主な特徴
- **Window Tracking**: user32.dll FFI で前面ウィンドウを追跡
- **AI Classification**: Gemini で活動カテゴリ判定
- **Cache-First**: 同一ウィンドウ分類の再利用で高速化
- **Daily AI Summary**: 日次統計から短い振り返りを生成
- **Dashboard**: Today/Statistics/Settings を WebView で表示

### ユースケース
- 毎日の作業時間・集中時間帯のセルフレビュー
- アプリ利用比率を使った業務改善
- 日報/週報用の Markdown ログ生成基盤

## 基本の使い方

1. 依存関係をインストール
   ```bash
   bun install
   ```
2. 環境変数を設定
   ```bash
   cp .env.example .env
   ```
   `.env` の `GEMINI_API_KEY` を設定します。
3. 開発モードで起動
   ```bash
   bun --hot src/bun/index.ts
   ```

### 主要コマンド

```bash
# テスト
bun test

# 型チェック
bunx tsc --noEmit

# ビルド（Windows x64）
bunx electrobun build --targets=win-x64 --env=dev
```

## 開発/動作要件

### Runtime
- Windows 10/11 (x64)
- Microsoft Edge WebView2 Runtime

### Development
- Bun 1.x
- TypeScript 5.x
- Gemini API Key（任意。ただし AI 分類/要約には必須）

## フォルダ/主要ファイル構成

```text
src/
├── bun/
│   ├── index.ts        # メインループと依存注入
│   ├── tracker.ts      # Windows FFI によるウィンドウ取得
│   ├── classifier.ts   # キャッシュ優先の分類ロジック
│   ├── gemini.ts       # Gemini API クライアント
│   ├── db.ts           # SQLite スキーマ/クエリ
│   ├── summarizer.ts   # 日次 AI サマリー生成
│   └── rpc.ts          # ダッシュボード RPC
├── views/dashboard/    # ダッシュボード UI
└── shared/types.ts     # 共有型

docs/
├── activity-markdown-guide.md
└── plans/
```

## ドキュメント

- 日次ログ収集〜Markdown 出力の設計/運用ガイド:  
  [`docs/activity-markdown-guide.md`](./docs/activity-markdown-guide.md)
- 暫定アプリ名ポリシー:  
  [`docs/app-name-policy.md`](./docs/app-name-policy.md)
- 既存の設計・実装計画: `docs/plans/`

## データ取り扱いとセキュリティ

- ログはローカル SQLite に保存されます（`data/`）
- ウィンドウタイトルには機密情報が含まれる可能性があります
- Gemini 利用時は送信データ範囲を確認し、API キーは `.env` で管理してください

## Tech Stack

- **Electrobun** - Desktop framework (Bun + Zig + WebView)
- **Bun** - Runtime with FFI, SQLite, and fast startup
- **Google Gemini 2.0 Flash** - AI classification and summarization
- **SQLite** - Local data storage (WAL mode)

## Markdown Export

- 日次切り替え時に Markdown エクスポートを実行
- 出力には AI サマリー / 分類タグ / タイムラインを含む
- SQLite 生データ（`activity_log`, `daily_summary`）と Markdown 出力を分離

## ライセンス

現時点でリポジトリ内にライセンスファイルは含まれていません。必要に応じて `LICENSE` を追加してください。

## 問い合わせ

- 質問・不具合報告: GitHub Issues  
  https://github.com/YU000jp/act-track-ai-md/issues
