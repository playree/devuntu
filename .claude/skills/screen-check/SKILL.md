---
name: screen-check
description: ブラウザで実際に画面を開いて表示・動作を確認する。「画面を確認して」「動作確認して」「かんばんの画面を見て」「画面のスクリーンショットを撮って」「UIを見て」「表示崩れを確認して」「ログインして画面を確認して」などの依頼で使う。Playwright MCP(headless Chromium)で localhost:3000 を開き、必要ならメールOTPログインを自動で行う。
---

# 画面の動作確認

Playwright MCP(サーバ名 `playwright`)で `http://localhost:3000` を開いて確認する。ヘッドレスのみ(DISPLAY 無し)。

## 大前提

- **開発DBはユーザーの実データ**。指示が無い限り、作成・更新・削除・ドラッグ移動などの変更操作はしない。表示確認のみを行う
- **必ず `http://localhost:3000`**。`BETTER_AUTH_URL` が localhost:3000 固定で、better-auth の origin チェックが `trustedOrigins` と照合するため、別ポートだと OTP 検証の POST `/api/auth/sign-in/email-otp` が 403(INVALID_ORIGIN)になり、画面には「認証NG」トーストしか出ず原因が分からない。`pnpm dev:domain`(3033)は使わない
- 画面一覧とアクセス制御は `README.md` の「画面一覧」を参照する
- 画面上のラベル文言は `src/locale/lang-ja.ts` を参照する。`data-testid` は存在しないので、role + 日本語ラベルで要素を特定する
- `playwright` MCP が未接続の場合は、`.mcp.json` 反映のために Claude Code の再起動が必要な旨をユーザーに伝える
- `.mcp.json` の `--browser chromium` は**外さない**。省略すると Google Chrome チャンネル(`/opt/google/chrome/chrome`)を探して起動に失敗する。ブラウザ本体は `pnpm exec playwright-mcp install-browser chromium` で `~/.cache/ms-playwright` に導入済み

## 1. 前準備

```sh
docker compose up -d db
curl -fsS --max-time 2 http://localhost:3000/api/health
```

- health が 200 → **既に起動中なので再利用する。再起動しない**
- 200 でない → 自分で起動する:

```sh
mkdir -p .work
setsid bash -c 'echo $$ > .work/dev-server.pid; exec pnpm dev' > .work/dev-server.log 2>&1 &
for i in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:3000/api/health)" = "200" ] && { echo ready; break; }
  sleep 2
done
curl -s -o /dev/null http://localhost:3000/auth/signin   # 初回コンパイルを先に済ませる
```

- **起動コマンドはこの形から変えない**(実測で決めた形)。`pnpm dev` は `pnpm` → `sh -c next dev` → `next dev` → `next-server` と子孫を作るため、単に `nohup pnpm dev &` + `echo $!` にすると記録した PID を kill しても子孫が生き残りサーバーが動き続ける。また `setsid nohup pnpm dev &` の `$!` は**即座に終了する setsid 自身の PID** なので使えない。
  上記の形なら `setsid` した bash がプロセスグループリーダーになり、`$$`(= PID = プロセスグループID)を記録した上で `exec` で同一 PID のまま `pnpm dev` に置き換わるので、グループごと確実に停止できる
- ページは初回リクエストでオンデマンドコンパイルされ、HeroUI / framer-motion を含む画面は 10〜40 秒かかることがある。`browser_navigate` がタイムアウトしたら同じ URL に再度ナビゲートする(2回目は速い)

## 2. 目的の画面を開く

確認したい URL に**直接**ナビゲートする(例: `http://localhost:3000/boards/<boardId>`)。
未ログインなら `src/proxy.ts` が `/auth/signin?cb=<元のURL>` にリダイレクトし、ログイン完了後に目的画面へ自動復帰する。`cb` 無しで signin を開くとログイン後に `/` へ飛ぶので、必ず目的 URL から入る。

- 目的画面が描画された → セッションがプロファイルに残っているのでログイン不要。3 へ
- `/auth/signin` に飛ばされた → 下記のログインを行う

## 3. メールOTPログイン

既定ユーザーは `kazuki.minakawa@funlab.jp`(admin)。別のユーザーで確認したい場合はユーザーに確認する。

1. `browser_snapshot` でフォームを確認し、ラベル `Eメール` の入力欄にメールアドレスを入力 → `次へ` ボタンをクリック
2. `Eメールに届いた認証コードを入力してください。` の表示を `browser_wait_for` で待つ
   - OTP は `src/app/auth/signin/server.ts` の `getUserByEmail` が `auth.api.sendVerificationOTP()` を await した時点で初めてDBに入る。**この表示を待つ前にDBを読むと空振りする**
3. OTP をDBから取得する(プライマリ):

```sh
docker exec devuntu-postgres psql -U devuser -d devuntu -Atc "select split_part(value, ':', 1) from verification where identifier = 'sign-in-otp-kazuki.minakawa@funlab.jp' and \"expiresAt\" > now() order by \"createdAt\" desc limit 1"
```

- `identifier` は `sign-in-otp-` + **小文字化した**メールアドレス。`value` は `<6桁数字>:<試行回数>`
- 有効期限は 300 秒。検証成功時に行は削除される
- 空が返る場合: ユーザーが存在しない / 期限切れ / 既に消費済み。画面の `再送`(30秒クールタイム)を押してから再取得する
- フォールバック(自分で起動したサーバーの場合のみ。`MAIL_SEND=debug` でメール本文がログに出る):

```sh
grep -aoE 'OTP : [0-9]{6}' .work/dev-server.log | tail -1
```

4. 6桁を `browser_type` で OTP 入力欄に一括入力する。**6桁目で自動サブミットされるので `認証` ボタンは押さない**(押すと二重サブミットになる)
   - 入力欄は透明な単一 input。効かない場合は入力欄をクリックしてフォーカスしてから `browser_press_key` で1桁ずつ入力する
   - 試行回数に上限があるので、誤った OTP を連打しない
5. 目的画面の要素が出るまで `browser_wait_for` で待つ

## 4. 確認する

- **描画完了は必ず「目的の要素の文言」で待つ**。かんばんのようにデータを Server Action で取得する画面は取得中 `PanelSkeleton` を返すため、ナビゲート直後にスクリーンショットを撮ると空のスケルトンだけが写る。かんばんならボード名(例 `テストボード`)を `browser_wait_for` で待ってから撮る

- `browser_snapshot` で構造を確認し、`browser_take_screenshot` で画像を残す
- **`browser_take_screenshot` の `filename` は必ず `.work/playwright/<名前>.png` のようにディレクトリ込みで指定する**。ファイル名だけを渡すと `--output-dir` ではなくリポジトリ直下(cwd)に出力され、リポジトリを汚す(`--output-dir` に従うのはスナップショット/コンソール/ネットワークのログのみ)
- **`browser_console_messages` でクライアントエラーを必ず確認する**。エラーがあれば報告に含める
- 通信を疑うときは `browser_network_requests`(403 ならポート / origin を疑う)
- レスポンシブ確認は `browser_resize`(既定は 1600x1000。サイドナビは 1024px 以上で常時表示、かんばんは `data-wide` で全幅)
- 変更操作(ドラッグでのチケット移動、保存、削除など)が必要な場合は**実行前にユーザーに確認する**。破壊的な確認になる場合は先に `pnpm db:backup` を勧める

## 5. 後片付け

確認が終わったら、**自分で起動した開発サーバーは停止する**。`.work/dev-server.pid` が存在しない場合はユーザーが起動したものなので触らない。

```sh
kill -- "-$(cat .work/dev-server.pid)" && rm -f .work/dev-server.pid
```

停止できたことを必ず確認する(子プロセスが残っていないこと):

```sh
curl -fsS --max-time 2 http://localhost:3000/api/health && echo "STILL RUNNING" || echo STOPPED
pgrep -af 'next dev|next-server' || echo none
```

残っていた場合は残存 PID を直接 kill する。

## 6. 報告

- 見たままの事実(表示内容・崩れ・エラー)と、スクリーンショットのパスを日本語で報告する
- 期待と違う場合は、コンソールエラー / ネットワーク応答 / `.work/dev-server.log` の該当行を根拠として添える
