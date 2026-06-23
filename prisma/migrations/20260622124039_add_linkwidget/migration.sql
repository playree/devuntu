/*
  Warnings:

  - Made the column `createdAt` on table `dashboard` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateTable
CREATE TABLE "link_widget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "iconPath" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_dashboard" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "layout" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dashboard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_dashboard" ("createdAt", "layout", "updatedAt", "userId") SELECT "createdAt", "layout", coalesce("updatedAt", CURRENT_TIMESTAMP) AS "updatedAt", "userId" FROM "dashboard";
DROP TABLE "dashboard";
ALTER TABLE "new_dashboard" RENAME TO "dashboard";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
