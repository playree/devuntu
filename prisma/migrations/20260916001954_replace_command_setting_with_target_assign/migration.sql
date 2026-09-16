/*
  Warnings:

  - You are about to drop the `command_allowed_group` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `command_setting` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "CommandTargetMemberRole" AS ENUM ('owner', 'member');

-- DropForeignKey
ALTER TABLE "command_allowed_group" DROP CONSTRAINT "command_allowed_group_groupId_fkey";

-- DropForeignKey
ALTER TABLE "command_allowed_group" DROP CONSTRAINT "command_allowed_group_settingId_fkey";

-- DropTable
DROP TABLE "command_allowed_group";

-- DropTable
DROP TABLE "command_setting";

-- CreateTable
CREATE TABLE "command_target_member" (
    "id" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CommandTargetMemberRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_target_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_target_group" (
    "id" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_target_group_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "command_target_member_userId_idx" ON "command_target_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "command_target_member_targetKey_userId_key" ON "command_target_member"("targetKey", "userId");

-- CreateIndex
CREATE INDEX "command_target_group_groupId_idx" ON "command_target_group"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "command_target_group_targetKey_groupId_key" ON "command_target_group"("targetKey", "groupId");

-- AddForeignKey
ALTER TABLE "command_target_member" ADD CONSTRAINT "command_target_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_target_group" ADD CONSTRAINT "command_target_group_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
