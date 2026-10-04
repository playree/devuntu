#!/usr/bin/env bash
# イメージ(タグまたは digest 指定)のビルド元 commit を出力する。
# 単一アーキでは .Image が設定そのもの、マルチアーキではプラットフォームをキーにしたマップになる。
# マルチアーキでプラットフォームごとにビルド元が食い違う場合と、ラベルが無い場合は失敗する
set -euo pipefail

docker buildx imagetools inspect "$1" --format '{{ json .Image }}' |
  jq -er 'if has("config") then [.] else [.[]] end
          | map(.config.Labels["org.opencontainers.image.revision"]) | unique
          | if length == 1 then .[0] else error("revisions differ: \(.)") end'
