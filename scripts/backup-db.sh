#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DB_USER="${POSTGRES_USER:-devuser}"
DB_NAME="${POSTGRES_DB:-devuntu}"
OUT_DIR="backup"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${OUT_DIR}/${DB_NAME}_${STAMP}.dump"

mkdir -p "${OUT_DIR}"

# カスタム形式(-Fc)で標準出力に出し、ホスト側ファイルへ保存
docker compose exec -T db pg_dump -U "${DB_USER}" -Fc "${DB_NAME}" > "${OUT_FILE}"

echo "Backup created: ${OUT_FILE}"
