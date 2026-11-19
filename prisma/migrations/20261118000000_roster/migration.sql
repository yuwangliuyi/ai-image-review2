ALTER TABLE "User" ADD COLUMN "rosterStatus" TEXT;
ALTER TABLE "User" ADD COLUMN "rosterName" TEXT;
ALTER TABLE "User" ADD COLUMN "rosterDepartment" TEXT;
ALTER TABLE "User" ADD COLUMN "rosterSource" TEXT;
ALTER TABLE "User" ADD COLUMN "rosterCheckedAt" DATETIME;
ALTER TABLE "Image" ADD COLUMN "uploadDepartment" TEXT;
ALTER TABLE "ReviewRecord" ADD COLUMN "reviewDepartment" TEXT;
