---
type: design_doc
title: リモート実行の仕組み(開発者向け)
updated: 2026-10-27
---

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

## 中断

- 中断要求は DB の `cancelRequestedAt` に立て、実行を掴んでいるプロセスの dispatch が tick ごとに `listCancelRequestedRuns` で拾う(別プロセスの子プロセスは kill できないため)
- 中断・タイムアウトはまず ssh の stdin を閉じる。実行ゲートがあれば EOF でリモートのプロセスグループごと落ち、ssh も自然に終わる
- `COMMAND_ABORT_GRACE_MS` 内に ssh が終わらなければ SIGTERM、さらに `COMMAND_KILL_GRACE_MS` 後に SIGKILL で落とす。この場合はリモートが止まったか分からないので、`command_sys_remote_unconfirmed` を履歴に残す。`activeKey` は解放する(停止を確かめる手段が無く、保持すると誰も解除できない)
- `-tt` で pty を割り当てて SIGHUP で落とす方法は採らない。stdout と stderr が混ざるうえ、実行ゲートの `no-pty` と合わず、pager などの対話動作で固まりうる

## 実行の記録

- アプリが差し込む行(`stream` が `system`)はロケールキーのまま保存し、表示時に閲覧者の言語で解決する
