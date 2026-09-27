-- AlterTable
ALTER TABLE "board" DROP COLUMN "completeOnPrMerge",
ADD COLUMN     "completeOnGithubMerge" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "completeOnGitlabMerge" BOOLEAN NOT NULL DEFAULT false;

