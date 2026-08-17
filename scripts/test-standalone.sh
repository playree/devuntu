#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.." || exit 1

rm -rf ./out

cp -r ./.next/standalone ./out
cp -r ./.next/static ./out/.next/static
cp .env ./out/.env
