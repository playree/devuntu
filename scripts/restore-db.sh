#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -lt 1 ]; then
  echo "Usage: $0 <dump-file>" >&2
  echo "Example: $0 backup/devuntu_20260719_120000.dump" >&2
  exit 1
fi

DUMP_FILE="$1"
DB_USER="${POSTGRES_USER:-devuser}"
DB_NAME="${POSTGRES_DB:-devuntu}"

if [ ! -f "${DUMP_FILE}" ]; then
  echo "File not found: ${DUMP_FILE}" >&2
  exit 1
fi

echo "Restoring ${DUMP_FILE} into ${DB_NAME} (database will be recreated)..."

# DBを一度作り直してから空のDBへ復元する。
# --clean 方式だと「ダンプに含まれるオブジェクト」しか DROP されず、
# ダンプに無い既存テーブル(例: 後から追加した calendar_share)とその外部キーが
# 残って依存エラー(user_pkey を DROP できない等)になるため、DB再作成方式を採る。
# 接続中のDBは DROP できないので postgres DB 経由で実行し、
# アプリ等が保持する接続は WITH (FORCE) で強制切断する(PostgreSQL 13+)。
docker compose exec -T db psql -U "${DB_USER}" -d postgres \
  -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"${DB_NAME}\" WITH (FORCE);" \
  -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"

# ホスト側ダンプを標準入力でコンテナへ渡し、空のDBへ pg_restore で復元
# --single-transaction: 全体を1トランザクション化(--exit-on-error を含む)。
#   途中でエラーが出たら全ロールバックし、FK欠落などの半端な状態を残さない。
docker compose exec -T db pg_restore -U "${DB_USER}" -d "${DB_NAME}" \
  --no-owner --single-transaction < "${DUMP_FILE}"

echo "Restore completed."
