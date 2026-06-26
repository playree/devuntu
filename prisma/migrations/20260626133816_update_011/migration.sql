/*
  Warnings:

  - Made the column `updatedAt` on table `dashboard` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateTable
CREATE TABLE "link_widget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "iconPath" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "key_value_store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "group" TEXT,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_dashboard" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "layout" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dashboard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_dashboard" ("createdAt", "layout", "updatedAt", "userId") SELECT coalesce("createdAt", CURRENT_TIMESTAMP) AS "createdAt", "layout", "updatedAt", "userId" FROM "dashboard";
DROP TABLE "dashboard";
ALTER TABLE "new_dashboard" RENAME TO "dashboard";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "key_value_store_key_key" ON "key_value_store"("key");

-- CreateIndex
CREATE INDEX "key_value_store_group_idx" ON "key_value_store"("group");
