-- Additive only: original User rows, roles, IDs, timestamps and business foreign keys remain untouched.
ALTER TABLE "SsoSetupState" ADD COLUMN "sourceSsoApiUrl" TEXT;
ALTER TABLE "SsoSetupState" ADD COLUMN "identitiesReady" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SsoSetupState" ADD COLUMN "identitySnapshotJson" TEXT;
ALTER TABLE "SsoSetupState" ADD COLUMN "mappedIdentityFingerprint" TEXT;
CREATE TABLE "SsoIdentityMapping" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "kind" TEXT NOT NULL,
  "namespace" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "SsoIdentityMapping_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SsoIdentityMapping_kind_namespace_subject_key" ON "SsoIdentityMapping"("kind", "namespace", "subject");
CREATE INDEX "SsoIdentityMapping_userId_idx" ON "SsoIdentityMapping"("userId");
