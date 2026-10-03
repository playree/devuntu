# リモート実行の仕組み(開発者向け)

リモート実行の実装上の決めごと。定義ファイルの書き方・SSH の準備・権限など運用者向けの内容は
[command-exec.md](../admin/command-exec.md) を参照。

## 実行の流れ

- 実行 1 件が `command_run`(`queued` をワーカーが掴んで実行する)、出力が `command_run_chunk`。画面へは SSE(`/api/command/runs/[id]/stream`)で流す
- 出力は必ず DB を経由する。リクエストの寿命と実行の寿命を切り離し、長時間のジョブやアプリの再起動に耐えるため、実行は待ち行列にしている
- 実行中のまま残った記録は、生存申告が途切れてから一定時間後に `interrupted` で閉じる

## 送るコマンド

- 送るコマンドのクォートは `src/lib/command/command-args.ts` の `shellQuote`、引数に使える文字集合は `COMMAND_VALUE_PATTERN`
- ssh に `SendEnv` は付けていない

## 実行の記録

- アプリが差し込む行(`stream` が `system`)はロケールキーのまま保存し、表示時に閲覧者の言語で解決する
