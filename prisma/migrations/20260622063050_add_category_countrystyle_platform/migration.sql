-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Archive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spuId" TEXT NOT NULL,
    "spuName" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "countryStyle" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL DEFAULT '',
    "uploadedByName" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "imageCount" INTEGER NOT NULL,
    "archivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Archive_spuId_fkey" FOREIGN KEY ("spuId") REFERENCES "Spu" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Archive" ("archivedAt", "department", "id", "imageCount", "spuId", "spuName", "uploadedByName") SELECT "archivedAt", "department", "id", "imageCount", "spuId", "spuName", "uploadedByName" FROM "Archive";
DROP TABLE "Archive";
ALTER TABLE "new_Archive" RENAME TO "Archive";
CREATE UNIQUE INDEX "Archive_spuId_key" ON "Archive"("spuId");
CREATE TABLE "new_Spu" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "countryStyle" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "assignedReviewerId" TEXT,
    "department" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Spu_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Spu_assignedReviewerId_fkey" FOREIGN KEY ("assignedReviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Spu" ("assignedReviewerId", "createdAt", "department", "id", "name", "status", "updatedAt", "uploadedById") SELECT "assignedReviewerId", "createdAt", "department", "id", "name", "status", "updatedAt", "uploadedById" FROM "Spu";
DROP TABLE "Spu";
ALTER TABLE "new_Spu" RENAME TO "Spu";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
