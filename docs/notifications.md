- [通知キューと配信ワーカー](#通知キューと配信ワーカー)
  - [1 tick の処理](#1-tick-の処理)
  - [取り出しと多重起動](#取り出しと多重起動)
  - [再試行と失敗](#再試行と失敗)
  - [流量制御](#流量制御)
- [メンション通知の流れ](#メンション通知の流れ)
- [ユーザーごとの通知設定](#ユーザーごとの通知設定)
- [メール通知の前提](#メール通知の前提)
- [Slack通知の前提](#slack通知の前提)
- [エージェント実行結果のチャンネル通知](#エージェント実行結果のチャンネル通知)
- [Slackでのチケットリンクのプレビュー](#slackでのチケットリンクのプレビュー)
  - [Slack App側の設定](#slack-app側の設定)
  - [展開されるのはアプリが参加している会話だけ](#展開されるのはアプリが参加している会話だけ)
  - [リクエストの検証](#リクエストの検証)
- [トリガー・チャネルを増やす場合](#トリガーチャネルを増やす場合)

# 通知の実装詳細

通知は宛先の決まり方で 2 種類に分かれる。

| 種類         | 宛先             | 設定場所                                        | イベント    | チャネル          |
| ------------ | ---------------- | ----------------------------------------------- | ----------- | ----------------- |
| DM 通知      | ユーザー個人     | `/account` の通知設定(`UserNotifySetting`)      | `mention`   | メール / Slack DM |
| チャネル通知 | Slack チャンネル | `/boards/[id]/settings`(`Board.slackChannelId`) | `agent_run` | Slack             |

イベント種別は Prisma の `NotifyEvent`、チャネルは `NotifyChannel`。どちらの宛先に出るイベントかは
`DM_NOTIFY_EVENTS` / `CHANNEL_NOTIFY_EVENTS`(`src/lib/notify/notify.ts`)で分ける。

どの通知も**キューを経由して非同期に送る**([通知キューと配信ワーカー](#通知キューと配信ワーカー))。
発生させる側(チケット操作・エージェントの実行記録)は投入までしか行わないので、
外部サービスとの往復でレスポンスが遅れることも、送信の失敗が業務処理へ波及することもない。

## 通知キューと配信ワーカー

```
[トリガー発火]  チケット操作 / エージェントの実行記録
      ↓ 同一トランザクションで 1 行 INSERT(notify-enqueue.ts)
[NotifyOutbox]  「何が起きたか」だけを記録。文面に必要な値はここへスナップショット
      ↓ ワーカー(notify-dispatch.ts)
[宛先解決]      notify-recipient.ts … イベント → ユーザーID / Slack チャンネル
      ↓
[展開]          notify-fanout.ts … 通知OFF / 未連携 / 未構成 を外して配信行を作る
      ↓
[NotifyDelivery] 宛先 × チャネルの 1 行。`scheduledAt` を過ぎたものが送信対象
      ↓
[配信]          notify-email.ts / notify-slack.ts
```

アウトボックス(発生記録)とデリバリ(宛先 × チャネル)を分けているのは次の理由から。

- トリガー側は 1 INSERT で済み、チケット操作のトランザクションを重くしない。
  操作がロールバックされた場合に通知だけが残ることもない
- 宛先の解決(通知設定・Slack の許可グループ・連携状況)が配信直前の 1 箇所に集まる
- 同じ本文を宛先の数だけ複製しない

ワーカーは**二重に駆動する**(`src/lib/notify/notify-worker.ts`)。

| 駆動 | 契機                            | 役割                                                                                      |
| ---- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| kick | 投入直後の `after()`            | レスポンス後に 1 周回す。通常はこちらだけで配信が終わる                                   |
| tick | `setInterval`(`NOTIFY_TICK_MS`) | kick が使えなかった分(リクエスト文脈の外からの投入)と、再試行・取りこぼしの回収を拾う保険 |

起動は `src/instrumentation.ts` から。`NOTIFY_WORKER_ENABLED=false` で止められる
(投入だけが続き配信は行われないので、通知が出ない原因の切り分けに使える)。

### 1 tick の処理

1. **回収** : `processing` のまま `NOTIFY_CLAIM_TIMEOUT_MS` を過ぎた行を `pending` へ戻す。
   コンテナの再起動やクラッシュで掴んだまま終わった行を拾う
2. **展開** : アウトボックスを掴んで配信行を作り、アウトボックスを `done` にする。
   宛先が 1 つも残らなかった場合も `done`(送らないことは失敗ではない)。
   ペイロードが壊れている行は文面を組み立てられないので `failed` にして残す
3. **配信** : チャネルごとに掴んで送る。チャネル間は `Promise.allSettled` で並行、
   **チャネル内は逐次**(ワークスペース単位のバーストを避ける)
4. **パージ** : 送信できた配信は行ごと削除する(送信の記録はログにある)。
   子が無くなった `done` のアウトボックスも削除し、`failed` は `NOTIFY_FAILED_RETENTION_MS` だけ残す

### 取り出しと多重起動

取り出しは `FOR UPDATE SKIP LOCKED` の生 SQL で行う。同じ行を 2 つのワーカーが同時に処理することが
無いので、**リーダー選出の仕組みが要らない**(Prisma のコネクションプールではセッションレベルの
advisory lock を保持できないため、そもそも採れない)。

プロセス内では `timer` / `running` フラグで無駄な重なりを防ぐ。`next dev` でモジュールが
再評価されても二重の interval は張らない。実行中に来た駆動要求は取りこぼさないよう、
終わってからもう 1 周する。

### 再試行と失敗

送信結果は Slack の `SlackSendOutcome` をそのまま共通の語彙として使う(`notify-outcome.ts`)。
他のチャネルを足すときも同じ分類へ落とすことで、再試行の判断を 1 箇所に保てる。

| 結果                                    | 扱い                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `ok` / `unlinked`                       | 行を削除する。宛先が消えているだけなので `unlinked` も失敗としては扱わない                     |
| `revoked`                               | Bot トークンが無効。そのチャネルの残りも全滅するので tick を打ち切り、試行回数を戻して次へ回す |
| `rate_limited` / `retryable` / `failed` | `NOTIFY_RETRY_BASE_MS × 試行回数` 後へ回す。`NOTIFY_MAX_ATTEMPTS` 回で `failed`                |

`lastError` には分類だけを入れる(利用者の入力は載せない)。

### 流量制御

3 段で効かせる。

1. **投入時** : `MAX_NOTIFY_RECIPIENTS`(20)で 1 イベントの宛先を頭打ちにする。
   超過分は警告ログのみで、通知の失敗としては扱わない。
   投入そのものも `consumeRateLimit` で操作者ごとに制限し、超過は捨てる
   (通知の欠落より外部サービスを叩き続ける方が重い)
2. **1 tick あたり** : `NOTIFY_FANOUT_BATCH` / `NOTIFY_DELIVER_BATCH` で外部呼び出しの回数を抑える
3. **チャネル全体** : `NOTIFY_CHANNEL_RATE_LIMIT` を `consumeRateLimit`(`src/lib/rate-limit.ts`)で
   消費する。超過した tick は送らず次へ持ち越す。ワーカーは実質 1 プロセスなのでプロセス内カウンタで足りる

## メンション通知の流れ

チケット本文・コメントのエディタで `@` により指名されたユーザーへ通知する。入口は `notifyMention()`(`src/lib/notify/notify-mention.ts`)ただ 1 つで、チケット作成 / 本文編集 / コメント投稿 / コメント編集(`src/app/(sidenav)/tickets/server.ts`、`src/app/(sidenav)/tickets/[id]/server.ts`)と MCP 経由の同じ操作(`src/lib/mcp/mcp-ticket.ts`)から呼ばれる。

- メンションした本人は宛先から除外する(自分の書き込みで自分に通知が飛ばない)
- 本文を編集し直すたびに同じ相手へ通知しないよう、**増えたメンションだけ**を宛先にする(呼び出し側で差分を取る)
- 件名は `[表示ID] チケットタイトル`、リンク先は `/t/<表示ID>`(コメント経由はコメントの位置までフラグメントを付ける)。文面は宛先ユーザーのロケールで組み立てる
- **メンションした人の表示名とコメントの抜粋は投入時に確定させる**。配信は遅れて走るため、そのときにはコメントが消えていることもある
- メールと Slack はキューの上では独立した配信行になる。片方のチャネルが失敗してももう片方は止まらない

## ユーザーごとの通知設定

`/account` の「通知設定」(`src/app/(sidenav)/account/notify.tsx`)で、イベント種別 × チャネルごとに ON/OFF を切り替える。項目数が少ないためフォームにせず切り替え即保存にしている。

- 保存先は `UserNotifySetting`(`userId` + `event` でユニーク)の `email` / `slack` 列
- **行が無い場合は全チャネル OFF** として扱うオプトイン方式。ON にしたときだけ行が作られるので、全ユーザー分の初期行を用意しなくてよい。絞り込み(`filterNotifiable()` / `src/lib/notify/notify-setting.ts`)も ON の行だけを引いて残す
- メールのスイッチは常に表示する。Slack のスイッチは Slack 連携を利用できるユーザーにのみ表示する

## メール通知の前提

`MAIL_SEND` が設定されていることが唯一の前提で、ユーザー側の連携作業は不要。メール通知を ON にしたユーザーだけが宛先(`User.email`)になる。

- `MAIL_SEND` 未設定の環境では `isMailConfigured()`(`src/lib/mail.ts`)が false になり、**通知メールは送信を試みずスキップされる**(OTP メールなど他の送信は `Unable to send email` エラーになる)
- 1 通ずつ送信し、1 通の失敗で残りの宛先を巻き添えにしない(失敗した配信だけが再試行に回る)

## Slack通知の前提

Slack DM は以下の 3 段がすべて揃ったユーザーにだけ届く。どれかを満たさない相手は宛先から自然に消えるだけで、エラーにはならない。

1. **環境変数** : `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_BOT_TOKEN` が揃っていること(`hasSlackCredentials()` / `src/lib/slack/slack-account.ts`)。`SLACK_TEAM_ID` は任意で、設定すると別ワークスペースのアカウントを連携の入口で弾く
2. **管理者による有効化** : `/admin/settings` で Slack 連携を有効にする。許可グループを指定した場合はそのグループのメンバーのみ、空の場合は全ユーザーが対象(設定は kvs の `SLACK` グループに保存)
3. **ユーザー本人の連携** : `/account` から Slack アカウントを OAuth 連携する(`account.providerId = 'slack'`)

送信は逐次で行い、Bot トークンが無効(`revoked`)と判定された時点で残りを打ち切る
([再試行と失敗](#再試行と失敗))。未連携のユーザーは展開の時点で宛先から外すので、
送っても必ず失敗する配信行は作らない。

## エージェント実行結果のチャンネル通知

AIエージェントの自動運用(`docs/agent-runner.md`)は無人で動くため、実行履歴を見に行かないと結果が分からない。
**ボードごとに Slack チャンネルを設定**し、そのボードのチケットの実行が終わった時点で結果を投稿する。

入口は `notifyAgentRun()`(`src/lib/notify/notify-agent-run.ts`)ただ 1 つ。メンション通知と同じく
キューへ投入するだけなので、送信の失敗はエージェントの実行記録へ波及しない。

- 設定は `Board.slackChannelId`。`/boards/[id]/settings` の「Slack通知」で選ぶ。**null なら通知しない**
- 設定できるのはボードの `owner` と管理者(`assertBoardAccess(..., 'manage')`)。
  プライベートボードは他の構成変更と同じく `assertTeamBoard` で弾く
- **通知するのは実行が終了したときだけ**(成功 / 失敗 / スキップ)。開始時は通知しない
- 呼ぶのは実行が閉じる 3 経路すべて(`src/lib/agent/agent-runner.ts`)。いずれもトランザクションを抜けた直後に呼ぶ

| 経路                           | 関数                 | 通知する条件                                                                                        |
| ------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------- |
| エージェント自身の報告(正常系) | `finishAgentTask`    | 実行の行を実際に閉じたとき。ランナーを介さず MCP だけで動かした場合は実行の行が無いので通知もしない |
| ランナーの終了報告(保険)       | `finishAgentRunById` | 報告が無いまま閉じたときだけ。報告済みなら `finishAgentTask` が既に通知している(二重送信の防止)     |
| 時間切れ(60分)                 | `failStaleAgentRuns` | 潰した実行ぶん。まとめて時間切れになっても `MAX_NOTIFY_RECIPIENTS` 件で頭打ちにする                 |

- チケットが削除済みの実行は宛先のボードを辿れないので通知しない
- 投稿には表示ID・チケット名・エージェント名・処理種別・結果・所要時間と、エージェントが報告した要約を載せる。
  要約は `commentExcerpt()` で記法を落として引用 1 行にし、**投入時に確定させる**
- ボタンのリンク先は**短縮URLではなくチケット詳細(`/tickets/<id>`)**。短縮URLはボードメンバーの
  可視スコープで解決するため、実行履歴の一覧(`agent-run-history.tsx`)と同じ判断に揃えている
- **宛先がユーザーではないのでロケールを解決する相手がいない**。文面は `t(null, ...)` で
  既定ロケール(`DEFAULT_LOCALE`)に固定する
- `UserNotifySetting` のオプトインとは独立している(チャンネルの購読者を個人設定では表せないため)。
  ただし管理者が `/admin/settings` で Slack 連携を無効にすれば、この通知も止まる
  (判定は展開時に行うので、無効化した後に投入された分も送られない)

### 通知先チャンネルの一覧

`listSlackChannels()`(`src/lib/slack/slack-server.ts`)が `users.conversations` で取得する。

- `conversations.list` は Bot が未参加の公開チャンネルまで返すため、選んでも投稿時に `not_in_channel` で
  失敗するものが一覧に混ざる。`users.conversations` が返すのは**Bot が参加しているチャンネルだけ**なので、
  招待漏れによる設定ミスが構造的に起きない
- ただし参加は投稿権限を保証しない。read-only channel などでは `chat.postMessage` が
  `restricted_action_read_only_channel` を返して投稿が拒否される。`classifySlackError` はこれを
  `failed` に分類し、`callWithBotToken` が warn ログへ落とすだけで**画面には出ない**
- 一覧に出てこない = Bot が招待されていない、なので空のときは `/invite @Devuntu` を案内する
- 結果は 5 分キャッシュする。招待した直後は一覧に現れないことがある
- 保存時にも一覧と突き合わせ、含まれないIDは弾く(設定できたように見えて通知だけ届かない状態を作らない)
- スコープは `channels:read` / `groups:read`。**マニフェストにこれらが入る前に導入したワークスペースでは
  再インストールと `SLACK_BOT_TOKEN` の差し替えが必要**(不足していれば `missing_scope` が返る)
- **取得系のメソッドは form-urlencoded で送る**(`callSlackApi` の `encoding` に `'form'` を渡す)。
  Slack Web API が JSON ボディを受け付けるのは `chat.postMessage` / `chat.unfurl` のように
  `application/json` を明記しているメソッドだけで、`users.conversations` へ JSON を送ると
  パラメータが期待どおりに解釈されない。`types` が効かないとプライベートチャンネルが返らず、
  Bot 未招待と見分けが付かなくなる

## Slackでのチケットリンクのプレビュー

Slack に貼られたチケットURLを、Slack Events API の `link_shared` を受けて
`chat.unfurl` でカード表示に展開する(`src/app/api/slack/events/route.ts` → `src/lib/slack/slack-unfurl.ts`)。

サイト側は認証必須のままなので、未認証の Slack クローラに OGP を読ませる方式は採れない。
代わりに **リンクを貼った本人の閲覧権限をサーバー側で検証してから展開する**。

対応する URL は 2 形式(`parseTicketUrl()` / `src/lib/board/task.ts`)。オリジンが `BETTER_AUTH_URL` と一致するものだけ受ける。

| 形式                    | 引き方                                              |
| ----------------------- | --------------------------------------------------- |
| `/t/{表示ID}`           | `findTicketIdByDisplayId()` で表示IDから引く        |
| `/tickets/{チケットID}` | uuid v7 の形式を確認してそのまま引く(詳細画面のURL) |

- カードのリンク先は**どちらの形式でも短縮URLへ正規化**する
- `link_shared` の `user`(Slack ユーザーID)を `account` テーブルで Devuntu ユーザーへ解決する。未連携なら展開しない
- 通知と同じ `canUseSlackAccount()` で管理者による有効化・許可グループを確認する
- `getTicketAccess()` で閲覧権限を確認する。見えないチケットは展開せず URL のまま残す(未存在と権限不足は区別しない)
- 1 メッセージあたりの展開は 5 件まで
- カードには表示ID・チケット名・ステータス・優先度・担当者・期限を載せる。文言は貼った本人のロケールで解決する

展開先は `link_shared` の `unfurl_id` + `source` で指定する。これは投稿済みメッセージでも
**入力中(送信前)のプレビュー**でも付くため、貼った時点でカードが見える。
入力中のイベントは `channel` が `COMPOSER` という実在しない値になるので、`channel` + `message_ts` は
`unfurl_id` が無い場合のフォールバックとしてのみ使う。

### Slack App側の設定

アプリの定義は `slack/manifest.yaml` にある。<https://api.slack.com/apps> の **From a manifest** に貼り付けて作成する
(既存アプリには App Manifest 画面から反映する)。ホスト名の置き換えと、取得した値をどの環境変数へ入れるかはファイル冒頭のコメントを参照。

| マニフェストの項目                                           | 用途                                              |
| ------------------------------------------------------------ | ------------------------------------------------- |
| `oauth_config.scopes.user`                                   | `/account` からの Sign in with Slack              |
| `oauth_config.scopes.bot` の `chat:write`                    | メンション通知の DM 送信とボードのチャンネル通知  |
| `oauth_config.scopes.bot` の `links:read`                    | リンクの検知(`link_shared`)                       |
| `oauth_config.scopes.bot` の `links:write`                   | プレビューの反映(`chat.unfurl`)                   |
| `oauth_config.scopes.bot` の `channels:read` / `groups:read` | 通知先チャンネルの一覧取得(`users.conversations`) |
| `features.unfurl_domains`                                    | 展開対象のドメイン                                |
| `settings.event_subscriptions.request_url`                   | `/api/slack/events`                               |

反映後は以下を確認する。

- Bot スコープを変更したらワークスペースへ**再インストール**する(しないと `links:write` が効かない)。
  再インストールで `xoxb-` が発行し直されるため、`SLACK_BOT_TOKEN` も入れ替えてアプリを再起動する。
  これは Bot 側の作業で、`/account` からのユーザー連携(user スコープ)のやり直しとは別物
- `missing_scope` が出る場合は、上の再インストールと `SLACK_BOT_TOKEN` の入れ替えが済んでいない
- Event Subscriptions の Request URL が **Verified** になっている(Slack が送る `url_verification` に応答している)
- Signing Secret を `SLACK_SIGNING_SECRET` に設定する。未設定ならエンドポイントは 404 を返し、機能ごと無効になる

`link_shared` は `unfurl_domains` に登録したドメインのリンクにだけ届く。
また Slack から到達できる公開 HTTPS ドメインが必要なため、`localhost` の開発環境ではイベントが届かない。

### 展開されるのはアプリが参加している会話だけ

**イベントが届くこととカードを出せることは別**なので注意する。
Slack は `links:read` があると **アプリが参加していない公開チャンネルにも `link_shared` を送る**
(そのためイベントに `is_bot_user_member` が入っている)。一方 `chat.unfurl` はアプリが会話の参加者でないと
`not_in_channel` で失敗するため、参加していないチャンネルの投稿は展開できない。

`is_bot_user_member` が false のイベントは `chat.unfurl` を呼ばずに打ち切る(`src/lib/slack/slack-unfurl.ts`)。

動作確認は次のどちらかで行う。

- 対象のチャンネルで `/invite @Devuntu` してアプリを参加させる
- アプリとの DM(App の Messages タブ)に貼る

**自分への DM では動かない**(アプリが参加しようがないため)。

展開されない場合は `LOG_LEVEL=debug` にして `slack unfurl skipped` の `reason` を見る。
`bot is not in the channel` / `unlinked user` / `no ticket url`(オリジン不一致なら `baseUrl` も出る)/
`no viewable ticket` のいずれかで、どの段階で止まったか分かる。
なお Slack は直近のアンファールをキャッシュするため、同じ URL を貼り直しても再度は展開されない。

### リクエストの検証

`/api/slack/events` は `src/proxy.ts` の matcher が `api/` を除外しているため未認証で叩ける。
Slack の署名(`src/lib/slack/slack-signature.ts`)だけが門番になるので、検証を通す前に本文を解釈しない。

- 署名は**生ボディ**に対して計算されるため、`request.text()` で読んでから検証する(`request.json()` を先に呼ぶと一致しない)
- タイムスタンプが 5 分以上ずれたリクエストは、署名が正しくてもリプレイとして拒否する
- Slack は 3 秒以内の応答を要求するため、200 を返したあと `after()` の中でチケットを照会して `chat.unfurl` を呼ぶ

## トリガー・チャネルを増やす場合

**イベント(トリガー)を足す**

1. Prisma の `NotifyEvent` enum と `NOTIFY_EVENTS`(`src/lib/notify/notify.ts`)を揃える。
   並びの一致は `tests/lib/notify/notify.test.ts` で固定しているので、**値の追加は末尾のみ**
2. DM 通知なら `DM_NOTIFY_EVENTS`、チャネル通知なら `CHANNEL_NOTIFY_EVENTS` へ追加する。
   前者は `/account` の通知設定と `scUpdateNotifySetting`(`src/lib/schema/schema.ts`)の入力範囲を兼ねる
3. `NOTIFY_PAYLOAD_SCHEMA`(`notify-payload.ts`)・文面(`notify-content.ts`)・宛先の決め方
   (`notify-recipient.ts`)へ追加する。いずれも `satisfies Record<NotifyEvent, …>` なので、
   **定義漏れはコンパイルエラーになる**
4. ロケールキー(`notify_event_*` / `notify_msg_*`)を `src/locale/index.ts` と ja / en へ追加する
5. 発火箇所からキューへ投入する。**Server Action と MCP の両方**に同じ操作があるので、
   差分の判定は共通のヘルパーへ寄せ、呼び出し元は 1 行で済むようにする

**チャネルを足す**

- Prisma の `NotifyChannel` enum、`NOTIFY_CHANNELS`、`NOTIFY_DELIVER_BATCH` / `NOTIFY_CHANNEL_RATE_LIMIT`
  (`src/lib/notify/notify.ts`)を揃える。enum との一致はテストで固定している
- DM で使うなら `UserNotifySetting` に Boolean 列(既定 OFF に揃えるため `@default(false)`)を足し、
  `scUpdateNotifySetting` へも追加する
- 配信は `notify-<チャネル>.ts` を作り、結果を `DeliveryOutcome`(`notify-outcome.ts`)へ落とす。
  分類を揃えることで再試行の判断は `notify-dispatch.ts` の 1 箇所で済む

**置き場所**

`src/lib/notify/notify.ts` はクライアントからも import されるため、サーバー専用の処理は置かない
(設定の読み書きは `notify-setting.ts`、投入は `notify-enqueue.ts`、配信は `notify-dispatch.ts` と各チャネル)。
