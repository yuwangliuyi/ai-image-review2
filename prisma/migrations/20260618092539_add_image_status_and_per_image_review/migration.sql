/*
  Warnings:

  - You are about to drop the column `platform` on the `Archive` table. All the data in the column will be lost.
  - You are about to drop the column `spuId` on the `ReviewRecord` table. All the data in the column will be lost.
  - You are about to drop the column `platform` on the `Spu` table. All the data in the column will be lost.
  - Added the required column `imageId` to the `ReviewRecord` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Archive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spuId" TEXT NOT NULL,
    "spuName" TEXT NOT NULL,
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
CREATE TABLE "new_Image" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "spuId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Image_spuId_fkey" FOREIGN KEY ("spuId") REFERENCES "Spu" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Image_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Image" ("createdAt", "fileSize", "filename", "id", "mimeType", "spuId", "storedPath", "thumbnailPath", "uploadedById") SELECT "createdAt", "fileSize", "filename", "id", "mimeType", "spuId", "storedPath", "thumbnailPath", "uploadedById" FROM "Image";
DROP TABLE "Image";
ALTER TABLE "new_Image" RENAME TO "Image";
CREATE TABLE "new_ReviewRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewRecord_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReviewRecord_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ReviewRecord" ("action", "comment", "createdAt", "id", "reviewerId") SELECT "action", "comment", "createdAt", "id", "reviewerId" FROM "ReviewRecord";
DROP TABLE "ReviewRecord";
ALTER TABLE "new_ReviewRecord" RENAME TO "ReviewRecord";
CREATE TABLE "new_Spu" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Spu_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Spu" ("createdAt", "department", "id", "name", "status", "updatedAt", "uploadedById") SELECT "createdAt", "department", "id", "name", "status", "updatedAt", "uploadedById" FROM "Spu";
DROP TABLE "Spu";
ALTER TABLE "new_Spu" RENAME TO "Spu";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
