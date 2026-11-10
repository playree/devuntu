-- AlterTable
ALTER TABLE "wiki_page_revision" ADD COLUMN "number" INTEGER;

-- 既存の版には、ページごとに古い順で 1 から振る
UPDATE "wiki_page_revision" AS r
SET "number" = s."number"
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "pageId" ORDER BY "createdAt", "id") AS "number"
  FROM "wiki_page_revision"
) AS s
WHERE r."id" = s."id";

ALTER TABLE "wiki_page_revision" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "wiki_page_revision_pageId_number_key" ON "wiki_page_revision"("pageId", "number");
