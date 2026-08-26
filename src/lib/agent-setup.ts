/**
 * 自動運用(Devuntu Agent)のセットアップ手順(サーバー専用)
 *
 * MCP ツール `get_agent_setup_guide` が返す本文。利用者のマシンで Claude Code に
 * そのまま実行させられる形にしてある。ランナー本体は `public/agent/devuntu_agent.py` に
 * 置いてあり、この手順から `curl` で取得する(サーバーと同じ版が必ず落ちてくる)。
 */

import { AGENT_POLL_INTERVAL_OPTIONS, DEFAULT_POLL_INTERVAL_SEC } from './agent'
import { makeUrl } from './server-utils'

/** ランナー本体の配布先。`public/` 配下なので認証は要らない(秘密情報を含まないため) */
export const AGENT_SCRIPT_PATH = '/agent/devuntu_agent.py'

export const agentSetupGuide = (): string => {
  const baseUrl = makeUrl('/').toString().replace(/\/$/, '')
  const scriptUrl = makeUrl(AGENT_SCRIPT_PATH).toString()
  const mcpUrl = makeUrl('/api/mcp').toString()
  const intervalMinutes = DEFAULT_POLL_INTERVAL_SEC / 60

  return `# Devuntu Agent のセットアップ

担当チケットが積まれたら自動で Claude Code が起動するようにする。
この手順は**エージェントを動かすマシン**で実行する(devuntu のサーバー側では何もしない)。

常駐プロセスは作らない。cron が ${intervalMinutes} 分おきに単発のスクリプトを起動し、
そのスクリプトが devuntu へ「処理すべきチケットがあるか」を聞く。あれば Claude Code を起動する。

## 事前に用意するもの

- **エージェント用のトークン**: devuntu の管理者が \`${baseUrl}/admin/agents\` で発行する
  (\`devuntu_agent_\` で始まる文字列。発行時に一度しか表示されない)
- **作業ディレクトリ**: リポジトリを clone して作業させるための基点ディレクトリ

## 1. 前提コマンドの確認

\`\`\`sh
python3 --version   # 3.9 以上
claude --version
git --version
\`\`\`

足りないものがあれば先に入れる。

\`gh\`(GitHub CLI)は必須ではない。事後作業で \`gh pr create\` により PR を自動作成させたい場合のみ、
別途インストールする。

## 2. 作業ディレクトリを用意する

対応するリポジトリは 1 つとは限らないので、\`~/devuntu-agent-work\` は特定のリポジトリを
クローンする場所ではなく、必要なリポジトリをその配下にクローンして使う**基点ディレクトリ**にする。
どのリポジトリを対象にするかは、チケットの内容や事前作業(手順7)の指示から Claude が判断する。

人が作業しているディレクトリとは共有しない。未コミットの変更を巻き込んだり、
ブランチを取り合ったりする。

\`\`\`sh
mkdir -p ~/devuntu-agent-work
\`\`\`

## 3. MCP を登録する

エージェントのトークンで devuntu の MCP を登録する。この経路ではブラウザでのログインと同意は起きない。

\`\`\`sh
claude mcp add --transport http devuntu-agent ${mcpUrl} \\
  --header "Authorization: Bearer <発行したトークン>"
\`\`\`

\`claude mcp list\` に \`devuntu-agent\` が出ることを確認する。

## 4. ランナーを取得する

\`\`\`sh
mkdir -p ~/.local/bin
curl -fsSL ${scriptUrl} -o ~/.local/bin/devuntu_agent.py
chmod +x ~/.local/bin/devuntu_agent.py
python3 ~/.local/bin/devuntu_agent.py --version
\`\`\`

サーバー側でランナーが更新された後も、この \`curl\` コマンドを再実行すれば最新版に置き換わる。
常駐プロセスではないため、再起動や cron の再登録は不要で、次回の cron 起動から新しいバージョンが使われる。

## 5. 設定ファイルを作る

トークンを平文で持つので、パーミッションは必ず 600 にする。

\`\`\`sh
mkdir -p ~/.config/devuntu-agent
cat > ~/.config/devuntu-agent/config.json <<'JSON'
{
  "base_url": "${baseUrl}",
  "token": "<発行したトークン>",
  "workdir": "<作業ディレクトリの絶対パス>",
  "claude_bin": "claude",
  "claude_args": ["--permission-mode", "acceptEdits"],
  "timeout_sec": 3600
}
JSON
chmod 600 ~/.config/devuntu-agent/config.json
\`\`\`

- \`claude_args\`: cron からは権限確認に誰も答えられないので、既定では編集を自動承認する。
  もっと広く許可したい場合だけ変える
- \`timeout_sec\`: これを超えた Claude は打ち切り、実行は失敗として記録される

## 6. 疎通を確認する

\`\`\`sh
python3 ~/.local/bin/devuntu_agent.py poll --dry-run
\`\`\`

出力の読み方:

- \`稼働条件を満たしていない: reason=no_runner\` → 管理画面で自動運用がまだ設定されていない(次の手順へ)
- \`稼働条件を満たしていない: reason=disabled\` → 設定はあるが無効。管理画面で有効にする
- \`稼働条件を満たしていない: reason=outside_hours\` → 稼働許可時間帯の外。設定どおりの動き
- \`処理するチケットは無い\` → 疎通も稼働条件も問題なし
- \`401\` が返る → トークンが違う(または再発行されて古くなった)

## 7. 管理画面で自動運用を設定する

\`${baseUrl}/admin/agents\` でエージェントの行の「自動運用」を開き、次を設定する。

- **有効**: オンにする
- **稼働許可時間帯**: 夜間だけ動かすなど。未指定なら終日
- **ポーリング間隔**: cron の間隔と揃える(選べる値: ${AGENT_POLL_INTERVAL_OPTIONS.map((sec) => `${sec / 60}分`).join(' / ')})
- **既定の処理方式**: チケット側で指定が無いときの方式
- **事前作業 / 事後作業**: Claude がチケットの処理前後に読む指示。例:
  - 事前作業: \`チケット本文からリポジトリを判断し、~/devuntu-agent-work 配下に無ければ clone、
    あれば git pull してチケットの表示IDでブランチを作る\`
  - 事後作業: \`lint とビルドを通し、gh pr create で PR を作る\`

## 8. cron に登録する

\`flock\` で多重起動を防ぐ。前回の Claude がまだ動いていれば、その回は何もせず終わる。

\`\`\`sh
mkdir -p ~/.cache
( crontab -l 2>/dev/null; \\
  echo "*/${intervalMinutes} * * * * flock -n ~/.cache/devuntu-agent.lock python3 ~/.local/bin/devuntu_agent.py poll" \\
) | crontab -
crontab -l
\`\`\`

ログは \`~/.local/state/devuntu-agent/agent.log\`(1MB で 3 世代までローテート)。

## 9. 動かしてみる

1. devuntu でチケットを作り、担当をエージェントにする
2. チケット詳細の「エージェント」で処理方式を選ぶ
   - **プラン先行**: プランを投稿して一旦終了し、返信を待つ。返信すると続きを処理する
   - **自動実行**: プランを作らずに対応して報告する
3. 次の cron を待つ(すぐ試すなら \`python3 ~/.local/bin/devuntu_agent.py poll\` を手で実行)
4. 結果は チケットのコメントと、管理画面の「実行履歴」で確認する

## 10. この手順をスキルとして残す

同じ環境で作り直せるよう、作業ディレクトリに \`.claude/skills/devuntu-agent/SKILL.md\` を作り、
このガイドの内容を書き出しておく。先頭には次の frontmatter を付ける。

\`\`\`
---
name: devuntu-agent
description: devuntu の自動運用(Devuntu Agent)をこのマシンにセットアップし、動作を確認する。
---
\`\`\`

トークンは書かない(設定ファイルにだけ置く)。

## うまく動かないとき

| 症状 | 見るところ |
| --- | --- |
| 管理画面の自動運用が「オフライン」のまま | cron が動いているか(\`crontab -l\`)、\`~/.local/state/devuntu-agent/agent.log\` |
| 実行履歴に「失敗」が並ぶ | 履歴の「内容」に終了コードと標準エラーの末尾が入っている |
| 実行が「実行中」のまま止まる | Claude が \`finish_agent_task\` を呼べていない。60 分で自動的に失敗へ落ちる |
| チケットが拾われない | 担当がエージェントか、チケットの「エージェント」が「任せない」になっていないか |
`
}
