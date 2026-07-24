/*
  Warnings:

  - Added the required column `title` to the `calendar_busy_time` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "calendar_busy_time" ADD COLUMN     "title" TEXT NOT NULL;
