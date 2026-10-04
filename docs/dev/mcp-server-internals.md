- [MCP サーバーの仕組み(開発者向け)](#mcp-サーバーの仕組み開発者向け)
  - [認証の振り分け](#認証の振り分け)
  - [ツールの登録](#ツールの登録)
  - [クライアントへの案内](#クライアントへの案内)
  - [入力の約束ごと](#入力の約束ごと)
  - [ボードの AI 向けコンテキスト](#ボードの-ai-向けコンテキスト)
  - [チケットテンプレート](#チケットテンプレート)
  - [長期トークンの保存](#長期トークンの保存)
  - [AIエージェント用ユーザーのメールアドレス](#aiエージェント用ユーザーのメールアドレス)
  - [画像の添付](#画像の添付)
  - [登録できるクライアントの範囲](#登録できるクライアントの範囲)

# MCP サーバーの仕組み(開発者向け)

MCP サーバーの認証の振り分け・ツールの入力仕様・実装上の判断をまとめる。
クライアントの登録手順(利用者向け)は [ai.md](../guide/ai.md#aiツールからつなぐmcp)、公開設定とトークンの運用(運用者向け)は
[mcp-server.md](../admin/mcp-server.md)、ツールの一覧は [mcp-tools.md](mcp-tools.md) を参照。
エージェント専用のツールの詳細は [agent-runner-internals.md](agent-runner-internals.md#エージェント専用の-mcp-ツール) にある。

## 認証の振り分け

`/api/mcp` が受け取る `Authorization: Bearer` は接頭辞で見分ける。

| 接頭辞           | 扱い                                  | 実装                              |
| ---------------- | ------------------------------------- | --------------------------------- |
| `devuntu_agent_` | エージェントトークン                  | `src/lib/agent/agent-token.ts`    |
| `devuntu_pat_`   | ユーザーが自分で発行した MCP トークン | `src/lib/mcp/mcp-token.ts`        |
| どちらでもない   | OAuth のアクセストークン(JWT)         | `src/lib/oauth/oauth-resource.ts` |

- 検証を通った後は同じ `ResourceAuth` になるため、ツールの実装と権限判定は完全に共通
- `/api/mcp` はトークンの `sub` から devuntu ユーザーを解決する
- クライアントへ返す MCP サーバー名(`serverInfo.name`)は `auth.kind` に応じて出し分けている(`src/lib/mcp/mcp-server.ts`)。
  人間は経路によらず `devuntu`、AIエージェントは `devuntu-agent` を名乗るので、`claude mcp list` の表示や登録コマンドの時点で
  自動運用の経路を取り違えにくい

## ツールの登録

登録は `src/lib/mcp/mcp-server.ts` で `auth.kind` ごとに切り替える。

- 共通のツールと画像の添付のツールは、接続の種類を問わず登録する。人間の2経路は登録するツールも権限も同じ
- `report_acceptance_criteria` は人間の経路だけ。エージェントは受け入れ条件の結果を `finish_agent_task` の `criteria` で
  申告するので、一覧に出すと誤用のもとになる
- `get_agent_task` / `finish_agent_task` / `propose_child_tickets` はエージェント用トークンの接続だけ(`src/lib/mcp/mcp-agent.ts`)。
  人間の MCP クライアントには関係が無く、一覧に出しても誤用のもとにしかならない
- MCP 経由の追加の権限制限は `src/lib/board/ticket-permission.ts` の `canMcpUpdateTicket` / `canMcpDeleteTicket`
  - `canMcpUpdateTicket` で弾いたときは `TICKET_ASSIGNED_TO_OTHER`(`src/lib/mcp/mcp-ticket.ts`)。関係への掛け方は
    `src/lib/board/ticket-relation.ts` の `authorizeRelation`(親子は子、関連はどちらか一端)

ツールの title / description・入力の説明・サーバーの instructions・エラーメッセージなど、MCP 経由で返す文字列は
英語に統一している。読むのは主に AI エージェントで、接続時に一度だけ渡すものなのでロケールでは切り替えない。

## クライアントへの案内

利用者がルールを書かなくても、チケットに対応するときに plan / report のコメントと成果物の紐付けを
使ってもらえるよう、サーバーから手順を伝える(文言は `src/lib/mcp/mcp-instructions.ts` の1か所)。
クライアントによって届く経路が違うので、同じ手順を3か所に載せている。

| 経路                             | 内容                                                                                    | 効くクライアント                      |
| -------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------- |
| 初期化応答の `instructions`      | 手順の全文                                                                              | Claude Code(システムプロンプトに入る) |
| ツールの description             | `get_ticket` / `create_ticket` / `update_ticket` / `add_ticket_comment` に要点を1文ずつ | どのクライアントでも                  |
| `get_ticket` の応答の `workflow` | 手順の全文。チケットを編集できる人の経路のときだけ返す                                  | どのクライアントでも(Codex など)      |

手順は、着手時に status を `doing` にする → 方針を `type=plan` で投稿 → 確認事項は通常コメント →
ブランチ / PR / コミットを `link_ticket_artifact` で紐付け → 完了時に受け入れ条件の結果を `report_acceptance_criteria` で記録 →
`type=report` で報告、の順。
あくまで既定値で、利用者の指示やプロジェクトのルール(CLAUDE.md / AGENTS.md など)があればそちらを優先させる。
読むだけ・質問に答えるだけの依頼ではコメントもステータス変更もしない。

チケットを作成・更新するときは、完了条件(Done の定義・確認項目)を本文(`content`)に書かず、
検証できる1文ずつ受け入れ条件(`acceptanceCriteria`)に入れるよう伝える。これは人・エージェントの両方の経路の
`instructions` と、`create_ticket` / `update_ticket` の description・`content` / `acceptanceCriteria` の入力説明に載せる。
各受け入れ条件を満たしたかは `type=report` の本文に並べさせず、`report_acceptance_criteria` でチケットの自己申告として記録させる
(`add_ticket_comment` の description にも添える)。

エージェント用トークンの接続では、ステータス変更の手順を載せず `workflow` も返さない。
自動運用の流れはランナーの指示と `get_agent_task` の rule が持つため([agent-runner-internals.md](agent-runner-internals.md))。

## 入力の約束ごと

- 各ツールの `inputSchema` は `z.strictObject` で登録し、定義に無い引数はエラーにする(JSON Schema に `additionalProperties: false` が出る)。
  生の shape を渡すと SDK が strip の `z.object` に包み、`content` のつもりの `description` などが黙って捨てられて空のチケットができるため
- `ticketId` は**表示ID(例: ABC-42)でもチケットIDでも**受け取れる(`resolveTicketId`)。
  `commentId` と `assigneeId` は UUIDv7 のみ
- `boardId` は**ボードID でもボードキー(例: ABC)でも**受け取れる(`resolveBoardId`)。
  キーは全ボード一意で、UUIDv7 は `BOARD_KEY_PATTERN`(大文字英数)に一致しないため取り違えない。
  ただし `search_tickets` の絞り込みでは未知のキーもエラーにせず0件を返す
  (エラーと0件の差でアクセスできないボードの存在を判定できないようにするため)
- `create_ticket` / `update_ticket` の `acceptanceCriteria` は受け入れ条件。作成時は文言の配列、更新時は全件の置き換えで、
  既存の項目は `get_ticket` の `acceptanceCriteria` の `id` を付けて渡すと確認状態を引き継ぐ(文言を変えた項目は未確認に戻り、
  一覧に含めなかった項目は消える)。
- `get_ticket` のコメントには種別(`type`)と、承認 / 差し戻しボタンから投稿された返信の判定(`decision`)が付く。
- `create_ticket` の `assigneeId` / `tagIds` は `get_board` が返すメンバー・タグの ID を使う。
  他ボードのタグは付けられず、メンバー以外は担当者にできない
- `search_tickets` の `assignee` は ユーザーID / `me`(自分) / `none`(未割り当て)。`limit` は既定20・最大50
- `search_tickets` の `relatedTo` は表示ID。`relation` は `child`(直下の子) / `related`(関連) / `all`(両方。既定)
- 親子・関連は**同じボードのチケット同士だけ**。`parentId` / `relatedTicketId` は表示ID・チケットID・番号だけ(`12`)のいずれでも受け、
  別ボードや存在しないチケット、自分自身は `RELATION_TARGET_INVALID`、既にある関連は `RELATION_ALREADY_EXISTS` になる
- `update_ticket` の `parentId` は `null` で親を外す。親は1つだけで、別の親を指定すると置き換わる。
  `childOrder` は親の下での順番(1〜999)で、同じ値の子は番号順に並ぶ。省略すると兄弟の末尾に入る。
  画面で子を並べ替えると、兄弟全体が1から振り直される(同じ順番のまとまりは保ち、動かした子だけが単独の順番になる)。
  親が無い(外す)のに `childOrder` だけを渡すとエラーになる
- `get_ticket` の `attachmentKeys` は本文・コメントに貼られた画像のキーで、`get_image` で中身を見られる。
  `canEdit` / `canDelete` は画面での編集・削除の可否(MCP 経由の追加の制限は含まない)
- `get_ticket` の `parent` / `children` / `related` は直下の1階層だけを返す(親の親や孫は含めない)。
  `children` は順番(`order`)の昇順で、`childProgress` に完了した子の数と子の数が入る。外すときは各要素の `relationId` を使う
- `get_ticket` の `childAdvance` は親として持つ「子が次の順番へ進む条件」(`done` / `reported`)で、`update_ticket` で変えられる。
  `waitingForSiblings` はそのチケットが前の順番の兄弟を待っている(エージェントが拾わない)かどうか。
  コメントの `proposal` には、エージェントが `propose_child_tickets` で付けた子チケットの起票案が入る
- `dueDate` は `YYYY-MM-DD`。`null` を渡すと解除、省略すると変更しない。`assigneeId` と `tagIds` も同じ扱い
- 文字数は画面と共通(`src/lib/schema/schema-ticket.ts`)。タイトル120文字、本文・コメント40000文字、タグは10個まで
- `add_ticket_comment` の `type` は `plan`(対応プラン) / `report`(対応報告)。指定すると詳細画面で
  折りたたみ表示され、通常コメントと区別できる。`parentId` での返信は**1階層のみ**
- `link_ticket_artifact` の `url` は次のいずれか。種別は URL から判定し、同じものを2回登録しても1件にまとまる
  - GitHub: `https://github.com/<owner>/<repo>/` に続く `pull/<番号>` / `tree/<ブランチ名>` / `commit/<SHA>`
  - GitLab: `<インスタンスの URL>/<プロジェクトのパス>/-/` に続く `merge_requests/<番号>` / `tree/<ブランチ名>` / `commit/<SHA>`。
    インスタンスはサーバーの `GITLAB_URLS` に書いたものだけ
- `get_ticket` の `links` に、紐付けた一覧が `provider`(`github` / `gitlab`)、PR の状態(`prState`)、CI の結果(`ci`)付きで返る。
  状態と CI はボードに対応付けたリポジトリの Webhook で更新される([user-guide.md](../guide/user-guide.md) の「関連リンク」)
- `get_ticket` の `activities` に、直近20件の変更履歴が新しい順で返る。各要素は `field`(`created` / `title` / `content` /
  `status` / `priority` / `dueDate` / `assignee` / `tags` / `criteria`)、`actorName`、`source`(`user` / `merge`)、
  `before` / `after`、`createdAt`。`before` / `after` は要約で、担当・タグは名前、本文は先頭100文字の抜粋、
  受け入れ条件は消した / 足した文言(改行区切り)。`source=merge` は PR / MR のマージによる自動完了で、`actorName` は空になる

## ボードの AI 向けコンテキスト

ボード設定の「AI向けコンテキスト」は `Board.aiContext`(Markdown・8000文字まで)に持つ。
編集できるのはボードの `owner` と管理者(プライベートボードは所有者だけ)で、空欄で保存すると未設定になる。

| ツール           | 載る場所            | 条件                                                          |
| ---------------- | ------------------- | ------------------------------------------------------------- |
| `get_ticket`     | `boardContext`      | チケットのボードのメンバー(直接 / グループ経由)のときだけ     |
| `get_board`      | `boardContext`      | `get_board` 自体がメンバー限定                                |
| `get_agent_task` | `task.boardContext` | `ticketId` を指定し、エージェントがボードのメンバーのときだけ |

- 未設定のボードでは項目ごと載せない(既存の応答は変わらない)
- ボードのメンバーでない承認者は `get_ticket` でチケットを読めても `boardContext` は返らない(関連チケットと同じ扱い)
- 読み方(着手前に読み、チケットに別の指示が無ければ従う)は `instructions` とツールの description で伝える
- MCP resources としては公開していない(ツールの応答で届くため)
- エージェント単位の指示(`AgentRunner.rule`)との分担は [agent-runner-internals.md](agent-runner-internals.md#ルールとボードの-ai-向けコンテキスト) を参照

## チケットテンプレート

ボード設定の「チケットテンプレート」は `TicketTemplate`(1ボード20件まで)に持つ。
`get_board` の `templates` に `id` / `name` / `content` / `acceptanceCriteria` / `tagIds` / `priority` で載る
(テンプレートが無いボードでは項目ごと載せない)。

- `create_ticket` の `templateId` にテンプレートの ID か名前を渡すと、**明示した項目を優先**し、
  省略した `content` / `acceptanceCriteria` / `tagIds` / `priority` だけをテンプレートで埋めて作成する
  (空文字・空配列も明示として扱う)。件名(`title`)は常に必須
- `priority` はテンプレートにも無ければ `medium`、`tagIds` は空。`templateId` を渡さなければ従来と同じ既定値になる
- テンプレートの `tagIds` は、ボードから削除されたタグを除いて返す・適用する
- 他ボードのテンプレートや存在しないテンプレートを指定するとエラーになり、チケットは作られない
- 作成したチケットとテンプレートの紐付けは持たない(後からテンプレートを変えても既存のチケットは変わらない)

## 長期トークンの保存

ユーザーの MCP トークン(`src/lib/mcp/mcp-token.ts`)とエージェントトークン(`src/lib/agent/agent-token.ts`)に共通する作り。

- 平文は発行時の応答にしか現れず、DB には SHA-256 のハッシュと末尾6文字(見分け用)だけを保存する
- 最終利用日時を持つが、リクエストごとの書き込みを避けるため 5 分間隔でしか更新しない
- ユーザー(エージェント)を削除するとトークンも一緒に消える(外部キーの Cascade)
- ユーザーの BAN で、そのユーザーのトークンはまとめて無効になる

ユーザーの MCP トークン固有の点。

- 名前の一意は `McpToken` の `@@unique([userId, name])` で担保する。1ユーザー最大10本
- 失効は行の削除なので即時
- 発行時のセッションの新しさ(`SESSION_FRESH_AGE`)の判定は `src/lib/auth/session-fresh.ts`。
  セッションより長生きする資格情報なので、パスキーの登録と同じ扱いにしている

エージェントトークン固有の点。

- **1エージェントにつき1本**を `AgentToken.userId` の unique 制約で担保しており、発行は常に既存トークンの置き換え(ローテート)になる

## AIエージェント用ユーザーのメールアドレス

AIエージェント用ユーザーは `User.isAgent` が立ったユーザーで、Web ログインは経路を問わず
`databaseHooks.session.create.before` で拒否する。

メールアドレスは `<識別子>@agents.invalid` を作成時に自動生成する。`User.email` は better-auth の必須列であり、
本文のメンション(`@[アドレス]`)を userId へ解決するキーでもあるため省略できない。

実在アドレスを入れられない作りにしているのは次の2点を防ぐため。

- `accountLinking` により、同じメールの Google / OIDC ログインがエージェントのユーザーへ吸い寄せられ、
  Web ログイン拒否と相まって本人がログインできなくなる
- 通知は既定 OFF のオプトインだが、DB を直接触れば実在アドレスへメールが飛ぶ余地が残る

`.invalid` は RFC 2606 の予約 TLD なので名前解決されない。

## 画像の添付

- 添付先のボードを省略させないのは、ボードに属さない添付は全ログインユーザーが読めてしまうため(MCP からは作らせない)。
  `ticketId` を指定した場合は、そのチケットを編集できることを確認してからボードを決める
- 添付の可視判定は `Attachment.boardId` で行う。本文の保存時に付け替える条件は [mcp-tools.md](mcp-tools.md#制限) を参照

アップロードトークン:

- `/api/upload` 専用(`aud` で固定)。MCP のアクセストークンや長期トークンとは相互に使えない
- 有効期限は10分。使用した `jti` を `upload_nonce` テーブルへ記録し、その一意制約で 2 回目を必ず弾く
  (記録できない場合もアップロードを断る)
- 利用する時点で BAN・ボードの所属・アーカイブを引き直すため、発行後に条件が変われば通らない
- `BETTER_AUTH_SECRET` を変更すると発行済みのものは即失効する(寿命が短いので実害は無い)

## 登録できるクライアントの範囲

DCR で受け付けるリダイレクトURIの判定(ループバックか逆ドメイン形式の private-use スキームだけ)は
`src/lib/oauth/oauth-registration.ts`。
