-- 佳选 SSO guided 接入：增量变更，不改动既有表数据
-- 用户表增加唯一 SSO 关联列（多个 NULL 不冲突）
ALTER TABLE `User` ADD COLUMN `ssoUserId` INTEGER;

-- 唯一索引：同一公司账号只能关联一个本地身份
CREATE UNIQUE INDEX `User_ssoUserId_key` ON `User`(`ssoUserId`);

-- 接入状态机单行表
CREATE TABLE `SsoSetupState` (
    `id` INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    `classification` TEXT NOT NULL,
    `phase` TEXT NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `operatorLocalId` TEXT,
    `connectedSsoId` INTEGER,
    `snapshotJson` TEXT,
    `mappedFingerprint` TEXT,
    `reviewFingerprint` TEXT,
    `mappedUsersJson` TEXT,
    `adminRevision` INTEGER,
    `adminExpires` REAL,
    `maintenanceLocked` BOOLEAN NOT NULL DEFAULT false,
    `rollbackAvailable` BOOLEAN NOT NULL DEFAULT false
);

-- 部分草稿
CREATE TABLE `SsoSetupDraft` (
    `localId` TEXT NOT NULL PRIMARY KEY,
    `ssoId` INTEGER,
    `selectionSource` TEXT NOT NULL,
    `accountFingerprint` TEXT NOT NULL,
    `phoneFingerprint` TEXT NOT NULL
);

-- 接入审计
CREATE TABLE `SsoSetupAudit` (
    `id` INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    `action` TEXT NOT NULL,
    `revision` INTEGER NOT NULL,
    `localActorId` TEXT,
    `ssoActorId` INTEGER,
    `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `detailsJson` TEXT NOT NULL
);
