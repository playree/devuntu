-- 部分一致検索(ILIKE)を GIN 索引で引くための拡張。wiki_page の trgm 索引より前に作る
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "WikiVisibility" AS ENUM ('restricted', 'everyone');

-- CreateEnum
CREATE TYPE "WikiSpaceRole" AS ENUM ('viewer', 'editor', 'owner');

-- CreateEnum
CREATE TYPE "WikiAssignRole" AS ENUM ('viewer', 'editor');

-- CreateEnum
CREATE TYPE "WikiVia" AS ENUM ('web', 'mcp');

-- CreateEnum
CREATE TYPE "WikiSpaceType" AS ENUM ('mixed', 'design_doc', 'announcement');

-- CreateEnum
CREATE TYPE "WikiPageType" AS ENUM ('page', 'design_doc');

-- CreateEnum
CREATE TYPE "WikiPageRevisionAction" AS ENUM ('created', 'updated', 'moved', 'deleted', 'restored');

-- CreateEnum
CREATE TYPE "WikiAnnouncementNotifyKind" AS ENUM ('published', 'updated');

-- CreateEnum
CREATE TYPE "WikiAnnouncementNotifyStatus" AS ENUM ('scheduled', 'sent', 'canceled', 'skipped');

-- CreateEnum
CREATE TYPE "WikiAnnouncementNotifySkipReason" AS ENUM ('archived', 'channel_unset', 'slack_disabled', 'no_permission', 'page_deleted');

-- AlterEnum
ALTER TYPE "NotifyEvent" ADD VALUE 'wiki_announcement';

-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "detachedAt" TIMESTAMP(3),
ADD COLUMN     "wikiSpaceId" TEXT;

-- CreateTable
CREATE TABLE "wiki_space" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "WikiVisibility" NOT NULL DEFAULT 'restricted',
    "type" "WikiSpaceType" NOT NULL DEFAULT 'mixed',
    "pageSeq" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "announceSlackChannelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_space_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_space_key_history" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_space_key_history_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "wiki_space_member" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WikiSpaceRole" NOT NULL DEFAULT 'editor',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_space_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_space_group" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" "WikiAssignRole" NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_space_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_space_board" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "role" "WikiAssignRole" NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_space_board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_page" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "type" "WikiPageType" NOT NULL DEFAULT 'page',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "updatedVia" "WikiVia" NOT NULL DEFAULT 'web',
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_tag" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" "TagColor" NOT NULL DEFAULT 'gray',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_page_tag" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_page_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_page_revision" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "action" "WikiPageRevisionAction" NOT NULL,
    "parentId" TEXT,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" "WikiPageType" NOT NULL DEFAULT 'page',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "actorId" TEXT,
    "via" "WikiVia" NOT NULL,
    "ticketId" TEXT,
    "restoredFromId" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_page_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_template" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "type" "WikiPageType" NOT NULL DEFAULT 'page',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wiki_announcement_notify" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "kind" "WikiAnnouncementNotifyKind" NOT NULL,
    "message" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "WikiAnnouncementNotifyStatus" NOT NULL,
    "sentAt" TIMESTAMP(3),
    "skipReason" "WikiAnnouncementNotifySkipReason",
    "senderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_announcement_notify_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wiki_space_key_key" ON "wiki_space"("key");

-- CreateIndex
CREATE INDEX "wiki_space_member_userId_idx" ON "wiki_space_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_space_member_spaceId_userId_key" ON "wiki_space_member"("spaceId", "userId");

-- CreateIndex
CREATE INDEX "wiki_space_group_groupId_idx" ON "wiki_space_group"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_space_group_spaceId_groupId_key" ON "wiki_space_group"("spaceId", "groupId");

-- CreateIndex
CREATE INDEX "wiki_space_board_boardId_idx" ON "wiki_space_board"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_space_board_spaceId_boardId_key" ON "wiki_space_board"("spaceId", "boardId");

-- CreateIndex
CREATE INDEX "wiki_page_spaceId_deletedAt_idx" ON "wiki_page"("spaceId", "deletedAt");

-- CreateIndex
CREATE INDEX "wiki_page_deletedAt_idx" ON "wiki_page"("deletedAt");

-- CreateIndex
CREATE INDEX "wiki_page_spaceId_parentId_order_idx" ON "wiki_page"("spaceId", "parentId", "order");

-- CreateIndex
CREATE INDEX "wiki_page_parentId_idx" ON "wiki_page"("parentId");

-- CreateIndex
CREATE INDEX "wiki_page_spaceId_createdAt_idx" ON "wiki_page"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "wiki_page_title_trgm_idx" ON "wiki_page" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "wiki_page_content_trgm_idx" ON "wiki_page" USING GIN ("content" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "wiki_page_spaceId_number_key" ON "wiki_page"("spaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_tag_spaceId_name_key" ON "wiki_tag"("spaceId", "name");

-- CreateIndex
CREATE INDEX "wiki_page_tag_tagId_idx" ON "wiki_page_tag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_page_tag_pageId_tagId_key" ON "wiki_page_tag"("pageId", "tagId");

-- CreateIndex
CREATE INDEX "wiki_page_revision_pageId_createdAt_idx" ON "wiki_page_revision"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "wiki_page_revision_spaceId_createdAt_idx" ON "wiki_page_revision"("spaceId", "createdAt");

-- CreateIndex
CREATE INDEX "wiki_page_revision_updatedAt_idx" ON "wiki_page_revision"("updatedAt");

-- CreateIndex
CREATE INDEX "wiki_page_revision_ticketId_idx" ON "wiki_page_revision"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_page_revision_pageId_number_key" ON "wiki_page_revision"("pageId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "wiki_template_spaceId_name_key" ON "wiki_template"("spaceId", "name");

-- CreateIndex
CREATE INDEX "wiki_announcement_notify_status_scheduledAt_idx" ON "wiki_announcement_notify"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "wiki_announcement_notify_pageId_createdAt_idx" ON "wiki_announcement_notify"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "wiki_announcement_notify_spaceId_idx" ON "wiki_announcement_notify"("spaceId");

-- CreateIndex
CREATE INDEX "wiki_announcement_notify_senderId_idx" ON "wiki_announcement_notify"("senderId");

-- CreateIndex
CREATE INDEX "attachment_wikiSpaceId_idx" ON "attachment"("wikiSpaceId");

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_wikiSpaceId_fkey" FOREIGN KEY ("wikiSpaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_space_member" ADD CONSTRAINT "wiki_space_member_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_space_member" ADD CONSTRAINT "wiki_space_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_space_group" ADD CONSTRAINT "wiki_space_group_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_space_group" ADD CONSTRAINT "wiki_space_group_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_space_board" ADD CONSTRAINT "wiki_space_board_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_space_board" ADD CONSTRAINT "wiki_space_board_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page" ADD CONSTRAINT "wiki_page_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_tag" ADD CONSTRAINT "wiki_tag_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_tag" ADD CONSTRAINT "wiki_page_tag_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_tag" ADD CONSTRAINT "wiki_page_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "wiki_tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_template" ADD CONSTRAINT "wiki_template_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_template" ADD CONSTRAINT "wiki_template_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_template" ADD CONSTRAINT "wiki_template_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_announcement_notify" ADD CONSTRAINT "wiki_announcement_notify_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_announcement_notify" ADD CONSTRAINT "wiki_announcement_notify_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_announcement_notify" ADD CONSTRAINT "wiki_announcement_notify_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 添付先はボードか Wiki スペースのどちらか一方(どちらも無ければ全ログインユーザーへ配信する)。
-- 削除待ち(detachedAt)の添付は紐付けを外してあり、どちらも持たない
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_owner_check"
  CHECK (num_nonnulls("boardId", "wikiSpaceId") <= 1);
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_detached_check"
  CHECK ("detachedAt" IS NULL OR ("boardId" IS NULL AND "wikiSpaceId" IS NULL));

-- 送った日時は送信済みのときだけ、見送りの理由は見送ったときだけ持つ
ALTER TABLE "wiki_announcement_notify" ADD CONSTRAINT "wiki_announcement_notify_sent_check"
  CHECK (("status" = 'sent') = ("sentAt" IS NOT NULL));
ALTER TABLE "wiki_announcement_notify" ADD CONSTRAINT "wiki_announcement_notify_skipped_check"
  CHECK (("status" = 'skipped') = ("skipReason" IS NOT NULL));

-- サンプルのスペースとページ。全員が閲覧でき、編集するには管理者がスペースの設定で割り当てる。
-- ID は DB に既定が無い(アプリで採番する)ので固定値を使い、本文はドル引用で書く
INSERT INTO "wiki_space" ("id", "key", "name", "description", "visibility", "type", "pageSeq", "updatedAt")
VALUES (
  '019a9000-0000-7000-8000-000000000001',
  'SAMPLE',
  'サンプル',
  'Wiki の使い方と設計書の書き方のサンプル。自由に編集・削除してよい',
  'everyone',
  'mixed',
  7,
  CURRENT_TIMESTAMP
);

INSERT INTO "wiki_space_key_history" ("key") VALUES ('SAMPLE');

INSERT INTO "wiki_tag" ("id", "spaceId", "name", "color", "order", "updatedAt")
VALUES
  ('019a9000-0000-7000-8000-000000000011', '019a9000-0000-7000-8000-000000000001', 'HowTo', 'green', 0, CURRENT_TIMESTAMP),
  ('019a9000-0000-7000-8000-000000000012', '019a9000-0000-7000-8000-000000000001', '設計書', 'blue', 1, CURRENT_TIMESTAMP);

INSERT INTO "wiki_page" ("id", "spaceId", "parentId", "number", "title", "content", "type", "order", "updatedAt")
VALUES
(
  '019a9000-0000-7000-8000-000000000101',
  '019a9000-0000-7000-8000-000000000001',
  NULL,
  1,
  'Wiki の使い方',
  $md$このスペースは、Wiki の使い方と設計書の書き方を確かめるためのサンプルです。自由に編集・削除してかまいません。不要になったら、スペースの設定からアーカイブできます。

> [!NOTE]
> このスペースは公開範囲が「全員」なので、ログインできる人なら誰でも読めます。編集するには、管理者がスペースの設定(歯車ボタン)で自分やほかの人を編集者・owner に割り当てます。

## スペースとページ

- 文書は**スペース**ごとにまとまり、スペースの中にページを親子で並べます(10 階層まで)
- ページは `キー/番号`(このページなら `SAMPLE/1`)で指定できます。タイトルを変えたり移動したりしても番号は変わりません
- スペースの公開範囲は「割り当てのみ」と「全員」の 2 つです。ユーザー・グループ・ボードに、閲覧者・編集者・owner のロールを割り当てます

## ページを書く

1. スペースのトップやツリーの「ページを作成」でスペース直下に、ページ詳細の「子ページを作成」でそのページの下にページを作ります
2. タイトルの右の鉛筆ボタンで、タイトル・本文・タグを編集します
3. 保存するときに、任意でコミットメッセージ(変更の要約)を付けられます

本文は Markdown で書きます。使える書き方は [Markdown の書き方](/wiki/SAMPLE/2) を見てください。画像の貼り付けやファイルの添付もできます。

## 整理する

- **並べ替え・移動** — ツリー上部の「並べ替え」ボタンや、ページの「ページを移動」で位置を変えます
- **タグ** — タグはスペースごとに持ちます。このスペースでは `HowTo` と `設計書` を使っています。タグを押すと、そのタグを持つページを探せます
- **検索** — `/wiki` の検索欄で閲覧できるすべてのスペースを、ツリーの上の検索欄でこのスペースの中を探せます

## 履歴

タイトルの横の「〇〇 が 日時 に更新」を押すと、ページの版の一覧が開きます。

| 操作 | できること |
| --- | --- |
| 過去の版を表示 | その時点のタイトル・タグ・本文を表示する |
| 差分 | 選んだ版から最新までの変更を表示する |
| 戻す | 過去の版の内容に戻す(戻したことも新しい版として残る) |
| 出力 | 表示中のページを PDF / HTML / Markdown のファイルにする |

削除したページは、スペースのトップのごみ箱のボタンから 7 日のあいだ復元できます。

## 設計書

ページの種類を「設計書」にすると、Markdown Design Doc Viewer の形式で、図と手順を横に並べて表示します。例は [設計書のサンプル](/wiki/SAMPLE/3) にあります。

## AI から使う

AI ツール(MCP)やエージェントからも、ページの検索・閲覧・編集ができます。スペースをボードに割り当てると、そのボードのチケットに対応する AI にスペースが伝わります。
$md$,
  'page',
  0,
  CURRENT_TIMESTAMP
),
(
  '019a9000-0000-7000-8000-000000000102',
  '019a9000-0000-7000-8000-000000000001',
  '019a9000-0000-7000-8000-000000000101',
  2,
  'Markdown の書き方',
  $md$通常のページで使える Markdown の例です。エディタのツールバーで書式を付けられるほか、右端の切り替えで Markdown のソースを直接編集できます。

## 文字の装飾

**太字**、*斜体*、~~取り消し線~~、`インラインコード`、[リンク](/wiki/SAMPLE/1) が使えます。

## リスト

- 箇条書き
  - 入れ子にもできます
- 2 つ目の項目

1. 番号付きリスト
2. 2 つ目の手順

> 引用は行頭に `>` を付けます。

## 表

| 記法 | 書き方 |
| --- | --- |
| 見出し | 行頭に `#` を付ける |
| 表 | `\| A \| B \|` の形で書く |
| 脚注 | `[^名前]` と `[^名前]: 本文` |

## コードブロック

言語名を付けると色付けされます。

```ts
export const greet = (name: string) => `こんにちは、${name} さん`
```

## 図(mermaid)

` ```mermaid ` で囲むと、表示のときに図になります。

```mermaid
flowchart LR
  A[ページを作る] --> B[本文を書く]
  B --> C{レビュー}
  C -->|OK| D[公開]
  C -->|修正| B
```

## 注意書き

引用の 1 行目に `[!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` を書きます。

> [!TIP]
> 図や注意書きは表示のときだけ反映され、編集中は元の書き方のまま出ます。

> [!WARNING]
> 本番のデータは削除しないこと。

## 脚注

補足は脚注にできます[^1]。

[^1]: 番号を押すと、ここへ移動します。
$md$,
  'page',
  0,
  CURRENT_TIMESTAMP
),
(
  '019a9000-0000-7000-8000-000000000103',
  '019a9000-0000-7000-8000-000000000001',
  NULL,
  3,
  '設計書のサンプル',
  $md$このページの配下に、[Markdown Design Doc Viewer](https://github.com/playree/markdown-design-doc-viewer) の形式で書いた設計書の例を置いています。

## 設計書ページとは

ページの種類を「設計書」にすると、`%% @link-headings` を付けた mermaid の図と、その後の見出しが矢印(ノード)ごとに結び付き、図の横に手順が並びます。
図の矢印を押すと結び付いた見出しへ移り、見出しにマウスを乗せると矢印が強調されます。

- 本文の先頭の front matter(`type: design_doc` / `title` / `version` / `status` など)は、設計書ヘッダとして出ます
- 編集は Markdown のソースで行い、広い画面では右にプレビューが出ます
- 区分を「設計書」にして作ったスペースでは、スペースのトップに設計書の一覧が出ます(区分はスペースの作成時に選び、後から変えられません)

## サンプル

| ページ | 図 | 見どころ |
| --- | --- | --- |
| [ログイン 処理設計](/wiki/SAMPLE/4) | シーケンス図 | 矢印と処理の見出しの結び付け、`%% @ref`、変更履歴の折りたたみ、脚注 |
| [注文 データベース設計](/wiki/SAMPLE/5) | ER 図 | エンティティとテーブル定義の見出しの結び付け |
| [在庫照会 API 電文定義](/wiki/SAMPLE/6) | - | 階層を持つ項目の表(ツリー表示) |
| [注文 状態遷移](/wiki/SAMPLE/7) | 状態遷移図 | 状態と説明の見出しの結び付け、複合状態 |

> [!TIP]
> AI に設計書を書かせるときは、Devuntu の MCP から入れられる markdown-design-doc スキルを使うと、この形式で書けます。
$md$,
  'page',
  1,
  CURRENT_TIMESTAMP
),
(
  '019a9000-0000-7000-8000-000000000104',
  '019a9000-0000-7000-8000-000000000001',
  '019a9000-0000-7000-8000-000000000103',
  4,
  'ログイン 処理設計',
  $md$---
type: design_doc
title: ログイン 処理設計
version: 1.1
product: サンプル
status: 承認済み
updated: 2026-11-17
---

# ログイン 処理設計

<details>
<summary>変更履歴</summary>

| 版数 | 日付 | 内容 |
|---|---|---|
| 1.0 | 2026-11-01 | 初版 |
| 1.1 | 2026-11-17 | 認証エラー時のロックを追加 |

</details>

## 処理の流れ

```mermaid
%% @link-headings
sequenceDiagram
    autonumber
    actor User as 利用者
    participant FE as 画面
    participant API as API サーバー
    participant Auth as 認証サービス
    participant DB as データベース

    User->>FE: ID とパスワードを入力
    FE->>API: POST /login
    API->>Auth: 認証を依頼
    Auth->>DB: 利用者を取得
    DB-->>Auth: 利用者のレコード

    alt 認証に成功
        %% @ref トークンを発行
        Auth-->>API: アクセストークン
        API-->>FE: 200 OK
        FE-->>User: ダッシュボードを表示
    else 認証に失敗
        Auth-->>API: 認証エラー
        API-->>FE: 401 Unauthorized
        FE-->>User: エラーを表示
    end
```

## 処理概要

### 1. ID とパスワードを入力

送信前に画面で入力を確認する。画面での確認は使い勝手のためで、サーバーでも同じ確認を行う。

| 項目 | 条件 | メッセージ |
|---|---|---|
| ID | 必須、3〜64 文字 | ID を入力してください。 |
| パスワード | 必須、8〜128 文字 | パスワードを入力してください。 |

- 送信中はボタンを押せなくし、二重送信を防ぐ
- ID の前後の空白は取り除く。パスワードは入力のまま送る

### 2. POST /login

要求の本文の `id` と `password` を確認し、認証サービスへ渡す。

```json
{
  "id": "user01",
  "password": "correct horse battery staple"
}
```

- 本文の形式が正しくなければ、認証サービスを呼ばずに `400 Bad Request` を返す
- 同じ IP アドレスから 1 分に 10 回を超えたら `429 Too Many Requests` を返す
- ログには ID と接続元の IP アドレスだけを残し、パスワードは残さない

### 3. 認証を依頼

API サーバーから認証サービスを内部ネットワークで呼ぶ。

- 宛先: `POST /internal/authenticate`
- タイムアウト: 3 秒。再送はしない(1 回の失敗を 2 回と数えてしまうため)
- 認証サービスに届かなければ `503 Service Unavailable` を返す

### 4. 利用者を取得

`users` テーブルから、ID をキーに 1 行を取得する。

```sql
SELECT user_id, password_hash, failed_count, locked_until
FROM users
WHERE login_id = $1;
```

次のときは認証に失敗する。

- ID に一致する利用者がいない
- ロック中(`locked_until` が未来)
- パスワードが `password_hash` と一致しない

> [!IMPORTANT]
> 利用者がいないときも、ダミーのハッシュとの照合を行う。応答時間の差から ID の有無が分からないようにするため。

### 5. 利用者のレコード

`user_id`・`password_hash`・`failed_count`・`locked_until` を返す。

### 6. トークンを発行

有効期限 1 時間の JWT を発行する[^expiry]。成功したら `failed_count` を 0 に戻す。

| クレーム | 値 |
|---|---|
| sub | `user_id` |
| iat | 発行日時 |
| exp | 発行日時 + 1 時間 |

### 7. 200 OK

本文でアクセストークンを返し、リフレッシュトークンは `HttpOnly`・`Secure` の Cookie に入れる。

### 8. ダッシュボードを表示

ログイン前に開こうとしていたページがあればそこへ、無ければダッシュボードへ移る。

### 9. 認証エラー

失敗の回数を数え、5 回続けて失敗したら 30 分ロックする。

| 続けて失敗した回数 | 処理 |
|---|---|
| 1〜4 | `failed_count` を増やす |
| 5 | `locked_until` を 30 分後にする |

### 10. 401 Unauthorized

失敗の理由によらず、同じ応答を返す。ロック中かどうかも分からないようにする。

```json
{
  "error": "invalid_credentials",
  "message": "ID またはパスワードが違います。"
}
```

### 11. エラーを表示

フォームの下にメッセージを出し、パスワード欄を空にする。ID 欄はそのまま残す。

<!-- link-headings:end -->

## 補足

図の矢印の文言と同じ見出しが、その矢印の説明として図の横に並びます。応答の矢印「アクセストークン」は `%% @ref` で見出し「トークンを発行」に結び付けています。

[^expiry]: リフレッシュトークンに対応するまでは 1 時間のままとする。
$md$,
  'design_doc',
  0,
  CURRENT_TIMESTAMP
),
(
  '019a9000-0000-7000-8000-000000000105',
  '019a9000-0000-7000-8000-000000000001',
  '019a9000-0000-7000-8000-000000000103',
  5,
  '注文 データベース設計',
  $md$---
type: design_doc
title: 注文 データベース設計
version: 1.0
product: サンプル
status: レビュー中
updated: 2026-11-17
---

# 注文 データベース設計

ER 図のエンティティは、別名(無ければ名前)と同じ見出しに結び付きます。

## テーブル

```mermaid
%% @link-headings
erDiagram
    CUSTOMER ||--o{ ORDERS : "注文する"
    ORDERS ||--|{ ORDER_LINE : "含む"
    PRODUCT ||--o{ ORDER_LINE : "注文される"
    CUSTOMER["顧客"] {
        string customer_id PK
        string name
        string email UK
    }
    ORDERS["注文"] {
        string order_id PK
        string customer_id FK
        date ordered_at
        string status
    }
    %% @ref 注文明細
    ORDER_LINE["明細"] {
        string order_id PK, FK
        int line_no PK
        string sku FK
        int quantity
    }
    PRODUCT["商品"] {
        string sku PK
        string name
        int price
    }
```

### 顧客

注文する個人または法人。メールアドレスはサインインに使うので一意にする。

<!-- table: merge=列,型 -->
| 列 | 型 | キー | 説明 |
|---|---|---|---|
| customer_id | string | PK | 登録時に採番する |
| name | string | | 氏名または法人名 |
| email | string | UK | |

### 注文

顧客の 1 回の購入。

<!-- table: merge=列,型 -->
| 列 | 型 | キー | 説明 |
|---|---|---|---|
| order_id | string | PK | |
| customer_id | string | FK | `CUSTOMER.customer_id` |
| ordered_at | date | | |
| status | string | | [注文 状態遷移](/wiki/SAMPLE/7) の状態 |

### 注文明細

`%% @ref` で、エンティティ「明細」をこの見出しに結び付けています。注文の商品ごとに 1 行。

<!-- table: merge=列,型 -->
| 列 | 型 | キー | 説明 |
|---|---|---|---|
| order_id | string | PK, FK | `ORDERS.order_id` |
| line_no | int | PK | 注文ごとに 1 から |
| sku | string | FK | `PRODUCT.sku` |
| quantity | int | | 1 以上 |

### 商品

販売する商品。価格は税込み。

<!-- table: merge=列,型 -->
| 列 | 型 | キー | 説明 |
|---|---|---|---|
| sku | string | PK | |
| name | string | | |
| price | int | | |

<!-- link-headings:end -->

## 補足

終わりの印(`link-headings:end`)より後の見出しは、図に結び付きません。
$md$,
  'design_doc',
  1,
  CURRENT_TIMESTAMP
),
(
  '019a9000-0000-7000-8000-000000000106',
  '019a9000-0000-7000-8000-000000000001',
  '019a9000-0000-7000-8000-000000000103',
  6,
  '在庫照会 API 電文定義',
  $md$---
type: design_doc
title: 在庫照会 API 電文定義
version: 1.0
product: サンプル
status: 作成中
updated: 2026-11-17
---

# 在庫照会 API 電文定義

項目の表のサンプルです。表の直前のコメント(`<!-- table: … -->`)で、物理名を項目名の下にまとめ、項目の入れ子を階層の列からツリーで表示します。▾ を押すと子の項目を折りたたみ、行にマウスを乗せるとその親と子が強調されます。

## 1. 概要

- 店舗の端末から在庫照会 API(`POST /v1/stock-inquiries`)に、商品の在庫と入荷予定を問い合わせる
- 本文は JSON(UTF-8、`Content-Type: application/json`)
- 項目の表の「必須」は、○ が必須、△ が説明に書いた条件のときだけ必須、空欄が任意。任意の項目は、値が無ければ項目ごと省略する(`null` は送らない)

## 2. 要求

### 2.1 例

```json
{
  "inquiry": {
    "storeCode": "0123",
    "items": [
      { "janCode": "4901234567894", "quantity": 2 },
      { "janCode": "49012342" }
    ]
  }
}
```

### 2.2 項目

<!-- table: level=階層 merge=項目名,物理名 -->
| No | 階層 | 項目名 | 物理名 | 型 | 形式 | 桁 最小 | 桁 最大 | 必須 | 説明 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 1 | 照会条件 | `inquiry` | object | - | - | - | ○ | |
| 2 | 2 | 店舗コード | `storeCode` | string | 数字 | 4 | 4 | ○ | 照会する店舗 |
| 3 | 2 | 商品リスト | `items` | array | - | 1 | 50 | ○ | 桁は要素の数 |
| 4 | 3 | JAN コード | `janCode` | string | 数字 | 8 | 13 | ○ | GTIN-8 または GTIN-13 |
| 5 | 3 | 希望数量 | `quantity` | integer | - | 1 | 9999 | | 省略時は 1。桁は値の範囲 |

## 3. 応答

### 3.1 例

正常時(HTTP 200):

```json
{
  "result": {
    "status": "ok",
    "stocks": [
      { "janCode": "4901234567894", "stockQuantity": 12 },
      { "janCode": "49012342", "stockQuantity": 0, "arrival": { "date": "2026-11-20", "quantity": 24 } }
    ]
  }
}
```

<details>
<summary>エラー時(HTTP 4xx・5xx)の例</summary>

```json
{
  "result": {
    "status": "error",
    "error": { "code": "E00003", "message": "JAN コードが登録されていません。", "field": "inquiry.items[1].janCode" }
  }
}
```

</details>

### 3.2 項目

<!-- table: level=階層 merge=項目名,物理名 -->
| No | 階層 | 項目名 | 物理名 | 型 | 形式 | 桁 最小 | 桁 最大 | 必須 | 説明 |
|---|---|---|---|---|---|---|---|---|---|
| 11 | 1 | 処理結果 | `result` | object | - | - | - | ○ | |
| 12 | 2 | 状態 | `status` | string | `ok` / `error` | - | - | ○ | |
| 13 | 2 | 在庫リスト | `stocks` | array | - | 1 | 50 | △ | 正常時のみ。要求の `items` と同じ順に返す |
| 14 | 3 | JAN コード | `janCode` | string | 数字 | 8 | 13 | ○ | 要求の値を返す |
| 15 | 3 | 在庫数 | `stockQuantity` | integer | - | 0 | 999999 | ○ | 引当済みの数を除いた数。桁は値の範囲 |
| 16 | 3 | 入荷予定 | `arrival` | object | - | - | - | | 入荷予定があるときのみ |
| 17 | 4 | 入荷予定日 | `date` | string | 日付(`YYYY-MM-DD`) | 10 | 10 | ○ | |
| 18 | 4 | 入荷予定数 | `quantity` | integer | - | 1 | 999999 | ○ | 桁は値の範囲 |
| 19 | 2 | エラー情報 | `error` | object | - | - | - | △ | エラー時のみ |
| 20 | 3 | エラーコード | `code` | string | 英数字 | 6 | 6 | ○ | 4. エラーコードを参照 |
| 21 | 3 | エラーメッセージ | `message` | string | - | 1 | 200 | ○ | 端末に表示する文言 |
| 22 | 3 | エラー項目 | `field` | string | JSON のパス | 1 | 100 | | 原因の項目が分かるときのみ |

## 4. エラーコード

| コード | HTTP ステータス | 内容 | 端末の対応 |
|---|---|---|---|
| `E00001` | 404 | 店舗コードが存在しない | 端末の設定を確認する |
| `E00002` | 400 | 商品の数が 50 を超えている | 分けて照会する |
| `E00003` | 422 | JAN コードが登録されていない | 商品マスタを確認する |
| `E99999` | 500 | システムエラー | 時間をおいて再照会する |
$md$,
  'design_doc',
  2,
  CURRENT_TIMESTAMP
),
(
  '019a9000-0000-7000-8000-000000000107',
  '019a9000-0000-7000-8000-000000000001',
  '019a9000-0000-7000-8000-000000000103',
  7,
  '注文 状態遷移',
  $md$---
type: design_doc
title: 注文 状態遷移
version: 1.0
product: サンプル
status: 作成中
updated: 2026-11-17
---

# 注文 状態遷移

状態遷移図の状態は、説明(無ければ ID)と同じ見出しに結び付きます。複合状態とその中の状態も結び付きます。

## 状態

```mermaid
%% @link-headings
stateDiagram-v2
    state "支払い待ち" as Pending
    state "支払い済み" as Paid
    state "キャンセル" as Cancelled
    state "出荷作業" as Fulfillment {
        state "ピッキング" as Picking
        state "出荷済み" as Shipped
        [*] --> Picking
        Picking --> Shipped : 配送業者に引き渡す
    }
    %% @ref 配達完了
    state "配達済み" as Delivered
    [*] --> Pending
    Pending --> Paid : 決済が完了
    Pending --> Cancelled : 期限切れ・取り消し
    Paid --> Fulfillment
    Shipped --> Delivered : 配達の報告
    Delivered --> [*]
    Cancelled --> [*]
    note right of Cancelled : 在庫の引き当てを戻す
```

### 支払い待ち

注文を受け付け、決済を待つ。30 分を過ぎても決済されなければキャンセルになる。

### 支払い済み

決済が完了した。注文を倉庫へ回す。

### キャンセル

期限までに決済されなかったか、決済の前に顧客が取り消した。

### 出荷作業

倉庫で出荷の準備をしている。この状態からは顧客が取り消せない。

#### ピッキング

商品を棚から取り出して梱包する。

#### 出荷済み

配送業者に引き渡した。注文履歴に追跡番号を出す。

### 配達完了

`%% @ref` で、状態「配達済み」をこの見出しに結び付けています。配送業者から配達の報告を受け、注文を完了する。

<!-- link-headings:end -->
$md$,
  'design_doc',
  3,
  CURRENT_TIMESTAMP
);

INSERT INTO "wiki_page_tag" ("id", "pageId", "tagId")
VALUES
  ('019a9000-0000-7000-8000-000000000201', '019a9000-0000-7000-8000-000000000101', '019a9000-0000-7000-8000-000000000011'),
  ('019a9000-0000-7000-8000-000000000202', '019a9000-0000-7000-8000-000000000102', '019a9000-0000-7000-8000-000000000011'),
  ('019a9000-0000-7000-8000-000000000203', '019a9000-0000-7000-8000-000000000103', '019a9000-0000-7000-8000-000000000012'),
  ('019a9000-0000-7000-8000-000000000204', '019a9000-0000-7000-8000-000000000104', '019a9000-0000-7000-8000-000000000012'),
  ('019a9000-0000-7000-8000-000000000205', '019a9000-0000-7000-8000-000000000105', '019a9000-0000-7000-8000-000000000012'),
  ('019a9000-0000-7000-8000-000000000206', '019a9000-0000-7000-8000-000000000106', '019a9000-0000-7000-8000-000000000012'),
  ('019a9000-0000-7000-8000-000000000207', '019a9000-0000-7000-8000-000000000107', '019a9000-0000-7000-8000-000000000012');

-- 各ページの版 1(作成)。本文・タグ(`[{ id, name }]`、タグの表示順)は上で入れたページから写す
INSERT INTO "wiki_page_revision" (
  "id", "spaceId", "pageId", "number", "action",
  "parentId", "order", "title", "content", "type", "tags", "via"
)
SELECT
  '019a9000-0000-7000-8000-0000000003' || lpad(p."number"::text, 2, '0'),
  p."spaceId",
  p."id",
  1,
  'created',
  p."parentId",
  p."order",
  p."title",
  p."content",
  p."type",
  COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object('id', t."id", 'name', t."name") ORDER BY t."order", t."name")
      FROM "wiki_page_tag" AS pt
      JOIN "wiki_tag" AS t ON t."id" = pt."tagId"
      WHERE pt."pageId" = p."id"
    ),
    '[]'::jsonb
  ),
  'web'
FROM "wiki_page" AS p
WHERE p."spaceId" = '019a9000-0000-7000-8000-000000000001';
