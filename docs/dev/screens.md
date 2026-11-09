---
type: design_doc
title: 画面一覧とアクセス制御
updated: 2026-11-08
---

# 画面一覧とアクセス制御

開発者向け(画面・API の実装とアクセス制御)。画面の使い方は [user-guide.md](../guide/user-guide.md)、
導入・運用は [installation.md](../admin/installation.md) / [operations.md](../admin/operations.md) を参照。

## アクセス制御の仕組み

パス単位の制御は `src/proxy.ts`(Next.js Proxy)が `src/lib/auth/auth-config.ts` の設定に従って行う。

- **認証必須** : `/auth/signin` `/start` `/cal/:id` `/maintenance` 以外の全ページ。未ログインは `/auth/signin?cb=<元のURL>` へリダイレクト
- **管理者のみ** : `/admin/**`。`role !== 'admin'` の場合は 404 へ rewrite(メニューにも表示されない)
- **2要素認証** : `TWO_FA_REQUIRED=true` かつ `PASSWORDLESS_AUTH_ENABLED=false` の場合、2FA未設定なら `/auth/signin?mode=2FA` へリダイレクト。`TWO_FA_REQUIRED=false` の場合はサインイン時の 2FA チャレンジを行わないため、`twoFactorEnabled` が true の利用者もパスワードのみでサインインする(`?mode=2FA` へ直接アクセスした場合も通常のサインイン画面になる)
  - Server Action・API・OAuth の認可は Proxy の誘導を通らないので、同じ判定(`requiresTwoFaSetup()`、`src/lib/auth/two-fa.ts`)を入口でも行う。
    `safeAuthAction` は `INVALID_SESSION` を返し(2FA 設定前に呼ぶ必要がある Action だけ metadata に `allowWithoutTwoFa: true`)、
    セッションで認証する API は `getActiveSession()` で未ログインと同じ扱いにし、`/api/auth/oauth2/authorize` は `TWO_FACTOR_REQUIRED` で拒否する。
    `/api/mcp` も、2FA 未設定の人の PAT / OAuth アクセストークンを `invalid_token`(401)で拒否する(2FA を必須にする前に発行されたトークンも含む。エージェントのトークンは対象外)
- **検索エンジンのインデックス** : インデックスの可否は `SEARCH_ENGINE_INDEXING`(`<meta name="robots">`・`X-Robots-Tag`)、`/robots.txt` でのクロールの可否は `SEARCH_ENGINE_ROBOTS_ALLOW` で決まる(いずれも既定は拒否)。詳細は [environment-variables.md](../admin/environment-variables.md#基本) を参照
- **メンテナンスモード** : フラグファイルがあると、画面・Server Action・API を Proxy が 503 で遮断する(画面は `/maintenance` へ rewrite)。セッションを見ないため**管理者も含めて全員が対象**。通すのは `/api/health`(監視)と、メンテナンス画面の表示に要る `_next/*` と `/favicon.ico` だけ。詳細は [operations.md](../admin/operations.md#メンテナンスモード) を参照
- Proxy の matcher が除外するのは `_next/*` だけで、`api/**`・Server Action(POST かつ `next-action` ヘッダ)・静的アセットも Proxy を通る(メンテナンスモードの遮断を Proxy 1箇所に集約するため)。ただし通常時はいずれも認証処理を通さず素通しするので、レコード単位の認可(ボード/チケットの参照・編集権限)は従来どおり各 Server Action 側で `assertBoardAccess` / `assertTicketAccess`(`src/lib/board/board-access.ts`)により検証する

ボードの権限は直接メンバー(`BoardMember`)またはグループ経由(`BoardGroup`)で解決され、`owner` / `member` のロールを持つ。

認証処理を通さないパスの判定は `isProxyAuthBypassPath()`(`src/lib/auth/auth-config.ts`)にある。
`/api/**`、`/.well-known/**`、ルート直下と `/agent/` 直下(ランナーの配布物)の拡張子付きファイルが対象で、`/sw.js`(Service Worker)や
`/manifest.webmanifest`(PWA manifest)、`/robots.txt` は認証をかけずに配信される。
拡張子の判定をルート直下に絞っているのは、`/tickets/x.y` のような動的セグメントの画面まで素通しにしないため。
`public/` に配下のディレクトリを足す場合は `isProxyAuthBypassPath()` にも加える。
**matcher 側の除外にしないのは、matcher から外れたパスは Proxy 自体が動かずメンテナンス時に
遮断できないため**(`/api/upload/<uuidv7>.webp` のような拡張子を持つルートハンドラが素通しになる)。
例外はアップロードの POST 先 `/api/upload`(ちょうど)だけで、matcher から外してメンテナンスの遮断をルート側で行う。
Proxy は通るリクエストのボディを既定 10MB まで複製して溜め、超えた分を黙って切り捨てるため、ファイル添付が壊れる。

## 一般

| 画面名称           | パス                           | アクセス制御                                                                                        |
| ------------------ | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| ダッシュボード     | `/`                            | 認証必須                                                                                            |
| カレンダー         | `/cal`                         | 認証必須 + Googleアカウント連携が利用可能なユーザーのみ(不可の場合は案内を表示)                     |
| アカウント         | `/account`                     | 認証必須(自分のアカウント情報のみ)                                                                  |
| エージェント       | `/agents`                      | 認証必須(自分が承認者に設定されているエージェントのみ表示)                                          |
| リモート実行       | `/commands`                    | 認証必須 + リモート実行が有効で、ターゲットにアサインされているユーザーのみ                         |
| ターゲット設定     | `/commands/targets/[targetId]` | 認証必須 + 対象ターゲットのメンバー。コマンド定義の編集は owner のみ                                |
| リモート実行の履歴 | `/commands/runs`               | 認証必須。一般は自分の実行のみ、管理者は全件も表示できる(`?commandKey=` でコマンド単位に絞り込める) |
| リモート実行の詳細 | `/commands/runs/[id]`          | 認証必須 + 実行者本人または管理者のみ                                                               |

`/commands` 以下の画面は `COMMAND_EXEC_ENABLED=true` のときだけ表示される。ターゲットにアサインされて
いないユーザーにはメニューにも出ない(管理者でもアサインが無ければ実行できない)。アサインとロールの
考え方は [command-exec.md](../admin/command-exec.md#権限) を参照。

## タスク管理

| 画面名称                        | パス                    | アクセス制御                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ボード一覧                      | `/boards`               | 認証必須(自分がアクセスできるボードのみ表示)                                                                                                                                                                                                                                                                 |
| かんばん                        | `/boards/[id]`          | 認証必須 + 対象ボードの参照権限(`owner` / `member`)                                                                                                                                                                                                                                                          |
| ボード設定                      | `/boards/[id]/settings` | 認証必須 + 対象ボードの参照権限。メンバー/グループ/タグ・AI向けコンテキスト・チケットテンプレートの変更と Git 連携(provider ごと)の閲覧・変更は `owner` または管理者のみ。テンプレートの閲覧はメンバーなら可能                                                                                               |
| ボードノート                    | `/boards/[id]/notes`    | 認証必須 + 対象ボードの参照権限。ナレッジ / メモリの閲覧と履歴はメンバーなら可能。追加・編集・削除・昇格 / 降格・履歴からの復元はメンバー(アーカイブ済みのボードは不可)                                                                                                                                      |
| チケット一覧                    | `/tickets`              | 認証必須(アクセスできるボードのチケットのみ表示)。`?boardId=` / `?status=`(複数可) / `?assignee=`(`none` = 未割り当て) / `?relatedTo=`(表示ID) / `?relation=`(`child` / `related` / `all`)で初期の絞り込みを指定できる                                                                                       |
| チケット詳細                    | `/tickets/[id]`         | 認証必須 + 対象チケットの参照権限(所属ボード経由で判定)。親子・関連と順番待ちはボードのメンバーにだけ表示し、変更履歴は閲覧できる人全員に表示                                                                                                                                                                |
| チケット表示IDでの参照          | `/t/[displayId]`        | 認証必須。表示ID(`ボードキー-番号`)で `findTicketIdByDisplayId`(`src/lib/board/board-access.ts`)が参照権限を判定し、`/tickets/[id]` へリダイレクト。アクセスできない場合は存在しない場合と同じく404                                                                                                          |
| チケットの印刷(PDF / HTML 出力) | `/print/tickets/[id]`   | 認証必須 + 対象チケットの参照権限(チケット詳細と同じ `getTicket` で判定)。サイドバー無し。`?comment=<id>` でプラン/報告書/アナウンスの 1 件だけを出す(通常のコメント・存在しない ID は権限なしと同じ表示)。`?format=html` で印刷ダイアログの代わりに HTML ファイルを保存する。配下はダーク設定でもライト表示 |

## Wiki

| 画面名称          | パス                   | アクセス制御                                                                                                                                                    |
| ----------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wiki スペース一覧 | `/wiki`                | 認証必須(閲覧できるスペースのみ表示)。スペースの作成はログインユーザーなら誰でも可能で、作成者が `owner` になる                                                 |
| スペースのトップ  | `/wiki/[key]`          | 認証必須 + スペースの閲覧権限(`viewer` 以上。`everyone` のスペースは全ログインユーザー)。割り当ての無い管理者は、ページ一覧を出さずに設定への導線だけを表示する |
| ページ詳細        | `/wiki/[key]/[number]` | 認証必須 + スペースの閲覧権限。作成・編集・移動・削除・版の復元は `editor` 以上かつ未アーカイブ                                                                 |
| スペース内検索    | `/wiki/[key]/search`   | 認証必須 + スペースの閲覧権限。条件は `?q=` と `?tags=`(複数可)で持つ。`/wiki?q=` は閲覧できる全スペース(アーカイブ済みを除く)の横断検索                        |
| スペース設定      | `/wiki/[key]/settings` | 認証必須 + `owner` または管理者                                                                                                                                 |

権限はスペース単位で、直接割り当て(`WikiSpaceMember`)・グループ(`WikiSpaceGroup`)・ボード(`WikiSpaceBoard`。ボードのメンバーが対象)のうち最も強いロールを採る。
判定は `src/lib/wiki/wiki-access.ts`(`assertWikiSpaceAccess`)、割り当ての変更は `src/lib/wiki/wiki-assignment.ts`。

- `owner` はユーザーの直接割り当てに限り、最後の `owner` を外す・降格する変更は拒む(管理者は除く)
- 割り当てられるボードは、アーカイブしていないチームボードのうち操作者が参加しているもの(管理者はすべて)
- スペース内の画面は `wiki/[key]/layout.tsx` でスペース・ツリー(本文なし。タグの ID 付き)・タグを 1 度だけ取得し、`SideNavPortal` でサイドメニューへツリーを差し込む
- タグ(`src/lib/wiki/wiki-tag.ts`)はスペースごと。作成は `editor` 以上、更新・削除は `manage`。ページへの付与は `assertWikiTagIdsInSpace` で同じスペースのタグに限る
- 版(`src/lib/wiki/wiki-revision.ts`)の一覧は本文を含めず、差分を出すときに選んだ版と1つ前の版の本文だけを引く(本文の最大長 × 版数を一度に転送しない)。
  復元(`restoreWikiPageRevision`)は、存在するページならタイトル・本文・タグだけを戻して位置を変えず、削除済みなら同じ id・番号で作り直す(親が無い・深さの上限を超えるならスペース直下)。
  スペースのトップの「削除済みのページ」は、ページごとに最後の `deleted` の版を引き、いま存在するページを除いて出す
- 検索(`src/lib/wiki/wiki-search.ts`)は `$queryRaw` で組む
  - 語ごとに、3文字以上なら「title / content の ILIKE(`gin_trgm_ops` の GIN 索引で BitmapOr)とタグ名の完全一致の UNION」に `IN` で当てる。タグとの OR を EXISTS で書くと索引が使われなくなるため
  - 2文字以下の語はトライグラムが作れず索引が効かないので、他の語で絞った行へのフィルタとして書く(すべての語が短いときだけ全件を走査する)
  - 並べて `LIMIT` を掛けてから、本文の一致位置の前後だけを `substr` で返す(本文の全文は転送しない)
  - 確かめ方: 開発 DB でダミーページを数万件入れ、`gin_clean_pending_list` で GIN の pending list を掃いて `ANALYZE` した後、`EXPLAIN ANALYZE` で `Bitmap Index Scan on wiki_page_*_trgm_idx` が出ることを見る。
    同じトランザクションで入れた行は pending list に残り、索引のコストが高く見積もられて seq scan が選ばれるので、掃かずに比べない

## 管理者

いずれも `/admin/**` 配下のため管理者(`role === 'admin'`)のみアクセス可能。

| 画面名称             | パス                         | アクセス制御                                                               |
| -------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| ユーザー管理         | `/admin/users`               | 管理者のみ                                                                 |
| エージェント管理     | `/admin/agents`              | 管理者のみ                                                                 |
| エージェント詳細     | `/admin/agents/[id]`         | 管理者のみ                                                                 |
| グループ管理         | `/admin/groups`              | 管理者のみ                                                                 |
| ダッシュボード管理   | `/admin/dashboard`           | 管理者のみ                                                                 |
| 設定(連携設定)       | `/admin/settings`            | 管理者のみ                                                                 |
| OIDCクライアント     | `/admin/oidc-clients`        | 管理者のみ                                                                 |
| リモート管理         | `/admin/commands`            | 管理者のみ。ターゲットの一覧と、定義に存在しないターゲットのアサインの削除 |
| ターゲットのアサイン | `/admin/commands/[targetId]` | 管理者のみ。ユーザー / グループのアサインとロールの設定                    |

## 認証・公開

| 画面名称         | パス           | アクセス制御                                                                                                                                                                                                                                         |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| サインイン       | `/auth/signin` | 認証不要。`?mode=2FA` で2FA設定の誘導、`?cb=` でサインイン後の遷移先を指定                                                                                                                                                                           |
| 初期セットアップ | `/start`       | 認証不要。初期セットアップ済みの場合は `/` へリダイレクト                                                                                                                                                                                            |
| 空き時間の共有   | `/cal/[id]`    | **認証不要の公開ページ**。共有URLの `publicId` で参照。無効化済み/不正なIDは404。noindex。表示できる週は今週の 4 週前から 12 週後まで(範囲外の `?date=` は端の週)。Google への問い合わせは週ごとに 5 分キャッシュする(所有者あたり 5 分に週の数まで) |
| 認可の同意       | `/consent`     | 認証必須。OAuthクライアントの認可要求(署名付きクエリ)を提示して表示する同意画面                                                                                                                                                                      |
| メンテナンス中   | `/maintenance` | 認証不要。メンテナンスモード中に Proxy が 503 で rewrite する案内画面。noindex                                                                                                                                                                       |

## API

Proxy は認証処理を通さず素通しするため、各ルートハンドラ内で個別に認証する(メンテナンスモード中の遮断だけは Proxy が行う)。

| パス                                               | アクセス制御                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/auth/[...all]`                               | Better Auth のハンドラ(認証処理自体)。`/update-user` は `disabledPaths` で塞いでいる(`user.image` を任意の値にできるため)。パスワード認証が有効な場合は emailOTP プラグインのエンドポイント(`/sign-in/email-otp`・`/email-otp/*` など)も塞ぐ(メールだけでパスワード + 2FA を迂回できるため) |
| `/api/auth/.well-known/openid-configuration`       | 認証不要(OIDC ディスカバリ)                                                                                                                                                                                                                                                                 |
| `/api/auth/.well-known/oauth-authorization-server` | 認証不要(RFC 8414 認可サーバーメタデータ)                                                                                                                                                                                                                                                   |
| `/.well-known/oauth-authorization-server/api/auth` | 認証不要(RFC 8414 のパス挿入形式。同じ内容を返す)                                                                                                                                                                                                                                           |
| `/.well-known/oauth-protected-resource/api/mcp`    | 認証不要(RFC 9728 保護リソースメタデータ)                                                                                                                                                                                                                                                   |
| `/api/auth/oauth2/register`                        | 認証不要(RFC 7591 動的クライアント登録)。`OIDC_DCR_ENABLED` 時のみ。戻り先はループバック・private-use スキームと `OIDC_DCR_ALLOWED_REDIRECT_URIS` に限る                                                                                                                                    |
| `/api/mcp`                                         | アクセストークン必須(未提示・無効は401、スコープ不足は403。いずれも `WWW-Authenticate` を返す)                                                                                                                                                                                              |
| `/api/health`                                      | 認証不要(ヘルスチェック)                                                                                                                                                                                                                                                                    |
| `/api/agent/status`                                | エージェント用トークン必須(POST)。稼働条件と処理対象チケットを返す                                                                                                                                                                                                                          |
| `/api/agent/runs`                                  | エージェント用トークン必須(POST)。実行の開始を記録                                                                                                                                                                                                                                          |
| `/api/agent/runs/[id]`                             | エージェント用トークン必須(PATCH)。実行の終了を記録                                                                                                                                                                                                                                         |
| `/agent/devuntu_agent.py`                          | 認証不要(`public/` の静的配布)。ランナー本体。秘密情報は含まない                                                                                                                                                                                                                            |
| `/agent/agent-setup-guide.md`                      | 認証不要(`public/` の静的配布)。セットアップ手順の雛形(MCP の `get_agent_setup_guide` が値を埋めて返す)。秘密情報は含まない                                                                                                                                                                 |
| `/agent/agent-user.png`                            | 認証不要(`public/` の静的配布)。AIエージェント用ユーザーのアバター画像                                                                                                                                                                                                                      |
| `/api/upload`                                      | 認証必須(セッション、またはMCPの短命トークン)。画像・ファイルのアップロード(POST。クエリ `?kind=file` でファイル)。添付先はフォームの `boardId`(書き込めるボード)か `wikiSpaceId`(editor 以上かつ未アーカイブのスペース)で、同時指定は400、権限が無ければ403                                |
| `/api/upload/[filename]`                           | 認証必須(未ログインは401。MCPの `get_file` が発行したダウンロードトークンも可)。画像・ファイルの配信(GET。画像以外はダウンロードさせる)。添付先のボード / Wiki スペースを閲覧できない場合は404(判定は `src/lib/storage/attachment-access.ts`)                                               |
| `/api/avatar/[filename]`                           | **認証不要**。`user.image` から参照中のキーだけを配信(GET)                                                                                                                                                                                                                                  |
| `/api/slack/events`                                | 認証不要。Slack の署名検証だけが門番(POST)                                                                                                                                                                                                                                                  |
| `/api/github/webhook/[id]`                         | 認証不要。対応付けごとのシークレットによる GitHub の署名検証だけが門番(POST)。対応付けが無ければ404                                                                                                                                                                                         |
| `/api/gitlab/webhook/[id]`                         | 認証不要。対応付けごとのトークン(署名 / シークレット)の検証だけが門番(POST)。`GITLAB_URLS` 未設定・対応付けが無ければ404                                                                                                                                                                    |
| `/api/webpush/key`                                 | 認証必須。VAPID 公開鍵を返す(GET)。Service Worker の再購読用                                                                                                                                                                                                                                |
| `/api/webpush/subscribe`                           | 認証必須。`pushsubscriptionchange` の再購読報告(POST)                                                                                                                                                                                                                                       |
| `/api/command/runs/[id]/stream`                    | 認証必須 + 実行者本人または管理者。実行ログのSSE配信(GET)                                                                                                                                                                                                                                   |

ほかの `public/` 配下(`/sw.js`・PWA のアイコン・ロゴ)も、ルート直下の拡張子付きファイルとして認証なしで配信される。

### Git 連携の Webhook

- マージでチケットを完了にする設定は provider ごと。オンにした側のマージ / クローズのたびに、紐付いたプルリクエスト(マージリクエスト)が
  すべてマージかクローズになり、1件以上マージされていればチケットを完了にする(システムの操作として扱い、チャネル通知の完了イベントも飛ぶ)。
  判定に使うのは対応付けたリポジトリ(GitHub / GitLab を問わない)のものだけで、それ以外のリポジトリのものは状態が届かないので含めない
- 完了にする前に、provider ごとの判定(`BoardGitSetting.mergeCriteriaCheck`。`none` / `checkedOrReported`(既定)/ `checked`)で受け入れ条件を見る。
  未達が残れば完了にせず、変更履歴(`mergeHeld`。変更前に PR / MR、変更後に未達の条件)と通知(`ticket_merge_held`)を残す。
  同じ PR / MR の保留が履歴にあるか、最後のステータス変更より後に保留済みなら何も残さない(再配信や、紐付いた別の PR / MR の閉じたイベントで重ねない)。
  保留後に条件がそろっても自動では完了にしない
- `GITLAB_URLS` から外したインスタンスの対応付けは、一覧に残って外せる。状態が届かなくなるので、マージで完了の判定には含めない
- ブランチ名からの自動紐付けで見るのは、ブランチ名の先頭の表示ID 1件だけ。PR / MR を出した側のリポジトリが連携先と同じもの(GitHub は `pull_request.head.repo.full_name`、GitLab は `source_project_id` と `target_project_id` で比べる)に限り、フォークからのものは紐付けない
- GitLab の署名トークンは本文・送信時刻への HMAC 署名。署名トークンを設定したプロジェクトは、シークレットトークン(`X-Gitlab-Token`。値をそのまま送る方式)だけのリクエストを受け付けない
- CI の失敗・レビュー指摘による自動差し戻しは [agent-runner-internals.md](agent-runner-internals.md#自動差し戻しci-の失敗レビュー指摘) を参照
