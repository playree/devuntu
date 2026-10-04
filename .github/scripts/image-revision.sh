#!/usr/bin/env bash
# イメージ(タグまたは digest 指定)のビルド元 commit を出力する。
# 単一アーキでは .Image が設定そのもの、マルチアーキではプラットフォームをキーにしたマップになる。
# 全プラットフォームは同じ commit からビルドするため、マップのときは linux/amd64 を見る
set -euo pipefail

docker buildx imagetools inspect "$1" --format '{{ json .Image }}' |
  jq -er 'if has("config") then . else .["linux/amd64"] end
          | .config.Labels["org.opencontainers.image.revision"]'
