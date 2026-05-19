# AGENTS.md

## 基本方針

- 簡潔かつクリーンに対応する。
- 保守性、再利用性、一貫性、疎結合、複雑性の局所化を優先する。
- 役割の境界を曖昧にしない。共通処理は小さく切り出す。
- 命名は混乱しないものを選ぶ。
- 直感で分からない分岐や制約には、短いコメントを添える。

## 変更時の確認

### Tauri コマンド / RPC 変更時

新しい `#[tauri::command]` を追加・変更したら、次を必ず同期する。

1. `src-tauri/src/main.rs` の `invoke_handler(tauri::generate_handler![...])`
2. `src-tauri/permissions/app-commands.toml` の `commands.allow`
3. `src-tauri/gen/schemas/acl-manifests.json` などの生成物
4. フロントの `src/frontend/dashboard/tauri-bridge.ts`
5. エラーメッセージ辞書 `src/shared/app-error.ts`
6. 必要なら登録漏れ防止テスト `tests/shared/command-registration.test.ts`

### 実装時の注意

- コマンド追加時は、ACL とフロント RPC を同時に確認する。
- 権限や登録漏れの修正は、エラーを握りつぶさず原因を残す。
- `generate_handler` だけでなく、permission 定義と生成物の整合も見る。
- 変更後は関連テストを追加または更新する。

## Rust / backend

- `unwrap` / `expect` は不変条件のみに限定する。実行時に起こりうる失敗は `Result` で返す。
- ロック中に重い I/O や外部呼び出しをしない。先に値を取り出してから処理する。
- `#[tauri::command]` は薄く保ち、副作用は内部ヘルパーへ分離する。
- 所有権・可変性・スレッド境界は局所化し、`Arc<Mutex<_>>` は最後の手段にする。
- 失敗しうる境界では `?` を使い、エラー変換は早めに行う。
- `await` 相当の長い処理はロックや borrow を跨がない。
- 共有データの更新は読み取り・計算・書き込みを分け、テストで競合や順序を固定する。

## TypeScript / frontend

- 派生状態を二重管理しない。表示は signal / store から直接読む。
- 非同期処理は `try/catch` で囲み、失敗時の見せ方を先に決める。
- 競合しうる RPC は request id、timeout、abort のいずれかで制御する。
- フロントの RPC 名、型、ACL は同じ変更単位で更新する。
- controller は副作用、component は描画に寄せ、責務を分ける。
- `any` と過度な型アサーションは避け、境界は明示的な型で受ける。
- `useEffect` 系の副作用は依存関係を狭くし、クリーンアップを必ず持たせる。
- Promise の失敗を握りつぶさず、ログか UI に必ず残す。

## 既定の検証

- `pnpm typecheck`
- `pnpm test`
- `cargo test`
