---
type: design_doc
title: MCP ツールのリファレンス(開発者向け)
updated: 2026-11-09
---

# MCP ツールのリファレンス(開発者向け)

MCP サーバー(`/api/mcp`)が提供するツールと、その権限・入力の要点をまとめる。
つなぎ方と使い方(利用者向け)は [ai.md](../guide/ai.md)、公開設定とトークンの運用(運用者向け)は
[mcp-server.md](../admin/mcp-server.md)、認証の振り分けや入力の細かな仕様の実装は
[mcp-server-internals.md](mcp-server-internals.md) を参照。

## ツール一覧

[共通のツール](#共通のツール)と、[画像の添付](#画像の添付)の `create_image_upload_token` / `upload_image` / `get_image`、
[ファイルの添付](#ファイルの添付)の `create_file_upload_token` / `get_file`、[Wiki](#wiki) の6ツールは
接続の種類(人間 / AIエージェント)を問わず使える。
人間の2経路(認可コードフロー / ユーザーの MCP トークン)は使えるツールも権限も同じ。
`report_acceptance_criteria` は人間の経路でだけ、`get_agent_task` / `finish_agent_task` / `propose_child_tickets` はエージェント用トークンで
接続した場合だけ使える。

ツールの説明・エラーメッセージなど MCP 経由で返す文字列は英語。下の表の「用途」は日本語での要約。
入力の細かな仕様(受け付ける ID の形式、文字数、親子の順番など)は
[mcp-server-internals.md](mcp-server-internals.md#入力の約束ごと) を参照。

### 共通のツール

| ツール                   | 用途                                                                                                                                                                                                                                                        | 入力                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ping`                   | 接続確認。認可済みユーザーのメールアドレスを返す                                                                                                                                                                                                            | なし                                                                                                                                                               |
| `echo`                   | 入力した文字列をそのまま返す                                                                                                                                                                                                                                | `message`                                                                                                                                                          |
| `list_boards`            | アクセスできるボードの一覧。チケットを作る前に対象ボードを特定する                                                                                                                                                                                          | `includeArchived`(任意)                                                                                                                                            |
| `get_board`              | ボードの詳細(メンバー・タグ・ステータス別のチケット件数・AI向けコンテキスト・チケットテンプレート・マージによる自動完了の設定・割り当てられた Wiki スペース)                                                                                                | `boardId`                                                                                                                                                          |
| `get_ticket`             | チケットの詳細(本文・ステータス・担当者・タグ・受け入れ条件・コメント・親子・関連・紐付け・変更履歴・短縮URL・ボードのAI向けコンテキスト・マージによる自動完了の設定・貼られた画像とファイルのキーと名前・サイズ・形式・割り当てられた Wiki スペース)を取得 | `ticketId`                                                                                                                                                         |
| `search_tickets`         | アクセスできるチケットを検索(更新日時の降順)                                                                                                                                                                                                                | `keyword` / `status` / `priority` / `tags` / `boardId` / `assignee` / `relatedTo` / `relation` / `limit`                                                           |
| `create_ticket`          | ボードにチケットを新規作成                                                                                                                                                                                                                                  | `boardId` / `title` / `templateId` / `content` / `status` / `priority` / `dueDate` / `assigneeId` / `tagIds` / `acceptanceCriteria` / `parentId` / `childOrder`    |
| `update_ticket`          | チケットの内容とステータスを更新                                                                                                                                                                                                                            | `ticketId` / `title` / `content` / `priority` / `dueDate` / `assigneeId` / `tagIds` / `status` / `acceptanceCriteria` / `parentId` / `childOrder` / `childAdvance` |
| `delete_ticket`          | チケットを削除                                                                                                                                                                                                                                              | `ticketId`                                                                                                                                                         |
| `add_ticket_comment`     | コメントを追加(対応プラン・対応報告・アナウンス・返信もここから)。アナウンスは利用者の了承(`userApproved`)が要り、エージェントは投稿できない                                                                                                                | `ticketId` / `content` / `type` / `parentId` / `userApproved`                                                                                                      |
| `update_ticket_comment`  | 自分が投稿したコメントを編集                                                                                                                                                                                                                                | `commentId` / `content`                                                                                                                                            |
| `delete_ticket_comment`  | コメントを削除                                                                                                                                                                                                                                              | `commentId`                                                                                                                                                        |
| `link_ticket_artifact`   | GitHub / GitLab のブランチ / プルリクエスト / コミットの URL をチケットに紐付ける                                                                                                                                                                           | `ticketId` / `url`                                                                                                                                                 |
| `unlink_ticket_artifact` | 紐付けを外す                                                                                                                                                                                                                                                | `linkId`                                                                                                                                                           |
| `link_related_ticket`    | 同じボードのチケット同士を関連付ける(向きなし)                                                                                                                                                                                                              | `ticketId` / `relatedTicketId`                                                                                                                                     |
| `unlink_ticket_relation` | 親子・関連を外す                                                                                                                                                                                                                                            | `relationId`                                                                                                                                                       |
| `get_board_notes`        | ボードノート(ナレッジ / メモリ)の本文を名前で読む。名前を渡さなければ索引をキーワード・区分で検索する                                                                                                                                                       | `boardId` / `names` / `keyword` / `kind`                                                                                                                           |
| `save_board_note`        | ボードノートを名前で作成・更新する(渡した項目だけ変える)。区分の変更で昇格 / 降格                                                                                                                                                                           | `boardId` / `name` / `kind` / `description` / `content` / `newName` / `expectedUpdatedAt` / `ticketId` / `userApproved`                                            |
| `delete_board_note`      | ボードノートを削除する(履歴から復元できる)                                                                                                                                                                                                                  | `boardId` / `name` / `ticketId` / `userApproved`                                                                                                                   |
| `get_agent_setup_guide`  | 自動運用(Devuntu Agent)を自分のマシンへ用意する手順を返す。人が読むためのもの                                                                                                                                                                               | `cli`(任意。未指定なら手順ではなく CLI の選択を促す)                                                                                                               |

権限はボードのロールで決まり、基本は画面と同じ。ただしチケットの更新・削除だけは MCP 経由に追加の制限がある。

- `update_ticket` — メンバーは**他人が担当のチケットを更新できない**(未割り当てなら可能。オーナーは制限なし)
- `delete_ticket` — オーナー・メンバーともに**自分が作成したチケットのみ**削除できる(画面より厳しい)
- `delete_ticket_comment` — 自分が投稿したコメント、またはチケットを削除できる権限を持つ場合。返信は親と一緒に消えるため、
  他人の返信が付いたコメントはチケットを削除できる権限が無いと削除できない(`COMMENT_HAS_OTHERS_REPLIES`。画面と同じ)
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
- plan の実行中と、`planned` で閉じて返信待ちの間は、`finish_agent_task` の `completed` と `add_ticket_comment` の `type=report` をエラーにする(プランへの返信を待たずに完了・報告させない。返信待ちの間は `skipped` / `failed` もエラー)

入力と応答の詳細は [agent-runner-internals.md](agent-runner-internals.md#エージェント専用の-mcp-ツール) を参照。

### ツールの注釈(annotations)

各ツールには MCP の Tool annotations を付けている(`src/lib/mcp/mcp.ts` の `TOOL_ANNOTATIONS`)。
クライアントが確認の要否を決めるためのヒントで、権限の強制ではない(認可はサーバー側でこれまでどおり行う)。
Claude Code のプランモードは `readOnlyHint: true` のツールしか確認なしで呼ばないため、読み取りのツールだけに付ける。
devuntu の外(GitHub など)へ書き込むツールは無いので、`openWorldHint` は全ツール `false`。

MCP の仕様に合わせ、追加だけで済まない(既存の値を上書き・削除しうる)ものを destructive、
同じ入力で繰り返しても結果が変わらないものを idempotent とする。

| 分類                    | readOnly | destructive | idempotent | ツール                                                                                                                                                                                                                                               |
| ----------------------- | -------- | ----------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readOnly`              | true     | -           | -          | `ping` / `echo` / `list_boards` / `get_board` / `get_ticket` / `search_tickets` / `get_image` / `get_file` / `get_agent_setup_guide` / `get_agent_task` / `get_board_notes` / `list_wiki_spaces` / `get_wiki_tree` / `search_wiki` / `get_wiki_page` |
| `additive`              | false    | false       | false      | `create_ticket` / `add_ticket_comment` / `create_image_upload_token` / `create_file_upload_token` / `upload_image` / `propose_child_tickets`                                                                                                         |
| `additiveIdempotent`    | false    | false       | true       | `link_ticket_artifact` / `link_related_ticket`                                                                                                                                                                                                       |
| `destructive`           | false    | true        | false      | `update_ticket` / `finish_agent_task` / `save_board_note` / `save_wiki_page`                                                                                                                                                                         |
| `destructiveIdempotent` | false    | true        | true       | `update_ticket_comment` / `report_acceptance_criteria` / `delete_ticket` / `delete_ticket_comment` / `unlink_ticket_artifact` / `unlink_ticket_relation` / `delete_board_note` / `delete_wiki_page`                                                  |

- `update_ticket` は値を上書きし、`acceptanceCriteria` は全件置き換え(含めなかった項目はチェックや申告ごと消える)、
  `parentId: null` で親子を外せる。id の無い受け入れ条件は呼ぶたびに作り直されて変更履歴も残るので、冪等にもしない
- `finish_agent_task` は受け入れ条件の申告を上書きする。実行がタイムアウトで閉じられた後に繰り返すと、
  タイムアウトで付いた状態を上書きしてしまうので冪等にしない
- `update_ticket_comment` / `report_acceptance_criteria` は履歴を残さずに本文・申告を上書きする
- `link_ticket_artifact` は同じ URL なら既存の紐付けを戻すだけ、`link_related_ticket` は2回目がエラーになるだけで状態は変わらない
- `save_board_note` は既存のノートを上書きする(版は残る)。同じ内容なら版を作らないが、作成と更新を名前で兼ねるので冪等にはしない。
  `delete_board_note` は無い名前に対して `deleted: false` を返すだけなので冪等
- `save_wiki_page` は `save_board_note` と同じく作成と更新を兼ねるので冪等にしない。`delete_wiki_page` は無いページに対して
  `deleted: 0` を返すだけなので冪等

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
- `save_board_note` は名前で引き、あれば渡した項目だけ更新、無ければ作成する(作成時は `description` / `content` が必須。既定は `kind=memory`)
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

- 上限: 名前60文字(kebab-case・ボード内で一意)、説明150文字(改行なし)、本文はメモリ4000文字・ナレッジ20000文字。
  件数はボードあたりメモリ200件・ナレッジ100件(`BOARD_MEMORY_MAX_COUNT` / `BOARD_KNOWLEDGE_MAX_COUNT`)
- 優先度は ユーザーの指示 > チケット > boardContext > ナレッジ > メモリ。保存の規則(重複を作らず更新する・1件1テーマ・
  チケット固有の経緯や秘密情報を保存しない)は `save_board_note` の description で伝える
- 残し先の振り分けは instructions と `save_board_note` の description で伝える
  ([mcp-server-internals.md](mcp-server-internals.md#届く文言))

  | 得た情報                                                     | 残し先                                                       |
  | ------------------------------------------------------------ | ------------------------------------------------------------ |
  | 個人の好み、自分のマシン・環境に固有のこと(パス・ポートなど) | クライアント自身のメモリ(ボードノートには入れない)           |
  | メンバーの誰もが、どの環境でも使える知見                     | メモリ                                                       |
  | 利用者に覚えておくよう頼まれた、ボード全体の決めごと・手順   | ナレッジ(`userApproved: true`)                               |
  | 確かめられたメモリ、確認・調査で得た残しておくべき情報       | ナレッジにするかを利用者に提案する(エージェントは報告で提案) |

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

## Wiki

AI から Wiki のページを探して読み、書けるようにする6ツール。人の経路もエージェントも使え、
権限はスペースの割り当て(直接・グループ・ボード経由)で決まる(画面と同じ)。everyone のスペースは全ログインユーザーが閲覧でき、editor 以上の割り当てがあれば編集もできる。
スペースの作成・設定・割り当て、タグの作成、版の復元は画面で行う。

| ツール             | 用途                                                                                                       | 入力                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `list_wiki_spaces` | 閲覧できるスペースの一覧(キー・名前・説明・公開範囲・自分のロール・書き込めるか)                           | `includeArchived`(任意)                                                                                             |
| `get_wiki_tree`    | スペースのページの階層(ref・タイトル・タグだけ。本文なし)                                                  | `space` / `root` / `depth`                                                                                          |
| `search_wiki`      | 閲覧できるページを検索し、ref・タイトル・パンくず・タグ・一致箇所の抜粋を返す                              | `keyword` / `space` / `tags` / `limit`                                                                              |
| `get_wiki_page`    | ページを読む(本文・パンくず・子ページ・タグ・`updatedAt`・貼られた添付のキー)。`section` で節だけを読める  | `ref` / `section`                                                                                                   |
| `save_wiki_page`   | `ref` が無ければ作成、あれば渡した項目だけを更新する。`edits` で部分更新、`parent` / `position` で移動する | `ref` / `space` / `title` / `content` / `edits` / `parent` / `position` / `tags` / `expectedUpdatedAt` / `ticketId` |
| `delete_wiki_page` | ページを削除する。子孫を持つページは `recursive: true` のときだけ配下ごと消す                              | `ref` / `recursive` / `ticketId`                                                                                    |

- ページは `ref`(`<スペースキー>/<番号>`、例: `DOCS/12`)で指定する。番号はスペース内の連番で、改名や移動では変わらない。
  キーは大文字小文字を問わない
- `get_ticket` / `get_board` / `get_agent_task` の応答に、ボードに割り当てられたスペースのうち閲覧できてアーカイブされていないものを
  `wikiSpaces`(`key` / `name` / `description` / `canWrite`)として載せる。0件なら項目ごと省く。
  `boardContext` と同じく、ボードのメンバーでない承認者には載せない
- `section` は見出しの文字列(先頭の `#` は不要。大文字小文字を問わない)。最初に一致した見出しから、同じか浅いレベルの次の見出しの手前まで
  (子見出しを含む)を返す。ATX 形式(`#`〜`######`)だけを見て、コードブロック内の `#` は見出しにしない。
  見つからなければ見出しの一覧を添えたエラーにする
- `get_wiki_tree` は兄弟の並び順の入れ子で返す。`root` を渡すとその子孫だけ(`root` 自身は `root` 項目に分ける)、
  `depth` を渡すとその段数まで返し、それより深い子は `childCount` だけを返す
- `search_wiki` の条件と並び順は画面の検索と同じ(全語の AND、タイトル一致 → 更新日時の新しい順)。`keyword` か `tags` のどちらかが要る。
  `limit` の件数(既定20、最大50)まで返したときは `limitReached: true` を付ける
- `save_wiki_page`
  - 作成は `space` と `title` が必須。`parent`(同じスペースのページの ref)・`position`・`tags` も同じトランザクションで反映する
  - 更新で `content` を渡すと本文を丸ごと置き換え、`edits`(`[{ oldText, newText }]`、50件まで)を渡すと順に置き換える。
    `oldText` は本文にちょうど1回だけ現れなければならず、0回・複数回なら何番目の edit かを書いたエラーにする。`content` と同時には渡せない
  - `edits` を渡したときは、`expectedUpdatedAt` が無くても、edits を当てた本文を読んだ時点の `updatedAt` で楽観ロックをかける
    (読んでから書くまでの他の人の更新を消さない)
  - `parent`(`null` でスペース直下)・`position`(兄弟の中の位置、1始まり)で移動する。別のスペースへは移せない。
    `position` だけなら今の親のまま並べ替え、親を変えて `position` を省くと末尾へ置く。今と同じ親を `position` なしで渡しても動かさない。
    内容と移動を一度に渡すと、内容の更新の後で移動する(別のトランザクション)。移動だけが失敗したときは、内容は保存済みである旨をエラーに書く
  - `tags` はページのタグを丸ごと置き換える。スペースに既にあるタグの**名前**で渡し、無い名前は作らずに既存のタグ名を添えたエラーにする
    (AI に表記ゆれのタグを増やさせない)
  - 応答は `result`(`created` / `updated` / `moved` / `updated+moved` / `unchanged`)・`ref`・`url`・`updatedAt`
- `ticketId` を渡すと、どのチケットの対応中に書いたかが版に残る(閲覧できるチケットのみ)。書き込みの経路は版に `mcp` として残る
- 削除したページは、保持期間(`WIKI_REVISION_RETENTION_DAYS`)の間は画面の履歴から復元できる
- エラーは `errorType` 付きで返す。`WIKI_PAGE_CONFLICT`(読んだ後に更新された)/ `WIKI_PAGE_HAS_CHILDREN`(子孫があり `recursive` が無い)/
  `WIKI_PAGE_TOO_DEEP`(深さの上限10を超える)/ `WIKI_PAGE_INVALID_PARENT`(自分自身・子孫の下へは移せない)

instructions には `wikiSpaces` の読み方(関係する文書を `search_wiki` / `get_wiki_page` で探して読む)だけを載せ、
書き込みの作法(読んだ `updatedAt` を `expectedUpdatedAt` に渡す・部分修正は `edits` にする・利用者の依頼か同意があるときだけ書く)は
`save_wiki_page` の description で伝える([mcp-server-internals.md](mcp-server-internals.md#届く文言))。

## 画像の添付

チケット本文・コメント・Wiki ページへ画像を貼るには、まず画像を保存して `/api/upload/<キー>.webp` を受け取り、
その URL を `![説明](URL)` の Markdown 記法で `content` に書く。本文の更新は既存のチケット系・Wiki のツールで行うので、
画像専用の投稿ツールは無い。生の `<img>` タグは表示時に除去されるため使えない。

| ツール                      | 用途                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| `create_image_upload_token` | 使い捨てのアップロードURLとトークンを発行する。ファイルを送る主経路        |
| `upload_image`              | base64 を直接渡す。シェルを実行できないクライアント向けの退避手段          |
| `get_image`                 | 保存済みの画像を取得して画像として返す。貼られたスクショを見たいときに使う |

添付先は `ticketId`(表示IDでも可)・`boardId`(ボードキーでも可)・`wikiPage`(Wiki ページの ref)の**どれか1つ**で指定する。省略はできない。
`ticketId` を指定した場合は、そのチケットを編集できる必要がある。`wikiPage` を指定した場合は、そのページが存在し、
スペースに書き込める(editor 以上で未アーカイブ)必要がある。Wiki の添付はページではなくスペースに属する(画面からの添付と同じ)。
作成前のページには添付できないので、先に `save_wiki_page` で作ってから添付する。

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
- アップロードトークンは `/api/upload` 専用で、有効期限は10分・1回限り。発行後に BAN・ボード / Wiki スペースの所属・アーカイブの状態が
  変われば使えなくなる。アーカイブ済みのボード・スペースへは添付できない
- Wiki スペースへの添付を読めるのは、そのスペースを閲覧できる人
- 添付を読めるのは貼り付け先ボードのメンバーだけ。
  本文の保存時に付け替わるのは、**自分がアップロードした添付のうち、まだどの本文からも使われていないもの**だけ。
  既に別のボードの本文で使っている画像を貼り直しても付け替えは起きないので(元の本文が読めなくなるため)、
  その画像は貼り直した先では元のボードのメンバーにしか見えない

## ファイルの添付

画像以外のファイル(ログ・PDF・アーカイブなど)は、変換せずにそのまま保存し、`[ファイル名](/api/upload/<キー>)` の
Markdown のリンクとして `content` に書く。キーの拡張子は元のファイル名のもの(英数字10文字に収まらなければ `bin`)。

| ツール                     | 用途                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| `create_file_upload_token` | 使い捨てのアップロードURLとトークンを発行する。添付先の指定と権限は `create_image_upload_token` と同じ |
| `get_file`                 | 保存済みのファイルを読む。テキストなら中身を返し、それ以外はダウンロード用の curl を返す               |

```sh
curl -sS -X POST "<BETTER_AUTH_URL>/api/upload?kind=file" \
  -H "Authorization: Bearer <発行されたトークン>" \
  -F "file=@./build.log"
# => {"url":"/api/upload/019e....log"}
```

- クエリの `kind=file` を付けないと画像として扱われ、画像以外は弾かれる。トークンは画像と共通(種類はクエリで決まる。ボディを読む前に上限を決めるため、フォームではなくクエリで渡す)
- 上限は `ATTACHMENT_MAX_SIZE_MB`(既定 10MB)。`create_file_upload_token` の返り値の `maxSizeMb` に入る
- `get_file` は、256KB 以下で UTF-8 として読めて NUL を含まないものを `text` として返す。
  それ以外は名前・サイズ・形式と、そのファイル専用のダウンロードトークン(有効期限10分。期限内は何度でも使える)の curl を返す

```sh
curl -sS -o ./build.log <BETTER_AUTH_URL>/api/upload/019e....log \
  -H "Authorization: Bearer <get_file が返したトークン>"
```

- ダウンロードトークンは対象のキーの配信URLを `aud` に持つので、別のファイルやアップロードには使えない。
  閲覧権限はトークンに含めず、使うたびに配信APIが確かめる
- 配信時、画像(JPEG / PNG / WebP / GIF)以外は `Content-Disposition: attachment` と `Content-Security-Policy: sandbox` を付けてダウンロードさせる。
  HTML・SVG・XML(`+xml` を含む)・JavaScript など、ブラウザが文書やスクリプトとして解釈しうる形式は保存時に `application/octet-stream` にする
- `get_image` に画像以外のキーを渡すとエラーになる(`get_file` を使う)
