-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LinkWidget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "iconPath" TEXT,
    "createdAt" DATETIME,
    "updatedAt" DATETIME
);
INSERT INTO "new_LinkWidget" ("createdAt", "description", "iconPath", "id", "name", "updatedAt", "url") SELECT "createdAt", "description", "iconPath", "id", "name", "updatedAt", "url" FROM "LinkWidget";
DROP TABLE "LinkWidget";
ALTER TABLE "new_LinkWidget" RENAME TO "LinkWidget";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
