# AIエージェントの自動運用(Devuntu Agent)

担当チケットが積まれたら自動で AI エージェントの CLI(Claude Code / Codex CLI)が起動して処理する仕組み。
ここでは全体の作りと、運用していて詰まったときに見る場所をまとめる。
利用者から見た使い方は [user-guide.md](user-guide.md#エージェントにチケットを任せる) を参照。

エージェントユーザーそのもの(作成・トークン)は [docs/mcp-server.md](mcp-server.md#aiエージェント用ユーザー) を参照。

## 全体の流れ

常駐プロセスは無い。利用者のマシンの cron が 5 分おきに単発のランナーを起動し、
**処理すべきチケットがあるときだけ** CLI を起動する。

```
cron ──> devuntu_agent.py ──1──> POST /api/agent/status   「動いてよいか / 何を処理するか」
                            ──2──> POST /api/agent/runs    実行の開始を記録(チケットが処理中になる)
                            ──3──> claude -p / codex exec  ─┐
                            ──5──> PATCH /api/agent/runs/:id │  4. エージェントが MCP で
                                                             └───   get_agent_task → 処理 → finish_agent_task
```

チケットの状態を決めるのは **4 のエージェント自身**。5 は保険で、報告せずに落ちた場合だけ効く。

実行が終了した時点で、対象チケットが所属するボードに Slack チャンネルが設定されていれば結果を投稿する
([notifications.md](notifications.md#エージェント実行結果のチャンネル通知))。

- **1** で CLI を起動しないのは、5 分おきにエージェントを立ち上げるのが高くつくため。稼働条件と
  処理対象の判定はプレーンな REST で済ませる
- **2** を CLI の起動前に行うのは、次のポーリングで同じチケットを二重に拾わないため。
  このためエージェントが `get_agent_task` を呼ぶ時点でチケットは既に `running` になっている
  (待ち行列には載らないので、`get_agent_task` はチケットを名指しで解決する経路を持つ)

## チケットの処理方式

チケット単位で選ぶ(`Ticket.agentMode`)。**null は「エージェントに任せない」**で、担当がエージェントでも拾わない。
担当を割り当てただけでは動かない、というのが基本の考え方。

| 方式               | 動き                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `plan`(プラン先行) | プランを `type=plan` のコメントで投稿して一旦終了する。利用者が返信すると、その内容に従ってプランを直すか実装に進む |
| `auto`(自動実行)   | プランを作らずに対応し、結果を `type=report` のコメントで報告する                                                   |

`plan` の再開条件は「**エージェント自身の最新コメントより後に、他の誰かのコメントが付いている**」こと。
これを満たすまでは待ち行列に載らないので、返信が無い限り同じプランを何度も投稿することはない。

## チケットの状態

`Ticket.agentState`。遷移させるのは `src/lib/agent/agent-runner.ts` だけ。

| 状態                          | 意味                     | 次                                           |
| ----------------------------- | ------------------------ | -------------------------------------------- |
| (null) / `queued`             | 未着手                   | ランナーが拾うと `running`                   |
| `running`                     | エージェントが処理中     | エージェントの報告か、60分の時間切れで抜ける |
| `planned`                     | プラン投稿済み・返信待ち | 返信が付くと `revise` として拾われる         |
| `done` / `failed` / `skipped` | 終了                     | 拾われない                                   |

`running` のまま残ると二度と拾えなくなるため、抜け道を 3 つ用意してある。

1. エージェントの `finish_agent_task`(正常系)
2. ランナーの `PATCH /api/agent/runs/:id`(エージェントが報告せずに終了した場合)
3. `failStaleAgentRuns`(ランナーごと落ちた場合。`src/lib/agent/agent-runner.ts` の定数 `AGENT_RUN_TIMEOUT_MIN` = 60分)

2 で「成功」と伝えられても失敗として閉じる。ランナーが知っているのは CLI の終了コードだけで、
終了コード 0 でも何をしたかは分からないため。

## 稼働条件

`AgentRunner` に持ち、`/api/agent/status` と `get_agent_task` の両方で判定する。
ランナーが起動してからエージェントが動き出すまでに時間が経つことがあるので、二度見る。

| `reason`        | 意味                                       |
| --------------- | ------------------------------------------ |
| `no_runner`     | 自動運用が未設定(`AgentRunner` の行が無い) |
| `disabled`      | 設定はあるが無効                           |
| `outside_hours` | 稼働許可時間帯の外                         |

時間帯は 0:00 からの分で持ち、開始と終了のどちらかが未指定なら終日。
**開始 > 終了は日跨ぎ**(例 22:00〜06:00 = 夜間のみ)。終了時刻ちょうどは含めない。

## 認証

ランナーの API はエージェント用の長期トークン専用。`devuntu_agent_` で始まらない Bearer は、
有効な OAuth アクセストークンでも、ユーザーが自分で発行した MCP トークン(`devuntu_pat_`)でも
401 で弾く。人間の MCP クライアントが使う口ではないため。

エージェント専用の MCP ツール(`get_agent_task` / `finish_agent_task`)も、
エージェント用トークンで接続した場合だけ登録する。人間の一覧には出ない。

## ランナー(devuntu_agent.py)

[public/agent/devuntu_agent.py](../public/agent/devuntu_agent.py)。標準ライブラリだけで動く。
`public/` に置いてあるのは、セットアップ時に `curl <BASE_URL>/agent/devuntu_agent.py` で
**サーバーと同じ版**を取得できるようにするため(秘密情報は含まない)。

- 常駐しない。cron が 5 分おきに単発起動する。プロセス監視も再起動も要らない
- cron の PATH では `claude` / `codex` を解決できないため、ランナーが PATH を補ってから CLI を起動する。
  補う内容は `cli.path`(セットアップ時に `save-path` サブコマンドで対話シェルの PATH を保存する)が
  優先で、主なインストール先(`~/.local/bin`、nvm の node など)の推測はそのフォールバック。
  補った PATH は CLI 自身にも渡るので、エージェントが呼ぶコマンドの解決にも効く
- 多重起動の防止はランナー側のファイルロックで行う。cron 行に排他の仕組みを足すと同じロックファイルの
  二重取得になり、ランナー側が毎回失敗してスキップされてしまうため足さない
- 1 回の poll で 1 件だけ処理する。残りは次の poll で拾う
- ランナー本体・設定・ログ・ロックは作業ディレクトリ直下の `.devuntu-agent` に置く。
  1 エージェントの構成が作業ディレクトリだけで完結するので、作業ディレクトリを分ければ
  同一ホストに複数のエージェントを並べられる(ロックも作業ディレクトリごとに分かれる)
- 設定は `.devuntu-agent/config.json`。トークンを平文で持つのでパーミッションは 600。
  ランナーは自分の隣にある `config.json` を読むため、cron 行にパスの指定は要らない
- ログは `.devuntu-agent/agent.log`(1MB × 3 世代)、ロックは `.devuntu-agent/agent.lock`
- `workdir` は特定のリポジトリではなく、必要なリポジトリをその配下に clone して使う基点ディレクトリ。
  どのリポジトリを対象にするかはチケット本文や事前作業(`preTask`)の指示からエージェントが判断する。
  config で省略された場合は `.devuntu-agent` の 1 つ上を使う
- poll のたびに `AGENT_SCRIPT_PATH` から最新版を取得し、差分があれば自分自身を書き換える(自動更新)。
  書き換えた回はチケットを処理せずに終了する(旧コードのまま処理するとサーバーの期待する挙動とずれるため)。
  次回の cron 起動から新しいバージョンで処理される。
  取得や書き換えに失敗しても warning ログを残すだけで実行は継続する。無効化は `self_update: false`

CLI 起動まわりの設定は `config.json` の `cli` にまとめる(`cli.kind` / `cli.bin` / `cli.args` /
`cli.model` / `cli.path` / `cli.env`)。

`cli.kind` で起動する CLI を選ぶ(`claude` / `codex`、既定は `claude`)。CLI ごとに違うのは
**起動コマンドの組み立てと既定値だけ**で、渡すプロンプトも処理の流れも共通(`build_command` に閉じている)。
cron からは権限確認に誰も答えられないため、`cli.args` の既定はどちらも自動承認にしてある。

| `cli.kind` | 起動コマンド          | `cli.args` の既定                                    | `cli.model` の既定 |
| ---------- | --------------------- | ---------------------------------------------------- | ------------------ |
| `claude`   | `claude -p <prompt>`  | `--permission-mode auto`                             | `sonnet`           |
| `codex`    | `codex exec <prompt>` | `--sandbox danger-full-access --skip-git-repo-check` | なし(CLI 側の既定) |

`codex` の `--skip-git-repo-check` は外せない。codex は git リポジトリの中でしか動かないが、
`workdir` は clone の基点であってリポジトリではないため。

**この既定値はエージェント専用ホストで動かすことを前提にしている。** チケット本文とコメントの内容が
そのままエージェントへの指示になるため、既定のままだと悪意ある(または誤った)チケットから
`workdir` の外のファイル操作や外部通信まで実行され得る。claude の `--permission-mode auto` も
codex の `--sandbox danger-full-access` も同じ前提で、CLI 間に差は無い。人が普段使うマシンや、
エージェントに触らせたくない鍵・認証情報があるホストでは動かさないこと。

制限したい場合は `cli.args` を上書きする。codex なら次のようにする。

```json
"args": ["--sandbox", "workspace-write", "-c", "sandbox_workspace_write.network_access=true", "--skip-git-repo-check"]
```

`workspace-write` は既定でネットワークを遮断するため、`network_access=true` を併せて指定しないと
`git clone` や依存関係のインストールが失敗する。また `~/.npm` や `~/.cache`、`~/.gitconfig` など
ワークスペース外への書き込みも弾かれるので、エージェントにビルドまでさせる場合は
そこで詰まらないかを確認してから使う。claude なら `--permission-mode acceptEdits`(編集のみ自動承認)や
`--disallowedTools` で絞る。

`cli.model` は claude では `--model` のエイリアス(`sonnet` など)、codex ではモデル名(`gpt-5.5` など)を
そのまま渡す。codex で省略した場合は `~/.codex/config.toml` の `model` に従う。推論の強さのように
モデル以外の設定を変えたい場合は、`cli.args` に `-c model_reasoning_effort="high"` や
`--profile <名前>` を足す(どちらも codex 側の設定を上書きするフラグ)。

### トークンの渡り方

ランナーは CLI を起動するとき、`config.json` の `token` を環境変数 `DEVUNTU_AGENT_TOKEN` として渡す
(`AGENT_TOKEN_ENV`)。MCP の設定ファイルは、その環境変数を参照するだけで実際のトークンを持たない。

- Claude Code: `.mcp.json` のヘッダに `Bearer ${DEVUNTU_AGENT_TOKEN}`(読み込み時に展開される)
- Codex CLI: `.codex/config.toml` の `bearer_token_env_var = "DEVUNTU_AGENT_TOKEN"`

トークンの在処が `config.json` だけになるので、再発行時に直す場所が 1 箇所で済む。人が同じ作業
ディレクトリで CLI を手動起動して確認するときは、`devuntu_agent.py env` が同じ環境変数を
`export` 形式で出す。

## セットアップ

MCP ツール `get_agent_setup_guide` が、そのマシンで実行できる手順を返す。
Claude Code や Codex CLI から「devuntu のエージェントをセットアップして」と頼めば、この手順に沿って進む。

どちらの CLI で動かすかは引数 `cli` で決まり、手順はその CLI の分だけが返る。**未指定で呼ばれた場合は
手順を返さず、利用者に確認するよう促す**。頼んだ CLI とエージェントに使わせたい CLI は別のことがあるので、
呼び出し側に選ばせない(未指定のまま手順を返すと、本文で先に出てくる方で進めてしまう)。

手順の本文は [public/agent/agent-setup-guide.md](../public/agent/agent-setup-guide.md)。
CLI 別の記述は `<!-- cli:claude -->` … `<!-- /cli -->` で囲んであり、プレースホルダーの置換と
ブロックの絞り込みは [src/lib/agent/agent-setup.ts](../src/lib/agent/agent-setup.ts) で行う。
URL はサーバー自身のものが埋め込まれる。

## 詰まったときに見る場所

| 症状                                         | 見るところ                                                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 管理画面の自動運用が「オフライン」のまま     | cron が動いているか、`.devuntu-agent/agent.log`                                                                                                      |
| 実行履歴が「失敗」ばかり                     | 履歴の「内容」に終了コードと標準エラーの末尾が入っている                                                                                             |
| 実行が「実行中」で止まる                     | エージェントが `finish_agent_task` を呼べていない。60分で失敗へ落ちる                                                                                |
| チケットが拾われない                         | 担当がエージェントか / チケットの「エージェント」が「任せない」でないか / ステータスが完了でないか                                                   |
| `/api/agent/status` が 401                   | トークンの再発行で古くなっていないか(1エージェント1本なので再発行は置き換え)                                                                         |
| ランナーの自動更新に失敗しているか確認したい | `.devuntu-agent/agent.log` の warning(「最新版の取得に失敗した」等)を確認する。手動で更新したい場合はセットアップ手順4の `curl` コマンドを再実行する |
| Slack へ実行結果が届かない                   | ボード設定の「Slack通知」でチャンネルが選ばれているか / 対象チャンネルに Bot が招待されているか(`/invite @Devuntu`)/ `SLACK_BOT_TOKEN`。詳細は [notifications.md](notifications.md#エージェント実行結果のチャンネル通知) |
