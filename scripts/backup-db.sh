#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DB_USER="${POSTGRES_USER:-devuser}"
DB_NAME="${POSTGRES_DB:-devuntu}"
OUT_DIR="backup"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${OUT_DIR}/${DB_NAME}_${STAMP}.dump"

mkdir -p "${OUT_DIR}"

# 一時ファイルへ出力し、成功時のみ本ファイルへ移動する。
# (直接リダイレクトすると失敗時に空/壊れたdumpが残り、後のrestoreで事故になるため)
TMP_FILE="${OUT_FILE}.tmp"
trap 'rm -f "${TMP_FILE}"' EXIT

# カスタム形式(-Fc)で標準出力に出し、ホスト側の一時ファイルへ保存
docker compose exec -T db pg_dump -U "${DB_USER}" -Fc "${DB_NAME}" > "${TMP_FILE}"

mv "${TMP_FILE}" "${OUT_FILE}"

echo "Backup created: ${OUT_FILE}"
