# Devuntu Agent のセットアップ

担当チケットが積まれたら自動で Claude Code が起動するようにする。
この手順は**エージェントを動かすマシン**で実行する(devuntu のサーバー側では何もしない)。

常駐プロセスは作らない。cron が {{intervalMinutes}} 分おきに単発のスクリプトを起動し、
そのスクリプトが devuntu へ「処理すべきチケットがあるか」を聞く。あれば Claude Code を起動する。

## 事前に用意するもの

- **エージェント用のトークン**: devuntu の管理者が `{{baseUrl}}/admin/agents` で発行する
  (`devuntu_agent_` で始まる文字列。発行時に一度しか表示されない)
- **作業ディレクトリ**: リポジトリを clone して作業させるための基点ディレクトリ。
  ランナー本体・設定・ログもこの配下に置くので、1 エージェントの構成はこのディレクトリだけで完結する

## 1. 前提コマンドの確認

```sh
python3 --version   # 3.9 以上
claude --version
command -v claude   # 実体の場所。cron で見つからないときに使う
git --version
```

足りないものがあれば先に入れる。

cron はシェルの設定ファイル(`.bashrc` など)を読まないため、ここで見えている PATH は cron には
引き継がれない。この差は手順 5 の `save-path` で埋める。

`gh`(GitHub CLI)は必須ではない。事後作業で `gh pr create` により PR を自動作成させたい場合のみ、
別途インストールする。

## 2. 作業ディレクトリを用意する

対応するリポジトリは 1 つとは限らないので、`~/devuntu-agent-work` は特定のリポジトリを
クローンする場所ではなく、必要なリポジトリをその配下にクローンして使う**基点ディレクトリ**にする。
どのリポジトリを対象にするかは、チケットの内容や事前作業(手順7)の指示から Claude が判断する。

人が作業しているディレクトリとは共有しない。未コミットの変更を巻き込んだり、
ブランチを取り合ったりする。

ランナー本体・設定ファイル・ログ・ロックファイルは、この直下の `.devuntu-agent` にまとめて置く。
同じマシンで複数のエージェントを動かす場合は、作業ディレクトリごとにこの一式を持たせる
(「同じマシンに複数のエージェントを置く」を参照)。

```sh
mkdir -p ~/devuntu-agent-work/.devuntu-agent
cd ~/devuntu-agent-work
grep -qxF '.devuntu-agent' .gitignore 2>/dev/null || echo '.devuntu-agent' >> .gitignore
```

`.devuntu-agent` にはトークンを平文で持つ設定ファイルが入る。作業ディレクトリ自体を git で
管理する場合にコミットしてしまわないよう、`.gitignore` に入れておく(ファイルが無ければ作られる)。

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
cd ~/devuntu-agent-work
curl -fsSL {{scriptUrl}} -o .devuntu-agent/devuntu_agent.py
chmod +x .devuntu-agent/devuntu_agent.py
python3 .devuntu-agent/devuntu_agent.py --version
```

ランナーは起動のたびにこの URL から最新版を取得し、差分があれば自分自身を書き換える。
書き換えた回は旧バージョンのままチケットを処理してしまわないよう、処理を行わずにそのまま終了する。
常駐プロセスではないため再起動や cron の再登録は不要で、次回の cron 起動から新しいバージョンで処理される。
無効化したい場合は `config.json` に `"self_update": false` を設定する。

## 5. 設定ファイルを作る

トークンを平文で持つので、パーミッションは必ず 600 にする。

設定ファイルはランナー本体と同じ `.devuntu-agent` に置く。ランナーは自分の隣にある
`config.json` を読むので、cron 行にパスを書き足す必要はない。

```sh
cat > ~/devuntu-agent-work/.devuntu-agent/config.json <<'JSON'
{
  "base_url": "{{baseUrl}}",
  "token": "<発行したトークン>",
  "cli": {
    "kind": "claude",
    "bin": "claude",
    "args": ["--permission-mode", "auto"],
    "model": "sonnet",
    "path": [],
    "env": {}
  },
  "timeout_sec": 3600
}
JSON
chmod 600 ~/devuntu-agent-work/.devuntu-agent/config.json
```

- `workdir`: 作業ディレクトリ。省略すると `.devuntu-agent` の 1 つ上(手順2で作ったディレクトリ)を
  使うので、通常は書かない。別の場所を作業起点にしたいときだけ絶対パスで指定する
- `cli.kind`: 起動する CLI の種類。将来 `claude` 以外の CLI にも対応するための拡張ポイントで、
  現状は `claude` のみサポートする
- `cli.bin`: 実行コマンド。省略すると `cli.kind` と同じ値(`claude`)を使う
- `cli.args`: cron からは権限確認に誰も答えられないので、既定 (`auto`) はファイル編集に
  限らずツール利用(Bash 含む)全般を自動承認する。
  **注意**: エージェントが読むチケット本文・コメントの内容がそのまま Claude への指示になり得るため、
  自動承認の範囲を広げるほど、悪意ある(または誤った)チケット内容から想定外のコマンドが
  無条件に実行されるリスクも上がる。エージェントに割り当てるチケットを作成・コメントできる範囲を
  信頼できる人に限定するなど、リスクは運用側で判断すること。より制限したい場合は
  `--permission-mode acceptEdits`(編集のみ自動承認)に変える、または `--disallowedTools` で
  危険なツールを個別に禁止する
- `cli.model`: 使用する Claude のモデル。既定は `sonnet`。`opus` / `fable` など
  `claude --help` の `--model` が受け付けるエイリアスを指定できる
- `cli.path`: Claude を起動するときに PATH の先頭へ足すディレクトリ。空のままにしておき、
  次の `save-path` で入れる(手で書くのは特殊な配置のときだけ)。この PATH は Claude 自身にも
  渡るので、Claude が Bash ツールから叩く `git` / `node` / `pnpm` / `gh` の解決にも効く
- `cli.env`: Claude へ渡す追加の環境変数(例: `{"GH_TOKEN": "..."}`)。cron 実行では
  シェルで export している変数が引き継がれないため、必要なものはここに書く
- `timeout_sec`: これを超えた Claude は打ち切り、実行は失敗として記録される

設定を作ったら、いま使っているシェルの PATH をそのまま設定に取り込む。

```sh
python3 ~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py save-path
```

cron はシェルの設定ファイルを読まないので、cron の PATH は `/usr/bin:/bin` 程度しかない。
このコマンドは、`claude` も `git` も見つかっている**いまのシェルの PATH**(実在するディレクトリのみ)を
`cli.path` に保存する。ランナーはこれを PATH の先頭に置いてから Claude を起動するため、
cron からでもこのシェルと同じようにコマンドを解決できる。

保存したディレクトリと `claude` の見つかった場所が表示される。
`claude not found` と出た場合は、そのシェルで `claude` が使えていない。

node のバージョンを上げた、claude を入れ直したなど PATH が変わったときは、もう一度実行する。
(`save-path` を実行しなくても、ランナーは `~/.local/bin` や nvm の node など主なインストール先を
自分で探しにいく。`save-path` はそれを確実にするためのもの)

## 6. 疎通を確認する

```sh
python3 ~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py poll --dry-run
```

出力の読み方:

- `run conditions not met: reason=no_runner` → 管理画面で自動運用がまだ設定されていない(次の手順へ)
- `run conditions not met: reason=disabled` → 設定はあるが無効。管理画面で有効にする
- `run conditions not met: reason=outside_hours` → 稼働許可時間帯の外。設定どおりの動き
- `no tickets to process` → 疎通も稼働条件も問題なし
- `dry-run: would process ... with /path/to/claude` → 起動する Claude の場所まで確認できている
- `claude not found (PATH=...)` → Claude を見つけられない。`cli.path` か `cli.bin` を設定する
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

多重起動の防止はランナー自身が `.devuntu-agent/agent.lock` で行う。前回の Claude がまだ動いていれば、
その回は何もせず終わる。ロックは作業ディレクトリごとに分かれるので、同じマシンの別のエージェントとは
干渉しない。cron 行はランナーを実行するだけにし、排他の仕組みを cron 側に足さない
(ランナー側のロックと二重になり、ランナー側の取得が毎回失敗して常にスキップされてしまうため)。

```sh
( crontab -l 2>/dev/null; \
  echo "*/{{intervalMinutes}} * * * * python3 ~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py poll" \
) | crontab -
crontab -l
```

cron 行に PATH を書き足す必要は無い。手順 5 の `save-path` で保存した PATH を
ランナーが Claude に渡す。それでも `claude not found` になる場合は、`config.json` の
`cli.bin` に `command -v claude` で確認した絶対パスを書く。

ログは `~/devuntu-agent-work/.devuntu-agent/agent.log`(1MB で 3 世代までローテート)。

## 9. 動かしてみる

1. devuntu でチケットを作り、担当をエージェントにする
2. チケット詳細の「エージェント」で処理方式を選ぶ
   - **プラン先行**: プランを投稿して一旦終了し、返信を待つ。返信すると続きを処理する
   - **自動実行**: プランを作らずに対応して報告する
3. 次の cron を待つ(すぐ試すなら `python3 ~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py poll` を手で実行)
4. 結果は チケットのコメントと、管理画面の「実行履歴」で確認する

## 10. この手順をスキルとして残す

同じ環境で作り直せるよう、作業ディレクトリに `.claude/skills/devuntu-agent/SKILL.md` を作り、
このガイドの内容を書き出しておく。先頭には次の frontmatter を付ける。

```yaml
---
name: devuntu-agent
description: devuntu の自動運用(Devuntu Agent)をこのマシンにセットアップし、動作を確認する。
---
```

トークンは書かない(設定ファイルにだけ置く)。

## 同じマシンに複数のエージェントを置く

1 エージェントの構成は作業ディレクトリだけで完結するので、エージェントごとに作業ディレクトリを
用意して手順2から8を繰り返すだけでよい。

```
~/devuntu-agent-work-a/.devuntu-agent/{devuntu_agent.py,config.json,agent.log,agent.lock}
~/devuntu-agent-work-b/.devuntu-agent/{devuntu_agent.py,config.json,agent.log,agent.lock}
```

- トークンはエージェントごとに発行し、それぞれの作業ディレクトリで MCP を登録する(手順3)
- cron 行も作業ディレクトリごとに登録する
- ロックとログは作業ディレクトリごとに分かれるため、互いにスキップさせたりログを混ぜたりしない

## 旧配置(0.6.0 より前)からの移行

0.6.0 より前は本体を `~/.local/bin`、設定を `~/.config/devuntu-agent` に置いていた。
新しいランナーは自分の隣の `config.json` しか読まないため、**旧配置のまま放置すると自己更新で
0.6.0 になった時点で設定を見失って止まる**。次の手順で移し替える。

```sh
crontab -l 2>/dev/null | grep -v 'devuntu_agent.py' | crontab -   # 旧 cron 行を外す
mkdir -p ~/devuntu-agent-work/.devuntu-agent
mv ~/.config/devuntu-agent/config.json ~/devuntu-agent-work/.devuntu-agent/config.json
mv ~/.local/bin/devuntu_agent.py ~/devuntu-agent-work/.devuntu-agent/devuntu_agent.py
cd ~/devuntu-agent-work
grep -qxF '.devuntu-agent' .gitignore 2>/dev/null || echo '.devuntu-agent' >> .gitignore
rm -rf ~/.config/devuntu-agent ~/.local/state/devuntu-agent ~/.cache/devuntu-agent.lock
```

`config.json` の `workdir` は、移した先の 1 つ上と同じなら消してよい(別の場所を指しているなら残す)。
そのあと手順8の cron 登録と手順6の疎通確認をやり直す。

設定だけ旧パスに残った状態で新しいランナーを起動した場合は、設定が見つからない旨と
旧パスにファイルが残っていることを伝えるエラーが出る。

## うまく動かないとき

| 症状                                     | 見るところ                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 管理画面の自動運用が「オフライン」のまま | cron が動いているか(`crontab -l`)、`.devuntu-agent/agent.log`                                                    |
| 実行履歴に「失敗」が並ぶ                 | 履歴の「内容」に終了コードと標準エラーの末尾が入っている                                                         |
| 実行が「実行中」のまま止まる             | Claude が `finish_agent_task` を呼べていない。60 分で自動的に失敗へ落ちる                                        |
| チケットが拾われない                     | 担当がエージェントか、チケットの「エージェント」が「任せない」になっていないか                                   |
| `claude not found` で失敗する            | `claude` が使えるシェルで `devuntu_agent.py save-path` を実行し直す。それでも駄目なら `cli.bin` に絶対パスを書く |
