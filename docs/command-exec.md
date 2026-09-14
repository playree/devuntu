- [全体の流れ](#全体の流れ)
- [定義ファイル](#定義ファイル)
  - [ホスト](#ホスト)
  - [コマンド](#コマンド)
  - [入力項目](#入力項目)
  - [引数の組み立て](#引数の組み立て)
- [実行先のパターン](#実行先のパターン)
- [SSH の準備](#sshの準備)
  - [リモート側の堅牢化(推奨)](#リモート側の堅牢化推奨)
- [権限](#権限)
- [安全性の考え方](#安全性の考え方)
- [実行の記録](#実行の記録)
- [詰まったときに見る場所](#詰まったときに見る場所)

# 画面からのコマンド実行

あらかじめ定義しておいた処理を画面のボタンから実行し、出力をリアルタイムで見る仕組み。
デプロイやバッチの再実行など、これまでサーバーへ SSH して手作業していた運用を画面へ寄せるためのもの。

既定では無効。`COMMAND_EXEC_ENABLED=true` と定義ファイルの配置の両方が揃って初めて動く
(環境変数の一覧は [environment-variables.md](environment-variables.md#コマンド実行) を参照)。

利用者から見た使い方は [user-guide.md](user-guide.md#コマンドを実行する) を参照。

## 全体の流れ

```
commands.yaml ──> /commands(実行できるコマンドの一覧)
                      │  選択して実行
                      ▼
              command_run を queued で作成 ──> ワーカーが掴む
                                                  │
                                                  ▼
                                        ssh <host> '<コマンド>'
                                                  │ 出力
                                                  ▼
                                        command_run_chunk へ保存
                                                  │
                      /commands/runs/[id] <──SSE──┘
```

実行は待ち行列に積まれ、ワーカーが順に処理する。押した瞬間に走るのではないのは、
リクエストの寿命と実行の寿命を切り離すため(長時間のジョブでもレスポンスを待たせず、
アプリの再起動にも耐えられる)。

**出力は必ず DB を経由して画面へ届く。** 実行しているプロセスと画面の接続を直接つながないので、
途中から見る・別のタブで見る・リロードする・終わってから履歴として見る、がすべて同じ経路になる。

## 定義ファイル

実行できる処理の定義そのもの。`COMMAND_DEF_PATH`(既定 `/app/config/commands.yaml`)へ置く。
**画面からは作成も編集もできない。** 画面で管理するのは有効化・許可グループ・表示順だけ。
Web 経由で任意のコマンドを仕込む経路を作らないための切り分け。

ファイルを更新すると数秒で自動的に読み直される(`/admin/commands` の再読み込みボタンで即時反映も可能)。
**読み込みに失敗した場合は直前の内容を保持しない。** 修正するまでコマンドは実行できない状態になる。
古い定義で動き続けると「直したつもりが反映されていない」ことに気付けないため。

```yaml
version: 1

hosts:
  - id: web01
    label: Web サーバー
    host: web01.internal
    port: 22
    user: deploy
    identityFile: ops_ed25519

commands:
  - id: deploy-web
    label: Web デプロイ
    description: Web アプリを指定環境へデプロイする
    hostId: web01
    executable: /opt/bin/deploy.sh
    args: ['{{env}}', '{{verbose}}']
    inputs:
      - type: select
        key: env
        label: 環境
        options:
          - { value: staging, label: ステージング }
          - { value: production, label: 本番 }
      - type: checkbox
        key: verbose
        label: 詳細ログ
        whenTrue: ['--verbose']
    timeoutSec: 900
    requireConfirm: true
    confirmText: 本番環境へデプロイします。よろしいですか?
    requireFreshSession: true
    singleton: true
    sortOrder: 10
```

### ホスト

| 項目             | 必須 | 説明                                                                                     |
| ---------------- | ---- | ---------------------------------------------------------------------------------------- |
| `id`             | 〇   | 英数字で始まる 2〜64 文字。`commands[].hostId` から参照する                              |
| `label`          | 〇   | 画面に出す表示名。**ホスト名やユーザー名は画面に出さない**ので、ここだけが手がかりになる |
| `host`           | 〇   | 接続先                                                                                   |
| `port`           |      | 既定 22                                                                                  |
| `user`           | 〇   | 接続ユーザー                                                                             |
| `identityFile`   | 〇   | `COMMAND_SSH_DIR` 配下の**ファイル名**。パスやディレクトリ区切りは書けない               |
| `knownHostsFile` |      | 省略時は `COMMAND_SSH_KNOWN_HOSTS`                                                       |

### コマンド

| 項目                  | 必須 | 説明                                                                            |
| --------------------- | ---- | ------------------------------------------------------------------------------- |
| `id`                  | 〇   | 実行履歴にも残るキー。後から変えると履歴と紐づかなくなる                        |
| `label`               | 〇   | 画面に出す名前                                                                  |
| `description`         |      | 画面に出す説明                                                                  |
| `hostId`              | 〇   | `hosts[].id`                                                                    |
| `executable`          | 〇   | 実行するファイル。絶対パス推奨                                                  |
| `args`                |      | 引数のテンプレート(後述)                                                        |
| `inputs`              |      | 入力項目(後述)                                                                  |
| `timeoutSec`          |      | 既定 900。5〜3600                                                               |
| `requireConfirm`      |      | 既定 true。実行前に確認ダイアログを出す                                         |
| `confirmText`         |      | 確認ダイアログの文言                                                            |
| `requireFreshSession` |      | 既定 false。true にすると、ログインから一定時間を過ぎている場合に再認証を求める |
| `singleton`           |      | 既定 true。同じコマンドの同時実行を禁止する                                     |
| `sortOrder`           |      | 一覧での並び順。画面から上書きできる                                            |

`requireConfirm` は**画面の歯止めであってセキュリティ境界ではない**(サーバーは確認の有無を知らない)。
取り返しのつかないコマンドには `requireFreshSession: true` を併せて指定する。

### 入力項目

**選択系だけで、フリー入力は無い。** 利用者が任意の文字列を渡せる経路を作らないための制約。

| `type`        | 展開のされ方                                                     |
| ------------- | ---------------------------------------------------------------- |
| `select`      | 選んだ値 1 個                                                    |
| `radio`       | 同上。選択肢が 2〜4 個で全部見せたいときに使う                   |
| `multiselect` | 選んだ値を**定義の `options` 順**で 0 個以上。選択順では並ばない |
| `checkbox`    | `whenTrue` / `whenFalse` に書いた配列をそのまま                  |

`select` / `radio` / `multiselect` の共通項目は `key` / `label` / `options`(`{ value, label }` の配列)。
`select` / `radio` は `defaultValue` と `required`、`multiselect` は `defaultValues` / `minSelected` / `maxSelected` を持つ。

### 引数の組み立て

`args` の要素が `{{key}}` と**完全に一致する**場合だけ、その入力項目の値へ置き換わる。

```yaml
args: ['{{env}}'] # OK
args: ['--flag={{env}}'] # NG: 定義の読み込み時に弾かれる
```

部分埋め込みを禁じているのは、値との境界が曖昧になるうえ、`multiselect` のような多値を
どう展開すべきか定義できないため。`--flag=production` のような形が必要なら、選択肢側に完成形を持たせる。

```yaml
inputs:
  - type: checkbox
    key: verbose
    label: 詳細ログ
    whenTrue: ['--flag=production']
```

引数に使える文字は `A-Z a-z 0-9 . _ : @ = / + , -` だけ。空白・引用符・`$`・バッククォート・
`;`・`|`・`&`・リダイレクト・括弧は書けない。**シェルのスクリプトを定義に埋め込むことはできない**ので、
複雑な処理はリモート側にスクリプトを置き、それを `executable` に指定する。

## 実行先のパターン

実行方式は SSH の一本に絞ってある。「どこで動かすか」は定義の書き方だけで決まり、アプリ側に分岐は無い。

| やりたいこと                       | 定義の書き方                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| リモートサーバーで実行             | 対象ホストを `hosts` に書く                                                                   |
| devuntu が載っているホスト側で実行 | ホストを `host.docker.internal` として登録し、ホスト側の sshd へ接続する                      |
| 別の Docker コンテナ内で実行       | `executable: /usr/bin/docker`、`args: ['exec', 'my-container', '/opt/bin/job.sh', '{{env}}']` |

ホスト側へ SSH する場合は、`compose.yaml` の devuntu サービスに
`extra_hosts: ['host.docker.internal:host-gateway']` を足す。
この構成はコンテナ分離を意図的に越えるので、後述の `command=` 制限を特に強く推奨する。

## SSHの準備

秘密鍵と known_hosts は `COMMAND_SSH_DIR`(既定 `/app/config/ssh`)へ read-only でマウントする。
**DB には保存しない。**

```sh
mkdir -p config/ssh && chmod 700 config/ssh
ssh-keygen -t ed25519 -N '' -f config/ssh/ops_ed25519 -C 'devuntu-command'
chmod 600 config/ssh/ops_ed25519

# 接続先のホスト鍵を取得する。登録が無いホストへは接続できない
ssh-keyscan -t ed25519 web01.internal > /tmp/web01.pub

# 取得した鍵のフィンガープリントを表示する
ssh-keygen -lf /tmp/web01.pub
```

`ssh-keyscan` は**接続先が本物かを検証しない**。取得の時点で経路に割り込まれていると、
攻撃者の鍵をそのまま固定してしまい、以降の `StrictHostKeyChecking=yes` はその誤った鍵を信頼し続ける。

表示されたフィンガープリントを、**SSH 以外の経路**(サーバーの管理コンソール、
クラウドのインスタンス作成ログ、構築担当者からの連絡など)で得た値と照合する。
一致したときだけ登録する。

```sh
cat /tmp/web01.pub >> config/ssh/known_hosts && rm /tmp/web01.pub
```

`compose.yaml` の devuntu サービスへ:

```yaml
volumes:
  - type: bind
    source: ./config
    target: /app/config
    read_only: true
```

接続は常に以下の指定で行う。**登録の無いホストへは接続できず、パスワードも尋ねない**(fail closed)。

```
-T -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes
-o UserKnownHostsFile=<known_hosts> -o GlobalKnownHostsFile=/dev/null
-o PasswordAuthentication=no -o KbdInteractiveAuthentication=no ...
```

パスフレーズ付きの鍵は使えない(`BatchMode=yes` のため)。代わりに次の `command=` 制限で守る。

### リモート側の堅牢化(推奨)

リモートの `authorized_keys` で、この鍵にできることを 1 本のスクリプトへ縛る。

```
command="/opt/devuntu/bin/devuntu-run",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA...
```

`command=` を付けると、ssh は要求されたコマンドを実行せず**必ずこのスクリプトを起動する**。
要求された内容は引数ではなく環境変数 `SSH_ORIGINAL_COMMAND` に入るので、
スクリプト側はそれを読んで実行する。

devuntu が送るのは `printf '<番兵>' >&2; exec '<実行ファイル>' '<引数>' ...` という 1 行で、
実行ファイルも引数もシングルクォートで包まれている(`command-args.ts` の `shellQuote`)。
引数に使える文字も `[A-Za-z0-9._:@=/+,-]` に限られている(`COMMAND_VALUE_PATTERN`)。

**`SSH_ORIGINAL_COMMAND` をそのままシェルへ渡してはいけない。** 許可済みの断片が含まれるかを
部分一致で確かめるだけでは、`rm -rf /; exec '/opt/devuntu/bin/deploy.sh'` のように
前後へ任意のシェル構文を足した要求が通ってしまう。`exec` 以降だけを取り出し、
**文字列ではなく引数の並びとして起動し直す**。

`devuntu-run` を次の形にしておくと、許可外のコマンドを弾いたうえで、
**中断したときにリモート側のプロセスも確実に落ちる**。アプリは中断時にまず stdin を閉じるので、それが合図になる。

```sh
#!/bin/sh
# -f: グロブ展開を止める(引数に * が残っていても展開させない)
set -euf

deny() { echo "$1" >&2; exit 126; }

cmd=${SSH_ORIGINAL_COMMAND:-}

# 1. exec 以降だけを取り出す。ここより前は捨てるので、前置きに何を書かれても実行されない
rest=${cmd#*"; exec "}
[ "$rest" != "$cmd" ] || deny 'この鍵では許可されていない形式です'

# 2. この鍵で起動してよい実行ファイル。引数が続く場合は空白で区切られる(先頭一致で確かめる)
case "$rest" in
  "'/opt/devuntu/bin/deploy.sh'" | "'/opt/devuntu/bin/deploy.sh' "*) ;;
  "'/opt/devuntu/bin/reindex.sh'" | "'/opt/devuntu/bin/reindex.sh' "*) ;;
  *) deny 'この鍵では許可されていないコマンドです' ;;
esac

# 3. シェルの制御文字が残っていないことを確かめる。devuntu 側が通す文字にこれらは含まれない
case "$rest" in
  *[\;\&\|\`\$\<\>\(\)\{\}\\\"\~\*\?\[\]]*) deny '引数に使えない文字が含まれています' ;;
esac

# 4. 残るのはシングルクォートと安全な文字だけ。引数の並びへ戻して起動する($cmd は評価しない)
eval "set -- $rest"

# setsid で別のプロセスグループにしておく。そうしないと後段の kill でグループごと落とせない
setsid timeout -s TERM "${DEVUNTU_TIMEOUT:-900}" "$@" &
job=$!

# ssh が切れる / アプリが stdin を閉じると EOF になり、プロセスグループごと落とす
( cat >/dev/null; kill -TERM -"$job" 2>/dev/null ) &
watch=$!

rc=0
wait "$job" || rc=$?
kill "$watch" 2>/dev/null || true
exit "$rc"
```

この層で狭められるのは**何を起動できるか**まで。列挙した実行ファイルを、
許可した文字種の引数で動かせること自体は鍵を持つ相手に残る。
引数の値そのものを縛りたい場合は、スクリプト側でも受け取った値を検証する。

**この wrapper は必須ではない。** 置かない場合、中断してもリモート側に処理が残ることがある
(ローカルの ssh プロセスは必ず落ちる)。

## 権限

`/admin/commands` でコマンドごとに設定する。

- **有効化されていないコマンドは誰も実行できない**(管理者も含む)。定義を置いただけでは動かない
- **許可グループを指定しない場合は管理者のみ**。Google / Slack の連携設定では「空欄 = 全ユーザー許可」だが、
  コマンド実行は誤って全員へ開くと取り返しがつかないため**既定を逆にしてある**
- 管理者は設定のために無効なコマンドも一覧で見えるが、実行はできない

実行履歴は実行者本人と管理者だけが見られる。

## 安全性の考え方

SSH の exec は、リモートのログインシェルに 1 本の文字列を渡す仕様になっている。
そのため「配列で渡したから安全」はローカル側でしか成立しない。次の 4 層で防いでいる。

1. **選択肢の閉包** — 値は定義の `options` に含まれるものだけ。画面でもサーバーでも同じ関数で検証する
2. **文字集合** — 生成された引数を、使える文字だけかどうかで最終確認する
3. **クォート** — 全要素をシングルクォートで包む
4. **リモート側の縛り** — `authorized_keys` の `command=`(推奨)

加えて、子プロセスへ渡す環境変数は `PATH` / `HOME` / `LANG` だけに絞ってある
(DB の接続文字列などが子プロセスから見えないようにするため)。

## 実行の記録

実行 1 件が `command_run`、出力が `command_run_chunk`。実行時点のコマンド名・接続先名・実行者名を
複写して持つので、定義が変わってもユーザーが削除されても履歴の意味は変わらない。

- **失敗しても自動では再試行しない。** 副作用のあるコマンドを勝手に再実行しないため
- アプリの再起動などで実行中のまま残った記録は、生存申告が途切れてから一定時間後に
  失敗(`interrupted`)として閉じられる
- 出力は 2MB を超えると保存を打ち切る(実行そのものは続く)。32MB を超えると暴走とみなして中断する
- 保持期間と件数の上限を超えた履歴は自動メンテナンスが消す
  ([operations.md](operations.md#自動メンテナンス)を参照)

`failureKind` は失敗の分類。

| 値                 | 意味                                               |
| ------------------ | -------------------------------------------------- |
| `ssh_error`        | ssh 自身の失敗(接続不可・認証失敗・ホスト鍵不一致) |
| `connection_lost`  | 実行中に接続が切れた                               |
| `timeout`          | `timeoutSec` を超えた                              |
| `canceled`         | 画面から中断された                                 |
| `interrupted`      | 実行していたプロセスが応答しなくなった             |
| `output_limit`     | 出力が暴走した                                     |
| `start_failed`     | 鍵や定義の問題で起動できなかった                   |
| `log_write_failed` | ログを保存できなかった                             |

## 詰まったときに見る場所

| 症状                               | 見る場所                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| メニューに「コマンド実行」が出ない | `COMMAND_EXEC_ENABLED` / 有効化 / 許可グループ                                 |
| `/admin/commands` に定義が出ない   | 同画面のエラー表示。読み込みに失敗している場合は原因が場所付きで出る           |
| ホストが「未準備」                 | 鍵か known_hosts が読めていない。マウントとパーミッション(600)を確認           |
| `ssh_error` で失敗する             | ホスト鍵の登録、鍵の権限、リモートの `authorized_keys`                         |
| 終了コード 127                     | リモートに `executable` が無い。`ssh_error` ではないので接続自体は成功している |
| ログが流れない                     | リバースプロキシのバッファリング(nginx なら `proxy_buffering off;`)            |
| 「既に実行中」で弾かれる           | `singleton: true` のコマンドが動いている。履歴で状態を確認する                 |
