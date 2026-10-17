---
name: release
description: Devuntu をリリースする。edge で確認済みの commit にタグを打って latest として公開する(リリースノートの作成を含む)か、リリース済みの version を stable にする。「リリースして」「latest を出して」「タグを打って」「リリースノートを書いて」「stable にして」「stable に上げて」などの依頼で使う。`/release` で latest、`/release stable [version]` で stable。
---

# リリース

イメージのタグとワークフローの仕組みは [docs/dev/development.md](../../../docs/dev/development.md) の「イメージ作成」「リリース手順」を参照。

- **edge は人が作る**(Actions `Release` の手動実行)。このスキルでは edge をビルドしない
- **latest**: edge で確認済みの commit に、GitHub Release を公開してタグ `v<version>` を作る。タグの push で `Release` の promote ジョブが動き、edge のイメージに `<version>` と `latest` が付く
- **stable**: `Promote stable` を実行して、リリース済みの version を stable にする
- リリース済みの version は remote のタグが正。`pnpm release:version` で確認する(ローカルのタグは古いことがあるため、判断に使わない)

## 0. 共通の準備

```sh
git status --short            # 未コミットの変更があれば止めてユーザーに確認する
git switch main && git pull --ff-only
git fetch origin --tags --force
pnpm release:version          # version / released / latest / stable / bumpTo
```

チケットは本番 devuntu(`mcp__devuntu__*`)の DEVUNTU ボードで扱う。

## 1. latest(`/release`)

### 1-1. 前提の確認

1. `pnpm release:version` の `released` が false であること(以下、この version を V、`latest` を前回の版 P とする)
2. edge のビルド元の commit(S)を調べる

   ```sh
   gh run list --workflow release.yml --event workflow_dispatch -L 5 \
     --json databaseId,headSha,headBranch,status,conclusion,createdAt,url
   ```

   - 最新の run が実行中なら、終わるのを待つかユーザーに確認する
   - 最新の run が失敗していれば止めて報告する
   - 最新の成功した run の `headSha` を S とする

3. S について確認する
   - `git show S:package.json` の version が V であること
   - `git merge-base --is-ancestor S origin/main` が成功すること(main 上の commit であること)
4. S が origin/main の HEAD と異なる場合は、edge に含まれない commit を `git log --oneline S..origin/main` で示し、S のまま進めるかユーザーに確認する
5. docker が使える環境なら、`.github/scripts/image-revision.sh playree/devuntu:edge` が S と一致することも確かめる(使えなければ省略してよい。promote ジョブでも同じ検査をする)

### 1-2. 変更内容を集める

- **PR**: `git log --first-parent --format='%h %s' vP..S` からマージした PR の番号を拾い、`gh pr view <番号> --json title,body` で内容を見る
  - `vX.Y.Z start` のような version を上げるだけのコミットはノートに書かない
- **チケット**:
  1. 「vVリリース」チケットを探す: `search_tickets`(boardId: DEVUNTU / tags: リリース / keyword: `vVリリース`)
  2. 関連付いたチケットを集める: `search_tickets`(relatedTo: そのチケット / relation: related)
  3. 各チケットを `get_ticket` で読み、タグ(機能追加 / 改善 / 不具合)で分類する
- 関連チケットのうち、完了していないものや PR が S に含まれていないものは、ノートから外し、ユーザーに伝える

### 1-3. 運用者への影響を調べる

```sh
git diff --stat vP S -- compose.yaml docker/ prisma/migrations public/agent/devuntu_agent.py \
  src/lib/env-util.ts docs/admin/environment-variables.md
```

| 変更                                             | ノートに書くこと                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `compose.yaml`                                   | **要点に必ず書く**。既存の `compose.yaml` は自動で更新されないため、stable の git タグから取得し直す必要があること |
| `prisma/migrations` に追加                       | 起動時に自動で適用されること。適用後は前の版へ戻せないため、アップデート前にバックアップを取ること                 |
| 環境変数(`env-util.ts` / 環境変数のドキュメント) | 追加・変更・廃止された環境変数と既定値                                                                             |
| `devuntu_agent.py` の `__version__`              | AIエージェントのランナーを更新する必要があること(新しい `__version__`)                                             |

### 1-4. リリースノートを書く

スクラッチパッドに `release-notes-vV.md` として書く。形式は次のとおり。

```md
- 要点(利用者に効く変更を1行ずつ、3〜5個程度)
- ⚠ 運用者の対応が必要なもの(compose.yaml の取得し直しなど)は、必ず要点に入れる

<!-- details -->

## 新機能

- 何ができるようになったか。画面・操作の場所が分かるように書く (#123)

## 改善

## 不具合修正

## 運用者向け

- マイグレーション / 環境変数 / compose.yaml / AIエージェントのランナー

## アップデート

[運用ドキュメント](https://github.com/playree/devuntu/blob/main/docs/admin/operations.md#まずはこれだけ)の手順で、バックアップを取ってから新しいイメージで起動する。
```

- **`<!-- details -->` より前が要点**。ダッシュボードのリリースノートウィジェットには、ここだけが表示される(以降は GitHub の「詳細」リンクから見る)
  - 要点は Markdown の箇条書きだけにし、見出しは使わない
- 詳細は利用者・運用者が読んで分かる粒度で書く。実装の内部(関数名・ファイル名)は書かない
- 項目の末尾に PR 番号 `(#n)` を付ける
- 該当が無い見出しは書かない
- 日本語で書く
- 個人名・メールアドレス・社内の URL・DEVUNTU のチケットIDは書かない(公開リポジトリのため)

### 1-5. ドラフトを作って確認をもらう

```sh
gh release create vV --draft --target S --title vV --notes-file <scratchpad>/release-notes-vV.md
gh release view vV --json url,isDraft
```

- ドラフトの段階ではタグは作られず、ダッシュボードにも出ない
- ドラフトの URL、要点、運用者への影響(1-3)、ノートから外したチケット(1-2)をユーザーに示し、**公開してよいか確認する**
- 修正を頼まれたら、ファイルを直して `gh release edit vV --notes-file <file>` で更新し、もう一度確認をもらう

### 1-6. 公開する

公開してよいと言われてから行う。

```sh
gh release edit vV --draft=false --latest
```

- 公開すると S にタグ `vV` が作られ、`Release` の promote ジョブが走る
- 実行中の run を `gh run list --workflow release.yml --event push -L 3 --json databaseId,headBranch,status,conclusion` で探す(`headBranch` が `vV` のもの)
  - `gh run watch <id> --exit-status` で終わるまで見る
- 成功したら、次の2つを確かめる
  - `git fetch origin --tags --force && pnpm release:version` で `released: true`、`latest: V` になっていること
  - `git ls-remote --tags origin vV` が S を指していること
- **失敗した場合は、Release やタグを勝手に消さない**
  - ジョブのログから原因(edge のビルド元とタグの commit の不一致、version の不一致など)を調べて報告する
  - やり直し方(edge を S から作り直して Re-run するか、Release とタグを消して作り直すか)はユーザーと決める

### 1-7. リリースチケットを完了にする

「vVリリース」チケットについて、次の順で行う。

1. 受け入れ条件があれば、`report_acceptance_criteria` で結果を記録する
2. `add_ticket_comment`(type=report)で、次の内容を報告する
   - Release の URL
   - 含めたチケットと PR
   - 運用者への影響
   - 外したチケット
3. `update_ticket` で status を done にする

次の version へ上げるのは、次のチケットに着手するときに行う(ここでは上げない。CLAUDE.md の「バージョンとリリース」)。

## 2. stable(`/release stable [version]`)

### 2-1. 対象の確認

- 対象の version(V)は、指定があればそれを使い、無ければ `pnpm release:version` の `latest` を使う
- `pnpm release:version` の `stable` が既に V なら、何もせず報告して終わる
- V が今の stable より古い場合はロールバックになる
  - stable を使っている環境で新しい版のマイグレーションが適用済みだと動かないため、必ずユーザーに確認する
  - 確認するときは、修正版のリリースの方を勧める

### 2-2. 懸念の確認

```sh
gh release view vV --json isDraft,isPrerelease,publishedAt,url
```

- ドラフト・プレリリースなら止める
- 次のどれかに当たる場合は、内容を示してユーザーに確認する。どれにも当たらなければ確認せずに進めてよい
  - 公開(`publishedAt`)から1日未満
  - DEVUNTU ボードに、公開後に作られた未完了の「不具合」チケットがある
    - `search_tickets` で tags: 不具合 / status: backlog・todo・doing を検索し、`get_ticket` で作成日を確認する

### 2-3. 実行

```sh
gh workflow run promote-stable.yml --ref main -f version=V
gh run list --workflow promote-stable.yml -L 3 --json databaseId,status,createdAt   # 今起動した run を探す
gh run watch <id> --exit-status
```

`Promote stable` は次の順で動く。

1. V のイメージのビルド元が `vV` の commit と一致するかを検査する(`compose.yaml` が stable を参照する版であることも検査する)
2. git タグ `stable` を動かす
3. イメージの `stable` を付け替える

失敗した場合は、ログから原因を報告する。

### 2-4. 確認と記録

- `git fetch origin --tags --force && pnpm release:version` で、`stable` が V になったことを確かめる
- 「vVリリース」チケットがあれば、通常のコメント(type なし)で stable にした旨を残す。status は変えない
