-- CreateEnum
CREATE TYPE "MergeCriteriaCheck" AS ENUM ('none', 'checkedOrReported', 'checked');

-- AlterEnum
ALTER TYPE "NotifyEvent" ADD VALUE 'ticket_merge_held';

-- AlterEnum
ALTER TYPE "TicketActivityField" ADD VALUE 'mergeHeld';

-- AlterTable
ALTER TABLE "board_git_setting" ADD COLUMN     "mergeCriteriaCheck" "MergeCriteriaCheck" NOT NULL DEFAULT 'checkedOrReported';
