-- AlterEnum
ALTER TYPE "WikiSpaceType" ADD VALUE 'announcement';

-- CreateIndex
CREATE INDEX "wiki_page_spaceId_createdAt_idx" ON "wiki_page"("spaceId", "createdAt");
