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

echo "Restoring ${DUMP_FILE} into ${DB_NAME} (existing objects will be dropped)..."

# ホスト側ダンプを標準入力でコンテナへ渡し、pg_restore で復元
# --single-transaction: 全体を1トランザクション化(--exit-on-error を含む)。
#   途中でエラーが出たら全ロールバックし、FK欠落などの半端な状態を残さない。
docker compose exec -T db pg_restore -U "${DB_USER}" -d "${DB_NAME}" \
  --clean --if-exists --no-owner --single-transaction < "${DUMP_FILE}"

echo "Restore completed."
