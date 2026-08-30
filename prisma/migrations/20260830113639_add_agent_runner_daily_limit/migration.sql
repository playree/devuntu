-- AlterTable
ALTER TABLE "agent_runner" ADD COLUMN     "dailyResetMin" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "dailyRunLimit" INTEGER NOT NULL DEFAULT 0;
