-- CreateEnum
CREATE TYPE "WikiPageType" AS ENUM ('page', 'design_doc');

-- AlterTable
ALTER TABLE "wiki_page" ADD COLUMN     "type" "WikiPageType" NOT NULL DEFAULT 'page';

-- AlterTable
ALTER TABLE "wiki_page_revision" ADD COLUMN     "type" "WikiPageType" NOT NULL DEFAULT 'page';
