-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "mentionedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
