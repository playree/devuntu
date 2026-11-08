-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "wikiSpaceId" TEXT;

-- CreateIndex
CREATE INDEX "attachment_wikiSpaceId_idx" ON "attachment"("wikiSpaceId");

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_wikiSpaceId_fkey" FOREIGN KEY ("wikiSpaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;
