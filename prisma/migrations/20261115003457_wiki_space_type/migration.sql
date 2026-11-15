-- CreateEnum
CREATE TYPE "WikiSpaceType" AS ENUM ('mixed', 'design_doc');

-- AlterTable
ALTER TABLE "wiki_space" ADD COLUMN     "type" "WikiSpaceType" NOT NULL DEFAULT 'mixed';
