# Devuntu Agent のセットアップ

担当チケットが積まれたら自動で Claude Code が起動するようにする。
この手順は**エージェントを動かすマシン**で実行する(devuntu のサーバー側では何もしない)。

常駐プロセスは作らない。cron が {{intervalMinutes}} 分おきに単発のスクリプトを起動し、
そのスクリプトが devuntu へ「処理すべきチケットがあるか」を聞く。あれば Claude Code を起動する。

## 事前に用意するもの

- **エージェント用のトークン**: devuntu の管理者が `{{baseUrl}}/admin/agents` で発行する
  (`devuntu_agent_` で始まる文字列。発行時に一度しか表示されない)
- **作業ディレクトリ**: リポジトリを clone して作業させるための基点ディレクトリ

## 1. 前提コマンドの確認

```sh
python3 --version   # 3.9 以上
claude --version
git --version
```

足りないものがあれば先に入れる。

`gh`(GitHub CLI)は必須ではない。事後作業で `gh pr create` により PR を自動作成させたい場合のみ、
別途インストールする。

## 2. 作業ディレクトリを用意する

対応するリポジトリは 1 つとは限らないので、`~/devuntu-agent-work` は特定のリポジトリを
クローンする場所ではなく、必要なリポジトリをその配下にクローンして使う**基点ディレクトリ**にする。
どのリポジトリを対象にするかは、チケットの内容や事前作業(手順7)の指示から Claude が判断する。

人が作業しているディレクトリとは共有しない。未コミットの変更を巻き込んだり、
ブランチを取り合ったりする。

```sh
mkdir -p ~/devuntu-agent-work
```

## 3. MCP を登録する

エージェントのトークンで devuntu の MCP を登録する。この経路ではブラウザでのログインと同意は起きない。
設定は作業ディレクトリ直下の `.mcp.json` に保存する(`--scope project`)。cron からは常にこの
ディレクトリを作業起点にして `claude` を起動するため、ここに置けばどのリポジトリを処理する際にも読み込まれる。

```sh
cd ~/devuntu-agent-work
claude mcp add --transport http devuntu-agent {{mcpUrl}} \
  --scope project \
  --header "Authorization: Bearer <発行したトークン>"
chmod 600 .mcp.json
```

`.mcp.json` にトークンが平文で入るので、必ず `chmod 600` する。

作業ディレクトリの中で `claude mcp list` を実行し、`devuntu-agent` が出ることを確認する
(project スコープの設定はカレントディレクトリに紐づくため、別の場所で実行すると出てこない)。

## 4. ランナーを取得する

```sh
mkdir -p ~/.local/bin
curl -fsSL {{scriptUrl}} -o ~/.local/bin/devuntu_agent.py
chmod +x ~/.local/bin/devuntu_agent.py
python3 ~/.local/bin/devuntu_agent.py --version
```

ランナーは起動のたびにこの URL から最新版を取得し、差分があれば自分自身を書き換える。
書き換えた回は旧バージョンのままチケットを処理してしまわないよう、処理を行わずにそのまま終了する。
常駐プロセスではないため再起動や cron の再登録は不要で、次回の cron 起動から新しいバージョンで処理される。
無効化したい場合は `config.json` に `"self_update": false` を設定する。

## 5. 設定ファイルを作る

トークンを平文で持つので、パーミッションは必ず 600 にする。

```sh
mkdir -p ~/.config/devuntu-agent
cat > ~/.config/devuntu-agent/config.json <<'JSON'
{
  "base_url": "{{baseUrl}}",
  "token": "<発行したトークン>",
  "workdir": "<作業ディレクトリの絶対パス>",
  "claude_bin": "claude",
  "claude_args": ["--permission-mode", "auto"],
  "timeout_sec": 3600
}
JSON
chmod 600 ~/.config/devuntu-agent/config.json
```

- `claude_args`: cron からは権限確認に誰も答えられないので、既定 (`auto`) はファイル編集に
  限らずツール利用(Bash 含む)全般を自動承認する。
  **注意**: エージェントが読むチケット本文・コメントの内容がそのまま Claude への指示になり得るため、
  自動承認の範囲を広げるほど、悪意ある(または誤った)チケット内容から想定外のコマンドが
  無条件に実行されるリスクも上がる。エージェントに割り当てるチケットを作成・コメントできる範囲を
  信頼できる人に限定するなど、リスクは運用側で判断すること。より制限したい場合は
  `--permission-mode acceptEdits`(編集のみ自動承認)に変える、または `--disallowedTools` で
  危険なツールを個別に禁止する
- `timeout_sec`: これを超えた Claude は打ち切り、実行は失敗として記録される

## 6. 疎通を確認する

```sh
python3 ~/.local/bin/devuntu_agent.py poll --dry-run
```

出力の読み方:

- `稼働条件を満たしていない: reason=no_runner` → 管理画面で自動運用がまだ設定されていない(次の手順へ)
- `稼働条件を満たしていない: reason=disabled` → 設定はあるが無効。管理画面で有効にする
- `稼働条件を満たしていない: reason=outside_hours` → 稼働許可時間帯の外。設定どおりの動き
- `処理するチケットは無い` → 疎通も稼働条件も問題なし
- `401` が返る → トークンが違う(または再発行されて古くなった)

## 7. 管理画面で自動運用を設定する

`{{baseUrl}}/admin/agents` でエージェントの行の「自動運用」を開き、次を設定する。

- **有効**: オンにする
- **稼働許可時間帯**: 夜間だけ動かすなど。未指定なら終日
- **ポーリング間隔**: cron の間隔と揃える(選べる値: {{pollIntervalOptions}})
- **既定の処理方式**: チケット側で指定が無いときの方式
- **事前作業 / 事後作業**: Claude がチケットの処理前後に読む指示。例:
  - 事前作業: `チケット本文からリポジトリを判断し、~/devuntu-agent-work 配下に無ければ clone、
あれば git pull してチケットの表示IDでブランチを作る`
  - 事後作業: `lint とビルドを通し、gh pr create で PR を作る`

## 8. cron に登録する

多重起動の防止はランナー自身が `~/.cache/devuntu-agent.lock` を `fcntl.flock` で取得して行う。
前回の Claude がまだ動いていれば、その回は何もせず終わる。cron 側で `flock` は使わない
(同じロックファイルに対して cron 側とランナー側で二重にロックを取ると、ランナー側の取得が
毎回失敗し、常にスキップされてしまうため)。

```sh
( crontab -l 2>/dev/null; \
  echo "*/{{intervalMinutes}} * * * * python3 ~/.local/bin/devuntu_agent.py poll" \
) | crontab -
crontab -l
```

ログは `~/.local/state/devuntu-agent/agent.log`(1MB で 3 世代までローテート)。

## 9. 動かしてみる

1. devuntu でチケットを作り、担当をエージェントにする
2. チケット詳細の「エージェント」で処理方式を選ぶ
   - **プラン先行**: プランを投稿して一旦終了し、返信を待つ。返信すると続きを処理する
   - **自動実行**: プランを作らずに対応して報告する
3. 次の cron を待つ(すぐ試すなら `python3 ~/.local/bin/devuntu_agent.py poll` を手で実行)
4. 結果は チケットのコメントと、管理画面の「実行履歴」で確認する

## 10. この手順をスキルとして残す

同じ環境で作り直せるよう、作業ディレクトリに `.claude/skills/devuntu-agent/SKILL.md` を作り、
このガイドの内容を書き出しておく。先頭には次の frontmatter を付ける。

```
---
name: devuntu-agent
description: devuntu の自動運用(Devuntu Agent)をこのマシンにセットアップし、動作を確認する。
---
```

トークンは書かない(設定ファイルにだけ置く)。

## うまく動かないとき

| 症状                                     | 見るところ                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| 管理画面の自動運用が「オフライン」のまま | cron が動いているか(`crontab -l`)、`~/.local/state/devuntu-agent/agent.log`    |
| 実行履歴に「失敗」が並ぶ                 | 履歴の「内容」に終了コードと標準エラーの末尾が入っている                       |
| 実行が「実行中」のまま止まる             | Claude が `finish_agent_task` を呼べていない。60 分で自動的に失敗へ落ちる      |
| チケットが拾われない                     | 担当がエージェントか、チケットの「エージェント」が「任せない」になっていないか |
