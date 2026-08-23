-- AlterTable
ALTER TABLE "user" ADD COLUMN     "avatarLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nameLocked" BOOLEAN NOT NULL DEFAULT false;
