-- AlterTable
ALTER TABLE "wiki_page_revision" ADD COLUMN     "pageCreatedAt" TIMESTAMP(3),
ADD COLUMN     "pageCreatedById" TEXT;
