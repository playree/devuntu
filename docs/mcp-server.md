- [Claude Code への登録](#claude-code-への登録)
  - [サーバー環境で認証したい場合](#サーバー環境で認証したい場合)
  - [ブラウザを使わずユーザーとして登録する場合](#ブラウザを使わずユーザーとして登録する場合)
  - [エージェントとして登録する場合](#エージェントとして登録する場合)
- [認証の3経路](#認証の3経路)
- [誰が使えるか](#誰が使えるか)
- [ツール一覧](#ツール一覧)
  - [共通のツール](#共通のツール)
  - [エージェント専用のツール](#エージェント専用のツール)
  - [入力の約束ごと](#入力の約束ごと)
- [ユーザーの MCP トークン](#ユーザーの-mcp-トークン)
- [AIエージェント用ユーザー](#aiエージェント用ユーザー)
  - [メールアドレス](#メールアドレス)
  - [エージェントトークンの運用](#エージェントトークンの運用)
  - [自動運用のツール](#自動運用のツール)
- [画像の添付](#画像の添付)
- [登録できるクライアントの範囲](#登録できるクライアントの範囲)
- [運用上の注意](#運用上の注意)

# MCP サーバー

`/api/mcp` を MCP クライアント(Claude Code / VS Code など)へ公開しており、Devuntu 自身が認可サーバーを
兼ねるため、クライアントは接続時に動的クライアント登録(DCR)→ 認可コードフローの順で進む。
利用するには管理者が `OIDC_DCR_ENABLED=true` を設定している必要がある。

ブラウザを持たない**AIエージェント**は認可コードフローを踏めないため、管理画面で発行する
長期トークンで接続する。人間も、CI やサーバーなどブラウザを開けない環境からは
`/account` で自分用の MCP トークンを発行して接続できる。

## Claude Code への登録

```sh
claude mcp add --transport http devuntu <BETTER_AUTH_URL>/api/mcp
```

ユーザースコープで登録する場合

```sh
claude mcp add --scope user --transport http devuntu <BETTER_AUTH_URL>/api/mcp
```

登録後、devuntu のツールを最初に呼び出したタイミングでブラウザが開き、DCR → 認可コードフロー(PKCE)
が始まる。ログインしていない場合はログインし、続く同意画面で許可すれば以降はリフレッシュトークンで
自動的に継続する。

- 登録状況は `claude mcp list`、削除は `claude mcp remove devuntu`
- 許可の取り消しは `/account` の「許可済みアプリ」から行える

### サーバー環境で認証したい場合

```sh
claude mcp login --no-browser devuntu
```

### ブラウザを使わずユーザーとして登録する場合

`/account` の「MCPトークン」でトークンを発行した際に表示されるコマンドをそのまま使える。
CI やサーバーなど、ブラウザを開けない環境から自分の権限で使いたい場合はこちら。

```sh
claude mcp add --scope user --transport http devuntu <BETTER_AUTH_URL>/api/mcp \
  --header 'Authorization: Bearer <発行したトークン>'
```

そのマシンで恒常的に使うトークンなので、既定はユーザースコープ(`--scope user`)にしてある。
登録名は認可コードフローの場合と同じ `devuntu`。同じサーバーへの接続方法違いなので、どちらか一方で登録する。

Codex CLI の場合は、トークンを環境変数へ置いてから登録する。

```sh
codex mcp add --url <BETTER_AUTH_URL>/api/mcp --bearer-token-env-var DEVUNTU_MCP_TOKEN devuntu
```

```sh
export DEVUNTU_MCP_TOKEN='<発行したトークン>'   # .bashrc / .zshrc などに残す
```

Codex は設定ファイルにトークンそのものを書けない(`mcp_servers.<id>` が受けるのは
`bearer_token_env_var` / `http_headers` / `env_http_headers` / `http_headers_helper` で、
リテラルの `bearer_token` は無い)。接続のたびに環境変数を読むので、シェルの設定ファイルに残す必要がある。
発行画面はこの `export` 行もコピーできる形で表示する(トークンは発行時にしか見せられないため)。

### エージェントとして登録する場合

`/admin/agents` でトークンを発行した際に表示されるコマンドをそのまま使える。CLI(Claude Code / Codex CLI)を
切り替えると、その CLI 向けの登録方法が表示される。

```sh
claude mcp add --transport http devuntu-agent <BETTER_AUTH_URL>/api/mcp \
  --scope project \
  --header 'Authorization: Bearer ${DEVUNTU_AGENT_TOKEN}'
```

Codex CLI の場合は `.codex/config.toml` に次を足す。

```toml
[mcp_servers.devuntu-agent]
url = "<BETTER_AUTH_URL>/api/mcp"
bearer_token_env_var = "DEVUNTU_AGENT_TOKEN"
```

この経路ではブラウザでのログインと同意は発生しない。

トークンを設定ファイルへ直接書かず環境変数の参照にしてあるのは、自動運用のランナーが
`config.json` の `token` を `DEVUNTU_AGENT_TOKEN` として CLI へ渡すため
([agent-runner.md](agent-runner.md#トークンの渡り方))。トークンの在処が 1 箇所になり、
再発行時に直す場所も 1 箇所で済む。人が手動で使う場合は、環境変数を export してから CLI を起動する。

## 認証の3経路

`/api/mcp` が受け取る `Authorization: Bearer` は接頭辞で見分ける。`devuntu_agent_` はエージェント
トークン(`src/lib/agent/agent-token.ts`)、`devuntu_pat_` はユーザーが自分で発行した MCP トークン
(`src/lib/mcp/mcp-token.ts`)として扱い、どちらの接頭辞も持たないものだけを OAuth のアクセストークン
(JWT)として検証する(`src/lib/oauth/oauth-resource.ts`)。
検証を通った後は同じ `ResourceAuth` になるため、ツールの実装と権限判定は完全に共通。

エンドポイントは `/api/mcp` で共通だが、Claude Code へ登録する MCP サーバー名(`serverInfo.name`)は
`auth.kind` に応じて出し分けている(`src/lib/mcp/mcp-server.ts`)。人間は経路によらず `devuntu`、
AIエージェントは `devuntu-agent` を名乗るので、`claude mcp list` の表示や登録コマンドの時点で
自動運用の経路を取り違えにくい。

| 利用者         | 取得方法                           | 寿命                                      | 止め方                        |
| -------------- | ---------------------------------- | ----------------------------------------- | ----------------------------- |
| 人間(ブラウザ) | DCR → 認可コードフロー(PKCE)       | `MCP_REFRESH_TOKEN_EXPIRES_IN`(既定180日) | クライアント無効化 / BAN      |
| 人間(トークン) | `/account` の「MCPトークン」で発行 | 発行時に選択(既定90日、無期限も選べる)    | トークンの削除 / BAN          |
| AIエージェント | `/admin/agents` でトークンを発行   | 既定は無期限(発行時に任意の期限も選べる)  | トークンの再発行 / BAN / 削除 |

## 誰が使えるか

**クライアントを登録できることと、データを読めることは別**。登録しただけでは何も読めない。

- `/oauth2/authorize` は devuntu のログインを要求する。ログインできる利用者だけが認可を完了できる
- 動的登録されたクライアントは `skip_consent` を指定できないため、同意画面が必ず出る
- MCP の認証は devuntu のログインセッションから独立している。ログアウトやセッション失効(`SESSION_EXPIRES_IN`、既定5日)の
  影響を受けず、リフレッシュトークンの有効期限(`MCP_REFRESH_TOKEN_EXPIRES_IN`、既定180日)まで利用できる。
  強制的に止めたい場合は OAuth クライアントの無効化、またはユーザーの BAN で行う
- `/api/mcp` はトークンの `sub` から devuntu ユーザーを解決する。ボードやチケットの権限は画面と同じ
- ユーザーの MCP トークンは同意画面を経由しないが、本人が自分のアカウントに対して発行するものなので
  同意は自明。権限は発行した本人の画面上の権限とちょうど同じで、スコープは `mcp` に固定される

## ツール一覧

`ping` から `get_agent_setup_guide` までは接続の種類(人間 / AIエージェント)を問わず登録される。
人間の2経路(認可コードフロー / ユーザーの MCP トークン)は登録されるツールも権限も同じ。
`get_agent_task` と `finish_agent_task` だけはエージェント用トークンで接続した場合のみ登録される
(`src/lib/mcp/mcp-server.ts`)。

### 共通のツール

| ツール                  | 用途                                                                          | 入力                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ping`                  | 接続確認。認可済みユーザーのメールアドレスを返す                              | なし                                                                                           |
| `echo`                  | 入力した文字列をそのまま返す                                                  | `message`                                                                                      |
| `get_ticket`            | チケットの詳細(本文・ステータス・担当者・タグ・コメント・短縮URL)を取得       | `ticketId`                                                                                     |
| `search_tickets`        | アクセスできるチケットを検索(更新日時の降順)                                  | `keyword` / `status` / `priority` / `tags` / `boardId` / `assignee` / `limit`                  |
| `create_ticket`         | ボードにチケットを新規作成                                                    | `boardId` / `title` / `content` / `status` / `priority` / `dueDate` / `assigneeId` / `tagIds`  |
| `update_ticket`         | チケットの内容とステータスを更新                                              | `ticketId` / `title` / `content` / `priority` / `dueDate` / `assigneeId` / `tagIds` / `status` |
| `delete_ticket`         | チケットを削除                                                                | `ticketId`                                                                                     |
| `add_ticket_comment`    | コメントを追加(対応プラン・対応報告・返信もここから)                          | `ticketId` / `content` / `type` / `parentId`                                                   |
| `update_ticket_comment` | 自分が投稿したコメントを編集                                                  | `commentId` / `content`                                                                        |
| `delete_ticket_comment` | コメントを削除                                                                | `commentId`                                                                                    |
| `get_agent_setup_guide` | 自動運用(Devuntu Agent)を自分のマシンへ用意する手順を返す。人が読むためのもの | `cli`(任意。未指定なら手順ではなく CLI の選択を促す)                                          |

権限はボードのロールで決まり、基本は画面と同じ。ただしチケットの更新・削除だけは MCP 経由に
追加の制限がある(`src/lib/board/task.ts` の `canMcpUpdateTicket` / `canMcpDeleteTicket`)。

- `update_ticket` — メンバーは**他人が担当のチケットを更新できない**(未割り当てなら可能。オーナーは制限なし)
- `delete_ticket` — オーナー・メンバーともに**自分が作成したチケットのみ**削除できる(画面より厳しい)
- `delete_ticket_comment` — 自分が投稿したコメント、またはチケットを削除できる権限を持つ場合
- 本文やコメントのメンション(`@[アドレス]`)は画面から書いた場合と同じように解決され、通知も飛ぶ

### エージェント専用のツール

自動運用(Devuntu Agent)で Claude 自身が「処理してよいか」「何をするか」を確かめ、結果を書き戻すための口
(`src/lib/mcp/mcp-agent.ts`)。人間の MCP クライアントには関係が無く、一覧に出しても誤用のもとにしかならない。

| ツール              | 用途                                                                             | 入力                               |
| ------------------- | -------------------------------------------------------------------------------- | ---------------------------------- |
| `get_agent_task`    | チケットを処理する前に必ず呼ぶ。稼働条件・処理すべきチケット・ルールの指示を返す | `ticketId`(省略時は処理待ちの一覧) |
| `finish_agent_task` | 処理結果を報告して1回の実行を閉じる                                              | `ticketId` / `outcome` / `summary` |

- `get_agent_task` の応答が `active: false` の場合は、何もせず終了する(コメントの投稿もしない)
- `outcome` は `planned`(プランを投稿して返信待ち) / `completed`(対応完了) / `skipped`(見送り) / `failed`(失敗)
- 仕組みの詳細は [docs/agent-runner.md](agent-runner.md) を参照

### 入力の約束ごと

- `ticketId` は**表示ID(例: ABC-42)でもチケットIDでも**受け取れる(`resolveTicketId`)。
  `commentId` と `assigneeId` は UUIDv7 のみ
- `search_tickets` の `assignee` は ユーザーID / `me`(自分) / `none`(未割り当て)。`limit` は既定20・最大50
- `dueDate` は `YYYY-MM-DD`。`null` を渡すと解除、省略すると変更しない。`assigneeId` と `tagIds` も同じ扱い
- 文字数は画面と共通(`src/lib/schema/schema.ts`)。タイトル120文字、本文・コメント40000文字、タグは10個まで
- `add_ticket_comment` の `type` は `plan`(対応プラン) / `report`(対応報告)。指定すると詳細画面で
  折りたたみ表示され、通常コメントと区別できる。`parentId` での返信は**1階層のみ**

## ユーザーの MCP トークン

`/account` の「MCPトークン」で本人が発行する長期トークン(`src/lib/mcp/mcp-token.ts`)。
ブラウザを開けない環境から、自分の権限で MCP を使うための経路。

- **1ユーザーにつき最大10本**。用途を見分けるための名前を付けて発行し、名前は本人の中で一意
  (`McpToken` の `@@unique([userId, name])`)
- 発行にはログインからの経過時間が `SESSION_FRESH_AGE`(既定24時間)未満であることを要求する
  (`src/lib/auth/session-fresh.ts`)。古いセッションからは再認証を挟む。セッションより長生きする
  資格情報なので、パスキーの登録と同じ扱いにしている
- 平文は発行時の応答にしか現れず、DB には SHA-256 のハッシュと末尾6文字(見分け用)だけを保存する。
  紛失した場合は削除して発行し直す
- 期限は発行時に選ぶ。既定は90日で、無期限も選べる
- 失効は一覧からの削除(行を消すので即時)。恒久的に止めたい場合はユーザーの BAN で、
  そのユーザーの全トークンがまとめて無効になる
- 最終利用日時を持つが、リクエストごとの書き込みを避けるため 5 分間隔でしか更新しない。
  一覧の値は最大5分ぶん古くなりうる
- ユーザーを削除するとトークンも一緒に消える(外部キーの Cascade)
- 自動運用のツール(`get_agent_task` / `finish_agent_task`)は登録されない。
  ランナー向けの `/api/agent/*` もエージェントトークン専用なので、このトークンでは使えない

## AIエージェント用ユーザー

`User.isAgent` が立ったユーザー。Web ログインは経路を問わず拒否され(`databaseHooks.session.create.before`)、
MCP からのみ利用できる。ボードやチケットの権限は人間の利用者とまったく同じで、ボードのメンバーに
加えれば担当者として選択でき、メンションの宛先にもなる。

### メールアドレス

`<識別子>@agents.invalid` を作成時に自動生成する。`User.email` は better-auth の必須列であり、
本文のメンション(`@[アドレス]`)を userId へ解決するキーでもあるため省略できない。

実在アドレスを入れられない作りにしているのは次の2点を防ぐため。

- `accountLinking` により、同じメールの Google / OIDC ログインがエージェントのユーザーへ吸い寄せられ、
  Web ログイン拒否と相まって本人がログインできなくなる
- 通知は既定 OFF のオプトインだが、DB を直接触れば実在アドレスへメールが飛ぶ余地が残る

`.invalid` は RFC 2606 の予約 TLD なので名前解決されず、メールは届かない。
識別子は**作成後に変更できない**(変えると保存済み本文のメンションが解決できなくなる)。

### エージェントトークンの運用

- **1エージェントにつき1本**。`AgentToken.userId` の unique 制約で担保しており、発行は常に
  既存トークンの置き換え(ローテート)になる。再発行した時点で、前のトークンを使っている接続は
  すぐに利用できなくなる
- 平文は発行時の応答にしか現れず、DB には SHA-256 のハッシュと末尾6文字(見分け用)だけを保存する。
  紛失した場合は再発行するしかない
- 期限は既定で無期限。発行時に 30 / 90 / 180 / 365 日も選べる
- 恒久的に止めたい場合はエージェントユーザーの BAN か削除で行う
- 最終利用日時を持つが、リクエストごとの書き込みを避けるため 5 分間隔でしか更新しない。
  一覧の値は最大5分ぶん古くなりうる
- エージェントを削除するとトークンも一緒に消える(外部キーの Cascade)

### 自動運用のツール

エージェント用トークンで接続した場合だけ、自動運用(Devuntu Agent)のツール
(`get_agent_task` / `finish_agent_task`)が追加で登録される。
一覧は [エージェント専用のツール](#エージェント専用のツール)、仕組みの詳細は
[docs/agent-runner.md](agent-runner.md) を参照。

## 画像の添付

チケット本文やコメントへ画像を貼るには、まず画像を保存して `/api/upload/<キー>.webp` を受け取り、
その URL を `![説明](URL)` の Markdown 記法で `content` に書く。本文の更新は既存のチケット系ツールで行うので、
画像専用の投稿ツールは無い。生の `<img>` タグは表示時に除去されるため使えない。

| ツール                      | 用途                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `create_image_upload_token` | 使い捨てのアップロードURLとトークンを発行する。ファイルを送る主経路        |
| `upload_image`              | base64 を直接渡す。シェルを実行できないクライアント向けの退避手段          |
| `get_image`                 | 保存済みの画像を取得して画像として返す。貼られたスクショを見たいときに使う |

添付先のボードは `ticketId`(表示IDでも可)か `boardId` の**どちらか一方**で指定する。省略はできない
(ボードに属さない添付は全ログインユーザーが読めてしまうため、MCP からは作らせない)。
`ticketId` を指定した場合は、そのチケットを編集できることを確認してからボードを決める。

### ファイルを直接送る(推奨)

`create_image_upload_token` が返す curl をそのまま実行し、返った URL を本文へ書く。

```sh
curl -sS -X POST <BETTER_AUTH_URL>/api/upload \
  -H "Authorization: Bearer <発行されたトークン>" \
  -F "file=@./shot.png"
# => {"url":"/api/upload/019e....webp"}
```

### base64 で送る

`upload_image` は画像の base64 をツールの引数として渡す。モデルがその文字列を生成することになり
コンテキストを激しく消費するので、ファイルのパスが分かる場合は使わないこと。data は 512KB まで。

### 制限

- 画像は 5MB まで、形式は JPEG / PNG / WebP / GIF。形式は申告された Content-Type ではなく実データで判定する
- 保存時に長辺 2000px の webp へ変換する。`get_image` は既定で長辺 1024px まで縮めて返す(`maxSize` で変更可)
- 添付を読めるのは貼り付け先ボードのメンバーだけ(`Attachment.boardId` の可視判定)。
  本文の保存時に付け替わるのは、**自分がアップロードした添付のうち、まだどの本文からも使われていないもの**だけ。
  既に別のボードの本文で使っている画像を貼り直しても付け替えは起きないので(元の本文が読めなくなるため)、
  その画像は貼り直した先では元のボードのメンバーにしか見えない

### アップロードトークン

- `/api/upload` 専用(`aud` で固定)。MCP のアクセストークンや長期トークンとは相互に使えない
- 有効期限は10分。使用した `jti` を `upload_nonce` テーブルへ記録し、その一意制約で 2 回目を必ず弾く
  (記録できない場合もアップロードを断る)
- 利用する時点で BAN・ボードの所属・アーカイブを引き直すため、発行後に条件が変われば通らない。
  アーカイブ済みボードへは添付できない
- `BETTER_AUTH_SECRET` を変更すると発行済みのものは即失効する(寿命が短いので実害は無い)

## 登録できるクライアントの範囲

`POST /api/auth/oauth2/register` は未認証で叩けるが、リダイレクトURIが**ループバック
(`http://localhost` / `127.0.0.1` / `[::1]`)か逆ドメイン形式の private-use スキーム**のものだけを
受け付ける(`src/lib/oauth/oauth-registration.ts`)。認可コードが必ず利用者自身の端末へ戻るので、
外部サーバーへコードを流すクライアントは登録できない。PKCE は常に必須。

## 運用上の注意

- クライアントは利用者ごとではなく**MCP クライアントのインストールごと**に登録される。
  同じ人でも端末が2台あれば2行、設定を消して再追加すればさらに増える
- 増えた行は `/admin/oidc-clients` の「動的登録」セクションから無効化・削除できる。
  無効化は新しい認可を止め、削除は発行済みトークンと同意も一緒に消す(外部キーの Cascade)
- 利用者本人は `/account` の「許可済みアプリ」から自分の許可を取り消せる
- MCP はリソース(RFC 8707)として `<BETTER_AUTH_URL>/api/mcp` を持つ。
  リソースにリンクされたクライアントだけがこのトークンを取れるので、既存の OIDC ログイン用
  クライアントは MCP を使えない。ただし管理画面から新しく作るクライアントはリンクされる
