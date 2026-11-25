---
name: screen-check
description: ブラウザで実際に画面を開いて表示・動作を確認する。「画面を確認して」「動作確認して」「かんばんの画面を見て」「画面のスクリーンショットを撮って」「UIを見て」「表示崩れを確認して」「ログインして画面を確認して」などの依頼で使う。Playwright MCP(headless Chromium)で localhost:3000 を開き、必要ならメールOTPログインを自動で行う。
---

# 画面の動作確認

Playwright MCP(サーバ名 `playwright`)で `http://localhost:3000` を開いて確認する。ヘッドレスのみ(DISPLAY 無し)。

## 大前提

- **開発DBはユーザーの実データ**。指示が無い限り、作成・更新・削除・ドラッグ移動などの変更操作はしない。表示確認のみを行う
- 確認が終わったら「5. 後片付け」まで実施する。同じクライアントの別セッションでは、同時に同じブラウザプロファイルを使えない
- **既定は `http://localhost:3000`**(`pnpm dev`)。`.env` の `BETTER_AUTH_URL` が localhost:3000 なので、`pnpm dev` を別ポートで開くと better-auth が返すリダイレクト先や Cookie のオリジンが食い違い、画面には「認証NG」トーストしか出ず原因が分からない
- ドメイン運用での確認が必要な場合のみ `pnpm dev:domain` を使う。未追跡の `.env.domain`(`PORT` / `BETTER_AUTH_URL` / `DEV_ALLOWED_ORIGINS`)を読み込んで起動するので、そこで指定したドメインの URL でアクセスする。ログ出力先は `.work/dev-domain.log`
- 画面一覧とアクセス制御は `docs/dev/screens.md` を参照する
- 画面上のラベル文言は `src/locale/lang-ja.ts` を参照する。`data-testid` は存在しないので、role + 日本語ラベルで要素を特定する
- リポジトリのルートで作業する。`playwright` MCP が使えない場合は、[開発ガイド](../../../docs/dev/development.md#画面の動作確認)のクライアント設定を確認する
- Chromium は `pnpm exec playwright-mcp install-browser chromium` で導入する。ブラウザプロファイルは `.work/playwright/profiles/` 配下にクライアント別に保存される

## 1. 前準備

```sh
ss -H -ltnp 'sport = :3000'
curl -fsS --max-time 2 http://localhost:3000/api/health
```

- 既にポート 3000 にリスナーがいる場合は、`ss` に表示された PID の `/proc/＜PID＞/cwd` を `readlink -f` で確認し、現在の `pwd -P` と比較する。同じ worktree の Devuntu が起動していて health が 200 なら再利用する。起動中なら準備完了まで待つ
- 別の worktree や用途でポート 3000 が使用中の場合や、リスナーの所属が確認できない場合は、そのサーバーを使わず状況を伝える
- ポート 3000 が空いている場合は、開発DBを用意してからサーバーを起動する

```sh
docker compose up -d --wait --no-recreate db
mkdir -p .work
dev_server_pid_file=$(mktemp --suffix=.pid .work/dev-server.XXXXXX)
setsid bash -c 'printf "%s\n" "$$" > "$1"; exec pnpm dev --port 3000' bash "$dev_server_pid_file" >> .work/dev-server.log 2>&1 &
for i in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:3000/api/health)" = "200" ] && { echo ready; break; }
  sleep 2
done
```

- 起動後もポート 3000 のリスナーを確認する。起動に失敗した場合は `.work/dev-server.log` を調べる
- `setsid` でサーバーを専用のセッションに置き、起動したプロセスグループの ID を今回作成した PID ファイルに記録する。後片付けに使うため、ファイルのパスを控えておく。ポートを明示して、競合時に Next.js が別のポートで起動するのを防ぐ
- ページは初回リクエストでオンデマンドコンパイルされ、HeroUI / framer-motion を含む画面は 10〜40 秒かかることがある。`browser_navigate` がタイムアウトしたら同じ URL に再度ナビゲートする(2回目は速い)

## 2. 目的の画面を開く

確認したい URL に**直接**ナビゲートする(例: `http://localhost:3000/boards/<boardId>`)。
未ログインなら `src/proxy.ts` が `/auth/signin?cb=<元のURL>` にリダイレクトし、ログイン完了後に目的画面へ自動復帰する。`cb` 無しで signin を開くとログイン後に `/` へ飛ぶので、必ず目的 URL から入る。

- 目的画面が描画された → セッションがプロファイルに残っているのでログイン不要。4 へ
- `/auth/signin` に飛ばされた → 下記のログインを行う

## 3. メールOTPログイン

確認用アカウントは環境変数 `DEVUNTU_SCREEN_CHECK_EMAIL`、または Git 管理外の `.work/screen-check.env` から取得する。ログインフォームと OTP の検索には同じ値を使う。

```sh
DEVUNTU_SCREEN_CHECK_EMAIL=$(node --env-file-if-exists=.work/screen-check.env -p 'process.env.DEVUNTU_SCREEN_CHECK_EMAIL ?? ""')
```

値が空で、ログインが必要な場合は、どの開発用アカウントで確認するかをユーザーに確認する。

1. `browser_snapshot` でフォームを確認し、ラベル `Eメール` の入力欄にメールアドレスを入力 → `次へ` ボタンをクリック
2. `Eメールに届いた認証コードを入力してください。` の表示を `browser_wait_for` で待つ
   - OTP は `src/app/auth/signin/server.ts` の `getUserByEmail` が `auth.api.sendVerificationOTP()` を await した時点で初めてDBに入る。**この表示を待つ前にDBを読むと空振りする**
3. OTP を開発DBから取得する。別のシェルで実行する場合は、上のコマンドでメールアドレスを読み込んでから実行する。

   ```sh
   docker compose exec -T db psql -U devuser -d devuntu -v otp_email="$DEVUNTU_SCREEN_CHECK_EMAIL" -At <<'SQL'
   select split_part(value, ':', 1) from verification
   where identifier = 'sign-in-otp-' || lower(:'otp_email') and "expiresAt" > now()
   order by "createdAt" desc limit 1;
   SQL
   ```

   - `identifier` は `sign-in-otp-` + **小文字化した**メールアドレス。`lower()` がその小文字化。`value` は `<6桁数字>:<試行回数>`
   - メールアドレスは psql 変数(`-v` / `:'otp_email'`)として渡す。SQL リテラルへ直接埋め込むと `'` を含むアドレスでクエリが壊れる。`-c` では psql 変数が展開されないので標準入力から流す
   - 有効期限は 300 秒。検証成功時に行は削除される
   - 空が返る場合: ユーザーが存在しない / 期限切れ / 既に消費済み。画面の `再送`(30秒クールタイム)を押してから再取得する
   - 両方で同じアカウントを使う場合は、片方の OTP 入力が終わってからもう片方で発行する

4. 6桁を `browser_type` で OTP 入力欄に入力する。`slowly: true` で1桁ずつ入力できる。**6桁目で自動サブミットされるので `認証` ボタンは押さない**(押すと二重サブミットになる)
   - 試行回数に上限があるので、誤った OTP を連打しない
5. 目的画面の要素が出るまで `browser_wait_for` で待つ

## 4. 確認する

- **描画完了は必ず「目的の要素の文言」で待つ**。かんばんのようにデータを Server Action で取得する画面は取得中 `PanelSkeleton` を返すため、ナビゲート直後にスクリーンショットを撮ると空のスケルトンだけが写る。かんばんならボード名(例 `テストボード`)を `browser_wait_for` で待ってから撮る

- `browser_snapshot` で構造を確認し、`browser_take_screenshot` で画像を残す
- **`browser_take_screenshot` の `filename` は `.work/playwright/<名前>.png` のようにディレクトリ込みで指定する**。明示した相対パスはリポジトリのルートを基準に解決される
- **`browser_console_messages` でクライアントエラーを必ず確認する**。エラーがあれば報告に含める
- 通信を疑うときは `browser_network_requests`(403 ならポート / origin を疑う)
- レスポンシブ確認は `browser_resize`(既定は 1600x1000。サイドナビは 1024px 以上で常時表示、かんばんは `data-wide` で全幅)
- 変更操作(ドラッグでのチケット移動、保存、削除など)が必要な場合は**実行前にユーザーに確認する**。破壊的な確認になる場合は先に `pnpm db:backup` を勧める

## 5. 後片付け

1. 自分が開いたブラウザを `browser_close` で閉じる。終了できない場合は使用したプロファイルのプロセスを特定し、他セッションのブラウザを巻き込まないようにする。ログインセッションはプロファイルに保存される。
2. **この確認のために起動した場合のみ**、開発サーバーを停止する。今回のファイルから `dev_server_pid=$(cat "$dev_server_pid_file")` で PID を読み、`ps -p "$dev_server_pid" -o pid=,pgid=,args=` と `readlink -f /proc/"$dev_server_pid"/cwd` で、対象が現在の worktree の `pnpm dev` のグループリーダーであることを確かめてから `kill -- "-$dev_server_pid"` を実行する。既存サーバーを再利用した場合、PID ファイルの有無にかかわらず停止しない。
3. `ps -s "$dev_server_pid" -o pid=,args=` でそのセッションにプロセスが残っていないことを確認し、今回作成した PID ファイルを片付ける。

## 6. 報告

- 見たままの事実(表示内容・崩れ・エラー)と、スクリーンショットのパスを日本語で報告する
- 期待と違う場合は、コンソールエラー / ネットワーク応答 / `.work/dev-server.log` の該当行を根拠として添える
