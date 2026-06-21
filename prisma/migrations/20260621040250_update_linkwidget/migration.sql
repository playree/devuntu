/*
  Warnings:

  - Added the required column `url` to the `LinkWidget` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LinkWidget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconPath" TEXT NOT NULL,
    "createdAt" DATETIME,
    "updatedAt" DATETIME
);
INSERT INTO "new_LinkWidget" ("createdAt", "description", "iconPath", "id", "name", "updatedAt") SELECT "createdAt", "description", "iconPath", "id", "name", "updatedAt" FROM "LinkWidget";
DROP TABLE "LinkWidget";
ALTER TABLE "new_LinkWidget" RENAME TO "LinkWidget";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
