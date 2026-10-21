- [MCP ツールのリファレンス(開発者向け)](#mcp-ツールのリファレンス開発者向け)
  - [ツール一覧](#ツール一覧)
    - [共通のツール](#共通のツール)
    - [人間の経路専用のツール](#人間の経路専用のツール)
    - [エージェント専用のツール](#エージェント専用のツール)
    - [ボードの AI 向けコンテキスト](#ボードの-ai-向けコンテキスト)
    - [ボードノート(ナレッジ / メモリ)](#ボードノートナレッジ--メモリ)
    - [チケットテンプレート](#チケットテンプレート)
  - [画像の添付](#画像の添付)
    - [ファイルを直接送る(推奨)](#ファイルを直接送る推奨)
    - [base64 で送る](#base64-で送る)
    - [制限](#制限)

# MCP ツールのリファレンス(開発者向け)

MCP サーバー(`/api/mcp`)が提供するツールと、その権限・入力の要点をまとめる。
つなぎ方と使い方(利用者向け)は [ai.md](../guide/ai.md)、公開設定とトークンの運用(運用者向け)は
[mcp-server.md](../admin/mcp-server.md)、認証の振り分けや入力の細かな仕様の実装は
[mcp-server-internals.md](mcp-server-internals.md) を参照。

## ツール一覧

[共通のツール](#共通のツール)と、[画像の添付](#画像の添付)の `create_image_upload_token` / `upload_image` / `get_image` は
接続の種類(人間 / AIエージェント)を問わず使える。
人間の2経路(認可コードフロー / ユーザーの MCP トークン)は使えるツールも権限も同じ。
`report_acceptance_criteria` は人間の経路でだけ、`get_agent_task` / `finish_agent_task` / `propose_child_tickets` はエージェント用トークンで
接続した場合だけ使える。

ツールの説明・エラーメッセージなど MCP 経由で返す文字列は英語。下の表の「用途」は日本語での要約。
入力の細かな仕様(受け付ける ID の形式、文字数、親子の順番など)は
[mcp-server-internals.md](mcp-server-internals.md#入力の約束ごと) を参照。

### 共通のツール

| ツール                   | 用途                                                                                                                                                                                            | 入力                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ping`                   | 接続確認。認可済みユーザーのメールアドレスを返す                                                                                                                                                | なし                                                                                                                                                               |
| `echo`                   | 入力した文字列をそのまま返す                                                                                                                                                                    | `message`                                                                                                                                                          |
| `list_boards`            | アクセスできるボードの一覧。チケットを作る前に対象ボードを特定する                                                                                                                              | `includeArchived`(任意)                                                                                                                                            |
| `get_board`              | ボードの詳細(メンバー・タグ・ステータス別のチケット件数・AI向けコンテキスト・チケットテンプレート・マージによる自動完了の設定)                                                                  | `boardId`                                                                                                                                                          |
| `get_ticket`             | チケットの詳細(本文・ステータス・担当者・タグ・受け入れ条件・コメント・親子・関連・紐付け・変更履歴・短縮URL・ボードのAI向けコンテキスト・マージによる自動完了の設定・貼られた画像のキー)を取得 | `ticketId`                                                                                                                                                         |
| `search_tickets`         | アクセスできるチケットを検索(更新日時の降順)                                                                                                                                                    | `keyword` / `status` / `priority` / `tags` / `boardId` / `assignee` / `relatedTo` / `relation` / `limit`                                                           |
| `create_ticket`          | ボードにチケットを新規作成                                                                                                                                                                      | `boardId` / `title` / `templateId` / `content` / `status` / `priority` / `dueDate` / `assigneeId` / `tagIds` / `acceptanceCriteria` / `parentId` / `childOrder`    |
| `update_ticket`          | チケットの内容とステータスを更新                                                                                                                                                                | `ticketId` / `title` / `content` / `priority` / `dueDate` / `assigneeId` / `tagIds` / `status` / `acceptanceCriteria` / `parentId` / `childOrder` / `childAdvance` |
| `delete_ticket`          | チケットを削除                                                                                                                                                                                  | `ticketId`                                                                                                                                                         |
| `add_ticket_comment`     | コメントを追加(対応プラン・対応報告・返信もここから)                                                                                                                                            | `ticketId` / `content` / `type` / `parentId`                                                                                                                       |
| `update_ticket_comment`  | 自分が投稿したコメントを編集                                                                                                                                                                    | `commentId` / `content`                                                                                                                                            |
| `delete_ticket_comment`  | コメントを削除                                                                                                                                                                                  | `commentId`                                                                                                                                                        |
| `link_ticket_artifact`   | GitHub / GitLab のブランチ / プルリクエスト / コミットの URL をチケットに紐付ける                                                                                                               | `ticketId` / `url`                                                                                                                                                 |
| `unlink_ticket_artifact` | 紐付けを外す                                                                                                                                                                                    | `linkId`                                                                                                                                                           |
| `link_related_ticket`    | 同じボードのチケット同士を関連付ける(向きなし)                                                                                                                                                  | `ticketId` / `relatedTicketId`                                                                                                                                     |
| `unlink_ticket_relation` | 親子・関連を外す                                                                                                                                                                                | `relationId`                                                                                                                                                       |
| `get_board_notes`        | ボードノート(ナレッジ / メモリ)の本文を名前で読む。名前を渡さなければ索引をキーワード・区分で検索する                                                                                           | `boardId` / `names` / `keyword` / `kind`                                                                                                                           |
| `save_board_note`        | ボードノートを名前で作成・更新する(渡した項目だけ変える)。区分の変更で昇格 / 降格                                                                                                               | `boardId` / `name` / `kind` / `type` / `description` / `content` / `newName` / `expectedUpdatedAt` / `ticketId` / `userApproved`                                   |
| `delete_board_note`      | ボードノートを削除する(履歴から復元できる)                                                                                                                                                      | `boardId` / `name` / `ticketId` / `userApproved`                                                                                                                   |
| `get_agent_setup_guide`  | 自動運用(Devuntu Agent)を自分のマシンへ用意する手順を返す。人が読むためのもの                                                                                                                   | `cli`(任意。未指定なら手順ではなく CLI の選択を促す)                                                                                                               |

権限はボードのロールで決まり、基本は画面と同じ。ただしチケットの更新・削除だけは MCP 経由に追加の制限がある。

- `update_ticket` — メンバーは**他人が担当のチケットを更新できない**(未割り当てなら可能。オーナーは制限なし)
- `delete_ticket` — オーナー・メンバーともに**自分が作成したチケットのみ**削除できる(画面より厳しい)
- `delete_ticket_comment` — 自分が投稿したコメント、またはチケットを削除できる権限を持つ場合
- 本文やコメントのメンション(`@[アドレス]`)は画面から書いた場合と同じように解決され、通知も飛ぶ
- `link_ticket_artifact` / `unlink_ticket_artifact` — コメントの投稿と同じく、チケットを編集できれば使える
- `link_related_ticket` / `unlink_ticket_relation` — `update_ticket` と同じ制限を受ける。親子は子のチケットで判定し、
  関連はどちらか一方のチケットで満たせばよい(自分が担当のチケットを、他人が担当のチケットへ関連付けられる)
- これらの制限で更新を弾いた場合は、他人が担当のチケットであることが分かるメッセージのエラーを返す
- `save_board_note` / `delete_board_note` — ナレッジに関わる変更(作成・更新・削除・昇格 / 降格)は、
  人の経路では `userApproved: true` が要り、エージェント経路ではできない([ボードノート](#ボードノートナレッジ--メモリ))

チケットに対応するときの手順(着手時に対応中にする → プランを投稿 → 成果物を紐付け → 受け入れ条件の結果を記録 → 報告を投稿)は、
利用者がルールを書かなくてもサーバーからクライアントへ伝える。利用者の指示・チケットの内容・プロジェクトのルール(CLAUDE.md / AGENTS.md など)・
ボードの AI 向けコンテキストに別のやり方があればそちらが優先される。伝え方は [mcp-server-internals.md](mcp-server-internals.md#クライアントへの案内) を参照。

### 人間の経路専用のツール

OAuth / ユーザーの MCP トークンで接続した場合だけ使える
(エージェントは受け入れ条件の結果を `finish_agent_task` で申告する)。

| ツール                       | 用途                                                 | 入力                    |
| ---------------------------- | ---------------------------------------------------- | ----------------------- |
| `report_acceptance_criteria` | 受け入れ条件ごとの充足と根拠を自己申告として記録する | `ticketId` / `criteria` |

- `update_ticket` と同じ制限を受ける。`criteria` の `id` は `get_ticket` の `acceptanceCriteria` から取り、
  各項目の充足(`met`)と根拠(`evidence`)がチケット詳細に自己申告として表示される。報告しなかった項目は前回の申告のまま残り、
  そのチケットに無い id を含む場合は何も記録せずエラーになる
- まだ行っていない作業(マージ後のタグ打ちなど)は `met=false` で報告するよう、description で伝えている

### エージェント専用のツール

自動運用(Devuntu Agent)で AIエージェント自身が使うツール。エージェント用トークンで接続した場合だけ使え、
人間の MCP クライアントの一覧には出ない。

| ツール                  | 用途                                                                             |
| ----------------------- | -------------------------------------------------------------------------------- |
| `get_agent_task`        | チケットを処理する前に必ず呼ぶ。稼働条件・処理すべきチケット・ルールの指示を返す |
| `finish_agent_task`     | 処理結果を報告して1回の実行を閉じる                                              |
| `propose_child_tickets` | 子チケットの起票案付きのプランを投稿する                                         |

- エージェントが処理を始めたチケットは、`backlog` / `todo` ならサーバーが対応中(`doing`)へ移す
- 受け入れ条件が空なら、エージェントは plan の投稿時(execute は着手時)に `update_ticket` で設定する。既存の項目は削除・書き換えしない

入力と応答の詳細は [agent-runner-internals.md](agent-runner-internals.md#エージェント専用の-mcp-ツール) を参照。

### ツールの注釈(annotations)

各ツールには MCP の Tool annotations を付けている(`src/lib/mcp/mcp.ts` の `TOOL_ANNOTATIONS`)。
クライアントが確認の要否を決めるためのヒントで、権限の強制ではない(認可はサーバー側でこれまでどおり行う)。
Claude Code のプランモードは `readOnlyHint: true` のツールしか確認なしで呼ばないため、読み取りのツールだけに付ける。
devuntu の外(GitHub など)へ書き込むツールは無いので、`openWorldHint` は全ツール `false`。

MCP の仕様に合わせ、追加だけで済まない(既存の値を上書き・削除しうる)ものを destructive、
同じ入力で繰り返しても結果が変わらないものを idempotent とする。

| 分類                    | readOnly | destructive | idempotent | ツール                                                                                                                                                                         |
| ----------------------- | -------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readOnly`              | true     | -           | -          | `ping` / `echo` / `list_boards` / `get_board` / `get_ticket` / `search_tickets` / `get_image` / `get_agent_setup_guide` / `get_agent_task` / `get_board_notes`                 |
| `additive`              | false    | false       | false      | `create_ticket` / `add_ticket_comment` / `create_image_upload_token` / `upload_image` / `propose_child_tickets`                                                                |
| `additiveIdempotent`    | false    | false       | true       | `link_ticket_artifact` / `link_related_ticket`                                                                                                                                 |
| `destructive`           | false    | true        | false      | `update_ticket` / `finish_agent_task` / `save_board_note`                                                                                                                      |
| `destructiveIdempotent` | false    | true        | true       | `update_ticket_comment` / `report_acceptance_criteria` / `delete_ticket` / `delete_ticket_comment` / `unlink_ticket_artifact` / `unlink_ticket_relation` / `delete_board_note` |

- `update_ticket` は値を上書きし、`acceptanceCriteria` は全件置き換え(含めなかった項目はチェックや申告ごと消える)、
  `parentId: null` で親子を外せる。id の無い受け入れ条件は呼ぶたびに作り直されて変更履歴も残るので、冪等にもしない
- `finish_agent_task` は受け入れ条件の申告を上書きする。実行がタイムアウトで閉じられた後に繰り返すと、
  タイムアウトで付いた状態を上書きしてしまうので冪等にしない
- `update_ticket_comment` / `report_acceptance_criteria` は履歴を残さずに本文・申告を上書きする
- `link_ticket_artifact` は同じ URL なら既存の紐付けを戻すだけ、`link_related_ticket` は2回目がエラーになるだけで状態は変わらない
- `save_board_note` は既存のノートを上書きする(版は残る)。同じ内容なら版を作らないが、作成と更新を名前で兼ねるので冪等にはしない。
  `delete_board_note` は無い名前に対して `deleted: false` を返すだけなので冪等

### ボードの AI 向けコンテキスト

ボード設定の「AI向けコンテキスト」(Markdown・8000文字まで)は、対象リポジトリ・規約・用語など
そのボードのチケットに共通する前提。チケットごとに書かずに済み、人の MCP クライアントとエージェントの両方へ同じ内容が届く。

- 編集できるのはボードのオーナーと管理者(プライベートボードは所有者だけ)。空欄で保存すると未設定になる
- `get_board` / `get_ticket` / `get_agent_task` の応答に載る。届くのはボードのメンバーだけで、
  メンバーでない承認者が `get_ticket` でチケットを読めても載らない
- クライアントには、着手前に読み、チケットに別の指示が無ければ従うよう伝えている

届く条件の詳細は [mcp-server-internals.md](mcp-server-internals.md#ボードの-ai-向けコンテキスト)、
エージェント単位の指示(カスタム指示)との分担は [agent-runner-internals.md](agent-runner-internals.md#ルールとボードの-ai-向けコンテキスト) を参照。

### ボードノート(ナレッジ / メモリ)

ボード単位でメンバーと AI が共有するノート。Claude Code の個人メモリ(1件1事実・索引を常に読み、本文は必要なときに読む)をボード単位にしたもの。
AI向けコンテキストと合わせて、AI 向けの情報を3層で持つ。

| 層                 | 書く人                                    | AI への渡し方                            |
| ------------------ | ----------------------------------------- | ---------------------------------------- |
| AI向けコンテキスト | オーナー(画面のみ)                        | 常に全文(`boardContext`)                 |
| ナレッジ           | 利用者、または利用者の指示・同意を得た AI | 索引(`boardKnowledge`)。本文は必要なとき |
| メモリ             | AI が作業中に自動で(人も画面で編集できる) | 索引(`boardMemory`)。本文は必要なとき    |

- `get_board` / `get_ticket` / `get_agent_task` の応答に、索引を `"name: description"` の文字列の配列で載せる
  (JSON のキーを繰り返さずに済み、トークンが少ない)。届くのは `boardContext` と同じくボードのメンバーだけ
  - ナレッジは全件(名前順)、メモリは更新の新しい順に50件まで。載せきれなかったメモリの件数を `boardMemoryOmitted` で返す。0件の区分は項目ごと省く
- 本文は `get_board_notes` に `names`(10件まで)を渡して読む。名前を渡さなければ、索引をキーワード(名前・説明・本文)と区分で検索する
- `save_board_note` は名前で引き、あれば渡した項目だけ更新、無ければ作成する(作成時は `description` / `content` が必須。既定は `kind=memory` / `type=insight`)
  - `newName` で改名、`kind` の変更で昇格 / 降格。`expectedUpdatedAt` を渡すと、読んだ後に他の人が更新していれば競合としてエラーにする
  - `ticketId` を渡すと、どのチケットの対応中に書いたかが履歴に残る(同じボードのチケットのみ)
- 書き込みの規則

  | 経路                                     | メモリ | ナレッジ(作成・更新・削除・昇格 / 降格)  |
  | ---------------------------------------- | ------ | ---------------------------------------- |
  | 画面(メンバー、未アーカイブのボード)     | 可     | 可                                       |
  | MCP の人の経路(OAuth / ユーザートークン) | 可     | `userApproved: true` のときだけ          |
  | MCP のエージェント経路                   | 可     | 不可(昇格させたい知見は報告で提案させる) |

  `userApproved` は AI の自己申告で、ユーザーの明示的な指示・同意があるときだけ付けるよう description で伝える。
  強制ではなく、AI に意図して判断させるための歯止め。誰がどの経路で書いたかは履歴に残る

- 種別(`type`)は `convention`(規約・人からの指摘)/ `decision`(決定事項)/ `insight`(知見・ハマり所)/ `reference`(外部の参照先)。画面の絞り込み用で、索引には載せない
- 上限: 名前60文字(kebab-case・ボード内で一意)、説明150文字(改行なし)、本文はメモリ4000文字・ナレッジ20000文字。
  件数はボードあたりメモリ200件・ナレッジ100件(`BOARD_MEMORY_MAX_COUNT` / `BOARD_KNOWLEDGE_MAX_COUNT`)
- 優先度は ユーザーの指示 > チケット > boardContext > ナレッジ > メモリ。保存の規則(重複を作らず更新する・1件1テーマ・
  チケット固有の経緯や秘密情報を保存しない)は `save_board_note` の description で伝える

データの持ち方と履歴は [mcp-server-internals.md](mcp-server-internals.md#ボードノート) を参照。

### マージによる自動完了の設定

`get_board` / `get_ticket` は、マージで自動完了する provider があれば `mergeCompletion` を返す
(例: `{ "github": { "criteriaCheck": "checkedOrReported" } }`)。自動完了がオンの provider だけを載せ、1つも無ければ項目ごと載せない。

- `criteriaCheck` は完了にする前の受け入れ条件の判定(`none` / `checkedOrReported` / `checked`)。
  未達が残るとマージしても完了にならない([git-integration.md](../admin/git-integration.md#連携のオプション))
- `get_ticket` では `boardContext` と同じく、ボードのメンバーでない承認者には載せない
- `create_ticket` / `update_ticket` の `acceptanceCriteria` の description で、マージ後に残る作業も条件に入れるよう伝えている

### チケットテンプレート

ボード設定の「チケットテンプレート」(1ボード20件まで)は、本文・受け入れ条件・タグ・優先度の雛形。
`get_board` の応答に一覧が載る。

- `create_ticket` の `templateId` にテンプレートの ID か名前を渡すと、**明示した項目を優先**し、
  省略した本文・受け入れ条件・タグ・優先度だけをテンプレートで埋めて作成する。件名(`title`)は常に必須
- 他ボードのテンプレートや存在しないテンプレートを指定するとエラーになり、チケットは作られない
- 作成したチケットとテンプレートの紐付けは持たない(後からテンプレートを変えても既存のチケットは変わらない)

既定値の扱いなどの詳細は [mcp-server-internals.md](mcp-server-internals.md#チケットテンプレート) を参照。

## 画像の添付

チケット本文やコメントへ画像を貼るには、まず画像を保存して `/api/upload/<キー>.webp` を受け取り、
その URL を `![説明](URL)` の Markdown 記法で `content` に書く。本文の更新は既存のチケット系ツールで行うので、
画像専用の投稿ツールは無い。生の `<img>` タグは表示時に除去されるため使えない。

| ツール                      | 用途                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `create_image_upload_token` | 使い捨てのアップロードURLとトークンを発行する。ファイルを送る主経路        |
| `upload_image`              | base64 を直接渡す。シェルを実行できないクライアント向けの退避手段          |
| `get_image`                 | 保存済みの画像を取得して画像として返す。貼られたスクショを見たいときに使う |

添付先のボードは `ticketId`(表示IDでも可)か `boardId`(ボードキーでも可)の**どちらか一方**で指定する。省略はできない。
`ticketId` を指定した場合は、そのチケットを編集できる必要がある。

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
- アップロードトークンは `/api/upload` 専用で、有効期限は10分・1回限り。発行後に BAN・ボードの所属・アーカイブの状態が
  変われば使えなくなる。アーカイブ済みボードへは添付できない
- 添付を読めるのは貼り付け先ボードのメンバーだけ。
  本文の保存時に付け替わるのは、**自分がアップロードした添付のうち、まだどの本文からも使われていないもの**だけ。
  既に別のボードの本文で使っている画像を貼り直しても付け替えは起きないので(元の本文が読めなくなるため)、
  その画像は貼り直した先では元のボードのメンバーにしか見えない
