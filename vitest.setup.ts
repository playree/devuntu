// テスト実行時に src/lib/auth.ts をインポートしても環境変数不足で失敗しないよう、
// スキーマ検証に無関係なダミー値を先に設定する。
// (auth.options を読むだけで実際のDB接続やネットワークは発生しない)
process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/test'
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET ??= 'test-secret-for-schema-check-only'
