/**
 * 運用ツール(tools.mjs から呼ぶバックアップ/リストア/メンテナンス)の表示メッセージ。
 * setup-env のものは `setup-env/messages.mjs` に置く。
 */
import { createT } from './i18n.mjs'

const ja = {
  // tools.mjs
  tools_usage: `使い方: node scripts/tools.mjs <サブコマンド> [引数...]

  setup-env     設定ファイル(.env.docker / .env.db / seaweedfs-s3.json)を対話生成する
  db-backup     データベースの中身を backup/ へバックアップする
  db-restore    ダンプファイルの内容をデータベースへ復元する
  s3-backup     オブジェクトストレージの中身を backup/ へバックアップする
  s3-restore    バックアップディレクトリの内容をオブジェクトストレージへ復元する
  full-backup   DB と S3 を backup/full_<stamp>/ へまとめてバックアップする
                (--maintenance で取得の間だけメンテナンスモードにする。
                 開始前から ON の場合は取得後も ON のまま)
  full-restore  full-backup の出力から DB と S3 をまとめて復元する
  maintenance   メンテナンスモードを切り替える(on / off / status)
  help          この使い方を表示する

サブコマンドより後ろの引数はそのまま渡される(例: setup-env --dry-run)。
`,
  tools_unknown_command: (command) => `不明なサブコマンドです: ${command}`,

  // run-script.mjs / db-connect.mjs
  spawn_failed: (name, message) => `${name} を起動できませんでした: ${message}`,
  db_url_missing: 'DATABASE_URL が設定されていません',
  db_url_invalid: 'DATABASE_URL を接続URLとして解釈できません',
  db_url_incomplete: 'DATABASE_URL にホスト・ユーザー・DB名のいずれかが含まれていません',
  db_transport_local: 'ローカルの postgres クライアントを使用します',
  db_transport_docker: 'docker compose exec -T db を使用します',
  db_not_bundled: (host) =>
    `DATABASE_URL の接続先 (${host}) は同梱の db サービスではないため、docker compose exec では扱えません。` +
    '実行するホストに postgresql-client を入れてください',
  pg_exec_failed: (bin, message) => `${bin} を実行できませんでした: ${message}`,
  pg_not_found: (bin) =>
    `${bin} が見つからず、docker も使えませんでした。postgresql-client を入れるか、compose.yaml のあるディレクトリで実行してください`,
  pg_failed: (bin, status) => `${bin} が失敗しました (exit ${status})`,
  db_wait_release: (db, sec) => `${db} の接続が解放されるまで待ちます(最大 ${sec} 秒)...`,

  // backup-db.mjs / backup-s3.mjs
  out_file_required: '--out には出力先のファイルパスを指定してください',
  out_dir_required: '--out には出力先のディレクトリパスを指定してください',
  backup_created: (file) => `バックアップを作成しました: ${file}`,
  s3_endpoint_missing: 'S3_ENDPOINT が設定されていません',
  s3_skip_unsafe_key: (key) => `スキップ(安全でないキー): ${key}`,
  s3_backup_created: (dir, objects, bytes, skipped) =>
    `バックアップを作成しました: ${dir} (${objects} 件, ${bytes} バイト, スキップ ${skipped} 件)`,

  // restore-db.mjs
  restore_db_usage: `使い方: node ./scripts/restore-db.mjs <ダンプファイル> [--force] [--wait <秒>]
例: node ./scripts/restore-db.mjs backup/devuntu_20260719_120000.dump`,
  db_connections_remaining: (db, count) =>
    `${db} に他の接続が ${count} 件残っています。\n` +
    '先に `pnpm maintenance on` で遮断するか、`docker compose stop devuntu` で止めてから\n' +
    '実行してください(--force で無視できます)。',
  wait_required: '--wait には待つ秒数を指定してください',
  file_not_found: (file) => `ファイルが見つかりません: ${file}`,
  restoring_db: (file, db) => `${file} を ${db} へ復元します(データベースは作り直されます)...`,
  restore_completed: '復元が完了しました。',

  // restore-s3.mjs
  restore_s3_usage: `使い方: node ./scripts/restore-s3.mjs <バックアップディレクトリ> [--check]
例: node ./scripts/restore-s3.mjs backup/s3_20260807_120000`,
  s3_bucket_created: (bucket) => `バケットを作成しました: ${bucket}`,
  s3_issue_no_key: (json) => `key を持たない要素があります: ${json}`,
  s3_issue_missing_object: (key) => `objects/${key} がありません`,
  s3_issue_no_content_type: (key) => `${key} の Content-Type を決められません`,
  s3_invalid_backup_issues: (count, dir) => `不正なバックアップです(${count} 件): ${dir}`,
  s3_backup_valid: (dir, objects) => `バックアップの内容は正常です: ${dir} (${objects} 件)`,
  s3_invalid_manifest: (file) => `不正なバックアップです(manifest.json が無いか壊れています): ${file}`,
  s3_restoring: (objects, dir, bucket) => `${dir} の ${objects} 件を ${bucket} へ復元します...`,
  s3_skip_unknown_type: (key) => `スキップ(Content-Type 不明): ${key}`,
  s3_object_failed: (key, message) => `失敗: ${key} (${message})`,
  s3_restore_done: (restored, failed) => `完了しました。復元 ${restored} 件 / 失敗 ${failed} 件`,

  // restore-all.mjs / backup-all.mjs
  restore_all_usage: `使い方: node ./scripts/restore-all.mjs <バックアップディレクトリ> [--force] [--file <メンテナンスフラグ>]
例: node ./scripts/restore-all.mjs backup/full_20260921_120000`,
  dir_not_found: (dir) => `ディレクトリが見つかりません: ${dir}`,
  invalid_backup_dumps: (count, dir) => `不正なバックアップです(直下の *.dump が ${count} 件): ${dir}`,
  invalid_backup_no_manifest: (dir) => `不正なバックアップです(s3/manifest.json がありません): ${dir}`,
  s3_check_failed: 'S3 バックアップの検証に失敗したため中断しました(DB には触れていません)',
  maintenance_on_failed: (code) => `メンテナンスモードにできなかったため中断しました (exit ${code})`,
  step_failed: (script, code) => `${script} が失敗したため中断しました (exit ${code})`,
  maintenance_still_on_retry: 'メンテナンスモードは ON のままです。原因を直してからやり直してください。',
  maintenance_still_on_done: `メンテナンスモードは ON のままです。表示を確認してから解除してください:
  pnpm maintenance off
  docker compose run --rm tools maintenance off`,
  full_backup_created: (name) => `バックアップを作成しました: backup/${name}\n復元は: pnpm full:restore backup/${name}`,
  backup_connections_remaining: (db, count) => `${db} に他の接続が ${count} 件残っているため中断しました`,
  maintenance_already_on: 'メンテナンスモードは既に ON です。取得後も ON のままにします',
  maintenance_off_failed: (code) =>
    `メンテナンスモードを解除できませんでした (exit ${code})。手で解除してください:\n` +
    '  docker compose run --rm tools maintenance off',

  // maintenance.mjs / maintenance-flag.mjs
  maintenance_usage: `使い方: node ./scripts/maintenance.mjs <on|off|status> [--file <パス>]
例: node ./scripts/maintenance.mjs on`,
  maintenance_state: (state, file) => `メンテナンスモード: ${state} (${file})`,
  file_required: '--file にはフラグファイルのパスを指定してください',
}

/** @type {typeof ja} */
const en = {
  tools_usage: `Usage: node scripts/tools.mjs <subcommand> [args...]

  setup-env     Interactively generate the config files (.env.docker / .env.db / seaweedfs-s3.json)
  db-backup     Back up the database into backup/
  db-restore    Restore a dump file into the database
  s3-backup     Back up the object storage into backup/
  s3-restore    Restore a backup directory into the object storage
  full-backup   Back up both the DB and S3 into backup/full_<stamp>/
                (--maintenance turns maintenance mode on only while backing up.
                 If it was already on, it stays on afterwards)
  full-restore  Restore both the DB and S3 from a full-backup output
  maintenance   Switch maintenance mode (on / off / status)
  help          Show this usage

Arguments after the subcommand are passed through as is (e.g. setup-env --dry-run).
`,
  tools_unknown_command: (command) => `Unknown subcommand: ${command}`,

  spawn_failed: (name, message) => `Could not start ${name}: ${message}`,
  db_url_missing: 'DATABASE_URL is not set',
  db_url_invalid: 'DATABASE_URL cannot be parsed as a connection URL',
  db_url_incomplete: 'DATABASE_URL is missing the host, user or database name',
  db_transport_local: 'using local postgres client',
  db_transport_docker: 'using docker compose exec -T db',
  db_not_bundled: (host) =>
    `The DATABASE_URL host (${host}) is not the bundled db service, so it cannot be handled via docker compose exec. ` +
    'Install postgresql-client on the host running this script',
  pg_exec_failed: (bin, message) => `Could not run ${bin}: ${message}`,
  pg_not_found: (bin) =>
    `${bin} was not found and docker is not available either. Install postgresql-client, or run this in the directory containing compose.yaml`,
  pg_failed: (bin, status) => `${bin} failed (exit ${status})`,
  db_wait_release: (db, sec) => `Waiting for connections to ${db} to be released (up to ${sec} seconds)...`,

  out_file_required: '--out requires an output file path',
  out_dir_required: '--out requires an output directory path',
  backup_created: (file) => `Backup created: ${file}`,
  s3_endpoint_missing: 'S3_ENDPOINT is not set',
  s3_skip_unsafe_key: (key) => `skip (unsafe key): ${key}`,
  s3_backup_created: (dir, objects, bytes, skipped) =>
    `Backup created: ${dir} (${objects} objects, ${bytes} bytes, skipped=${skipped})`,

  restore_db_usage: `Usage: node ./scripts/restore-db.mjs <dump-file> [--force] [--wait <seconds>]
Example: node ./scripts/restore-db.mjs backup/devuntu_20260719_120000.dump`,
  db_connections_remaining: (db, count) =>
    `${count} other connection(s) to ${db} remain.\n` +
    'Block access first with `pnpm maintenance on`, or stop the app with `docker compose stop devuntu`,\n' +
    'then run this again (--force ignores this check).',
  wait_required: '--wait requires the number of seconds to wait',
  file_not_found: (file) => `File not found: ${file}`,
  restoring_db: (file, db) => `Restoring ${file} into ${db} (database will be recreated)...`,
  restore_completed: 'Restore completed.',

  restore_s3_usage: `Usage: node ./scripts/restore-s3.mjs <backup-dir> [--check]
Example: node ./scripts/restore-s3.mjs backup/s3_20260807_120000`,
  s3_bucket_created: (bucket) => `bucket created: ${bucket}`,
  s3_issue_no_key: (json) => `an entry has no key: ${json}`,
  s3_issue_missing_object: (key) => `objects/${key} is missing`,
  s3_issue_no_content_type: (key) => `cannot determine the Content-Type of ${key}`,
  s3_invalid_backup_issues: (count, dir) => `Invalid backup (${count} issue(s)): ${dir}`,
  s3_backup_valid: (dir, objects) => `Backup looks valid: ${dir} (${objects} objects)`,
  s3_invalid_manifest: (file) => `Invalid backup (manifest.json not found or broken): ${file}`,
  s3_restoring: (objects, dir, bucket) => `Restoring ${objects} objects from ${dir} into ${bucket}...`,
  s3_skip_unknown_type: (key) => `skip (unknown content type): ${key}`,
  s3_object_failed: (key, message) => `failed: ${key} (${message})`,
  s3_restore_done: (restored, failed) => `done. restored=${restored} failed=${failed}`,

  restore_all_usage: `Usage: node ./scripts/restore-all.mjs <backup-dir> [--force] [--file <maintenance-flag>]
Example: node ./scripts/restore-all.mjs backup/full_20260921_120000`,
  dir_not_found: (dir) => `Directory not found: ${dir}`,
  invalid_backup_dumps: (count, dir) => `Invalid backup (expected one *.dump at the top level, found ${count}): ${dir}`,
  invalid_backup_no_manifest: (dir) => `Invalid backup (s3/manifest.json is missing): ${dir}`,
  s3_check_failed: 'Aborted because the S3 backup failed verification (the DB was not touched)',
  maintenance_on_failed: (code) => `Aborted because maintenance mode could not be turned on (exit ${code})`,
  step_failed: (script, code) => `Aborted because ${script} failed (exit ${code})`,
  maintenance_still_on_retry: 'Maintenance mode is still on. Fix the cause and try again.',
  maintenance_still_on_done: `Maintenance mode is still on. Check the app, then turn it off:
  pnpm maintenance off
  docker compose run --rm tools maintenance off`,
  full_backup_created: (name) => `Backup created: backup/${name}\nTo restore: pnpm full:restore backup/${name}`,
  backup_connections_remaining: (db, count) => `Aborted because ${count} other connection(s) to ${db} remain`,
  maintenance_already_on: 'Maintenance mode is already on. It will stay on after the backup',
  maintenance_off_failed: (code) =>
    `Could not turn maintenance mode off (exit ${code}). Turn it off manually:\n` +
    '  docker compose run --rm tools maintenance off',

  maintenance_usage: `Usage: node ./scripts/maintenance.mjs <on|off|status> [--file <path>]
Example: node ./scripts/maintenance.mjs on`,
  maintenance_state: (state, file) => `maintenance mode: ${state} (${file})`,
  file_required: '--file requires the path of the flag file',
}

export const messages = { ja, en }

export const t = createT(messages)
