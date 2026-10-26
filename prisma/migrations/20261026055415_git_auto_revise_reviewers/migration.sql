-- AlterTable
ALTER TABLE "board_git_setting" ADD COLUMN     "autoReviseReviewers" TEXT[] DEFAULT ARRAY[]::TEXT[];
