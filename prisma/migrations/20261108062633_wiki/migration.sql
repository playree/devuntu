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
CREATE TYPE "WikiPageRevisionAction" AS ENUM ('created', 'updated', 'moved', 'deleted', 'restored');

-- CreateTable
CREATE TABLE "wiki_space" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "WikiVisibility" NOT NULL DEFAULT 'restricted',
    "pageSeq" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_space_pkey" PRIMARY KEY ("id")
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
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "updatedVia" "WikiVia" NOT NULL DEFAULT 'web',
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
    "pageNumber" INTEGER NOT NULL,
    "action" "WikiPageRevisionAction" NOT NULL,
    "parentId" TEXT,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tagNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actorId" TEXT,
    "via" "WikiVia" NOT NULL,
    "ticketId" TEXT,
    "restoredFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wiki_page_revision_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "wiki_page_spaceId_parentId_order_idx" ON "wiki_page"("spaceId", "parentId", "order");

-- CreateIndex
CREATE INDEX "wiki_page_parentId_idx" ON "wiki_page"("parentId");

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
ALTER TABLE "wiki_tag" ADD CONSTRAINT "wiki_tag_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_tag" ADD CONSTRAINT "wiki_page_tag_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "wiki_page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_tag" ADD CONSTRAINT "wiki_page_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "wiki_tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_page_revision" ADD CONSTRAINT "wiki_page_revision_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
