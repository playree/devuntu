- [メンション通知の流れ](#メンション通知の流れ)
- [ユーザーごとの通知設定](#ユーザーごとの通知設定)
- [メール通知の前提](#メール通知の前提)
- [Slack通知の前提](#slack通知の前提)
- [エージェント実行結果のチャンネル通知](#エージェント実行結果のチャンネル通知)
- [Slackでのチケットリンクのプレビュー](#slackでのチケットリンクのプレビュー)
  - [Slack App側の設定](#slack-app側の設定)
  - [展開されるのはアプリが参加している会話だけ](#展開されるのはアプリが参加している会話だけ)
  - [リクエストの検証](#リクエストの検証)
- [イベント・チャネルを増やす場合](#イベントチャネルを増やす場合)

# 通知の実装詳細

ユーザー宛の通知イベントはメンション(`mention`)のみで、通知チャネルは**メール**と**Slack DM**の 2 つ。
これとは別に、宛先がユーザーではなくチャンネルの通知として
[エージェント実行結果のチャンネル通知](#エージェント実行結果のチャンネル通知)がある。

## メンション通知の流れ

チケット本文・コメントのエディタで `@` により指名されたユーザーへ通知する。入口は `notifyMention()`(`src/lib/notify/notify-mention.ts`)ただ 1 つで、チケット作成 / 本文編集 / コメント投稿 / コメント編集(`src/app/(sidenav)/tickets/server.ts`、`src/app/(sidenav)/tickets/[id]/server.ts`)から呼ばれる。

- `next/server` の `after()` でレスポンス後に実行する。外部サービスとの往復でレスポンスを遅らせず、通知の失敗もチケット操作へ波及させない
- メンションした本人は宛先から除外する(自分の書き込みで自分に通知が飛ばない)
- 件名は `[表示ID] チケットタイトル`、リンク先は `/t/<表示ID>`。文面は宛先ユーザーのロケールで組み立てる
- メールと Slack は `Promise.allSettled` で並行に送る。片方のチャネルが失敗してももう片方は止まらない
- 1 回の通知で送る宛先は `MAX_NOTIFY_RECIPIENTS`(`src/lib/notify/notify.ts`、20 件)で頭打ちにする。暴走時に外部サービスを叩き続けないための歯止めで、超過分は警告ログのみ

## ユーザーごとの通知設定

`/account` の「通知設定」(`src/app/(sidenav)/account/notify.tsx`)で、イベント種別 × チャネルごとに ON/OFF を切り替える。項目数が少ないためフォームにせず切り替え即保存にしている。

- 保存先は `UserNotifySetting`(`userId` + `event` でユニーク)の `email` / `slack` 列
- **行が無い場合は全チャネル OFF** として扱うオプトイン方式。ON にしたときだけ行が作られるので、全ユーザー分の初期行を用意しなくてよい。絞り込み(`filterNotifiable()` / `src/lib/notify/notify-setting.ts`)も ON の行だけを引いて残す
- メールのスイッチは常に表示する。Slack のスイッチは Slack 連携を利用できるユーザーにのみ表示する

## メール通知の前提

`MAIL_SEND` が設定されていることが唯一の前提で、ユーザー側の連携作業は不要。メール通知を ON にしたユーザーだけが宛先(`User.email`)になる。

- `MAIL_SEND` 未設定の環境では `isMailConfigured()`(`src/lib/mail.ts`)が false になり、**通知メールは送信を試みずスキップされる**(OTP メールなど他の送信は `Unable to send email` エラーになる)
- 1 通ずつ送信し、1 通の失敗で残りの宛先を巻き添えにしない

## Slack通知の前提

Slack DM は以下の 3 段がすべて揃ったユーザーにだけ届く。どれかを満たさない相手は宛先から自然に消えるだけで、エラーにはならない。

1. **環境変数** : `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` / `SLACK_BOT_TOKEN` が揃っていること(`hasSlackCredentials()` / `src/lib/slack/slack-account.ts`)。`SLACK_TEAM_ID` は任意で、設定すると別ワークスペースのアカウントを連携の入口で弾く
2. **管理者による有効化** : `/admin/settings` で Slack 連携を有効にする。許可グループを指定した場合はそのグループのメンバーのみ、空の場合は全ユーザーが対象(設定は kvs の `SLACK` グループに保存)
3. **ユーザー本人の連携** : `/account` から Slack アカウントを OAuth 連携する(`account.providerId = 'slack'`)

送信は逐次で行い、Bot トークンが無効(`revoked`)と判定された時点で残りを打ち切る。

## エージェント実行結果のチャンネル通知

AIエージェントの自動運用(`docs/agent-runner.md`)は無人で動くため、実行履歴を見に行かないと結果が分からない。
**ボードごとに Slack チャンネルを設定**し、そのボードのチケットの実行が終わった時点で結果を投稿する。

入口は `notifyAgentRun()`(`src/lib/notify/notify-agent-run.ts`)ただ 1 つ。メンション通知と同じく
`after()` の中で送り、例外は握り潰してログに落とすだけでエージェントの実行記録へ波及させない。

- 設定は `Board.slackChannelId`。`/boards/[id]/settings` の「Slack通知」で選ぶ。**null なら通知しない**
- 設定できるのはボードの `owner` と管理者(`assertBoardAccess(..., 'manage')`)。
  プライベートボードは他の構成変更と同じく `assertTeamBoard` で弾く
- **通知するのは実行が終了したときだけ**(成功 / 失敗 / スキップ)。開始時は通知しない
- 呼ぶのは実行が閉じる 3 経路すべて(`src/lib/agent/agent-runner.ts`)。いずれもトランザクションを抜けた直後に呼ぶ

| 経路 | 関数 | 通知する条件 |
| --- | --- | --- |
| エージェント自身の報告(正常系) | `finishAgentTask` | 実行の行を実際に閉じたとき。ランナーを介さず MCP だけで動かした場合は実行の行が無いので通知もしない |
| ランナーの終了報告(保険) | `finishAgentRunById` | 報告が無いまま閉じたときだけ。報告済みなら `finishAgentTask` が既に通知している(二重送信の防止) |
| 時間切れ(60分) | `failStaleAgentRuns` | 潰した実行ぶん。まとめて時間切れになっても `MAX_NOTIFY_RECIPIENTS` 件で頭打ちにする |

- チケットが削除済みの実行は宛先のボードを辿れないので通知しない
- 投稿には表示ID・チケット名・エージェント名・処理種別・結果・所要時間と、エージェントが報告した要約を載せる。
  要約は `commentExcerpt()` で記法を落として引用 1 行にする
- ボタンのリンク先は**短縮URLではなくチケット詳細(`/tickets/<id>`)**。短縮URLはボードメンバーの
  可視スコープで解決するため、実行履歴の一覧(`agent-run-history.tsx`)と同じ判断に揃えている
- **宛先がユーザーではないのでロケールを解決する相手がいない**。文面は `t(null, ...)` で
  既定ロケール(`DEFAULT_LOCALE`)に固定する
- `UserNotifySetting` のオプトインとは独立している(チャンネルの購読者を個人設定では表せないため)。
  ただし管理者が `/admin/settings` で Slack 連携を無効にすれば、この通知も止まる

### 通知先チャンネルの一覧

`listSlackChannels()`(`src/lib/slack/slack-server.ts`)が `users.conversations` で取得する。

- `conversations.list` は Bot が未参加の公開チャンネルまで返すため、選んでも投稿時に `not_in_channel` で
  失敗するものが一覧に混ざる。`users.conversations` なら**「一覧に出ている = 必ず投稿できる」**が成立し、
  招待漏れによる設定ミスが構造的に起きない
- 一覧に出てこない = Bot が招待されていない、なので空のときは `/invite @Devuntu` を案内する
- 結果は 5 分キャッシュする。招待した直後は一覧に現れないことがある
- 保存時にも一覧と突き合わせ、含まれないIDは弾く(設定できたように見えて通知だけ届かない状態を作らない)
- スコープは `channels:read` / `groups:read`。**マニフェストにこれらが入る前に導入したワークスペースでは
  再インストールと `SLACK_BOT_TOKEN` の差し替えが必要**(不足していれば `missing_scope` が返る)
- **取得系のメソッドは form-urlencoded で送る**(`callSlackApi` の `encoding` に `'form'` を渡す)。
  Slack が JSON ボディを受け付けるのは `chat.postMessage` / `chat.unfurl` のように
  `application/json` を明記しているメソッドだけで、`users.conversations` へ JSON を送ると
  **エラーにならずパラメータが黙って無視される**。`types` が既定の `public_channel` へ戻るため、
  招待済みのプライベートチャンネルが `ok: true` のまま返らず、Bot 未招待と見分けが付かなくなる

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

| マニフェストの項目                                           | 用途                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `oauth_config.scopes.user`                                   | `/account` からの Sign in with Slack                     |
| `oauth_config.scopes.bot` の `chat:write`                    | メンション通知の DM 送信とボードのチャンネル通知         |
| `oauth_config.scopes.bot` の `links:read`                    | リンクの検知(`link_shared`)                              |
| `oauth_config.scopes.bot` の `links:write`                   | プレビューの反映(`chat.unfurl`)                          |
| `oauth_config.scopes.bot` の `channels:read` / `groups:read` | 通知先チャンネルの一覧取得(`users.conversations`)        |
| `features.unfurl_domains`                                    | 展開対象のドメイン                                       |
| `settings.event_subscriptions.request_url`                   | `/api/slack/events`                                      |

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

## イベント・チャネルを増やす場合

- **イベント** : Prisma の `NotifyEvent` enum と `NOTIFY_EVENTS`(`src/lib/notify/notify.ts`)を揃える。並びの一致は `tests/lib/notify/notify.test.ts` で固定している
- **チャネル** : `UserNotifySetting` に Boolean 列(既定 OFF に揃えるため `@default(false)`)を足し、`NOTIFY_CHANNELS`(`src/lib/notify/notify.ts`)と `scUpdateNotifySetting`(`src/lib/schema/schema.ts`)へ追加する
- `src/lib/notify/notify.ts` はクライアントからも import されるため、サーバー専用の処理は `notify-setting.ts`(設定の読み書き)と `notify-mention.ts` / `notify-agent-run.ts`(送信)へ置く
- 宛先が**チャンネル**の通知は `UserNotifySetting` では表せないので、上の 2 点は要らない。
  エージェント実行結果の通知と同じく、宛先の設定を持つエンティティ(ボードなど)へ列を足して送信の入口を 1 本作る
