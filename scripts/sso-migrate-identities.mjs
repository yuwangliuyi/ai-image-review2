#!/usr/bin/env node
/** Explicit, original-center identity upgrade. Never reads .env or defaults to a project database. */
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTRACT = 'dingtalk-v1';
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyOf = (row) => JSON.stringify([row.kind, row.namespace, row.subject]);

function sourceUrl(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('来源必须是完整 HTTP(S) SSO API 地址');
  return url.href.replace(/\/+$/, '');
}
function pair(raw) {
  const corp = raw.ding_corp_id, user = raw.ding_user_id;
  if (corp === null && user === null) return null;
  const valid = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\s\x00-\x1f\x7f]/.test(value);
  if (!valid(corp, 64) || !valid(user, 128)) throw new Error('中心返回不完整或非法的钉钉身份');
  return { kind: 'dingtalk', namespace: corp, subject: user };
}
async function snapshot(tx) {
  return {
    users: await tx.user.findMany({ orderBy: { id: 'asc' } }),
    state: await tx.ssoSetupState.findUnique({ where: { id: 1 } }),
    mappings: await tx.ssoIdentityMapping.findMany({ orderBy: [{ kind: 'asc' }, { namespace: 'asc' }, { subject: 'asc' }] }),
    drafts: await tx.ssoSetupDraft.findMany({ orderBy: { localId: 'asc' } }),
  };
}

export async function migrateIdentities({ database, sourceApi, appId, token, apply = false, backupDirectory, fetcher = fetch }) {
  if (!isAbsolute(database || '') || !existsSync(database)) throw new Error('--database 必须明确指定一个已存在的 SQLite 绝对路径');
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(appId || '')) throw new Error('--app-id 不合法');
  if (!token || /\s/.test(token)) throw new Error('请从标准输入提供负责人 Token');
  const source = sourceUrl(sourceApi);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
  try {
    const before = await snapshot(prisma);
    if (!before.state) throw new Error('接入状态未初始化，请先在原环境初始化');
    if (before.state.sourceSsoApiUrl && before.state.sourceSsoApiUrl !== source) throw new Error('来源与已记录原 SSO 不一致，拒绝迁移');
    const users = before.users.filter((user) => user.ssoUserId !== null);
    const ids = users.map((user) => user.ssoUserId);
    const resolved = new Map();
    async function request(path, body) {
      const response = await fetcher(`${source}${path}`, {
        method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'X-JX-SSO-Identity': CONTRACT, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.code !== 0 || payload?.data?.identity_contract !== CONTRACT) throw new Error('原 SSO 身份解析失败，未应用迁移');
      return payload.data;
    }
    // Even zero bindings must establish that this really is the requested trusted application center.
    const current = await request(`/auth/verify?app_id=${encodeURIComponent(appId)}`);
    if (!Number.isSafeInteger(current.user_id) || current.user_id <= 0 || current.user_id > 2147483647 || current.app_id !== appId || current.application_allowed !== true || typeof current.is_application_owner !== 'boolean') throw new Error('当前应用身份校验不符合契约');
    pair(current);
    // The resolver enforces owner/global-admin even when there are no original bindings.
    const requested = ids.length ? ids : [current.user_id];
    for (let i = 0; i < requested.length; i += 100) {
      const batch = requested.slice(i, i + 100);
      const data = await request('/app/users/resolve-identities', { app_id: appId, user_ids: batch });
      if (!Array.isArray(data.records) || data.records.length !== batch.length) throw new Error('身份解析返回不完整');
      data.records.forEach((raw, index) => {
        if (!raw || raw.user_id !== batch[index] || typeof raw.found !== 'boolean') throw new Error('身份解析返回 ID 或顺序不一致');
        const ding = pair(raw);
        if (!raw.found && ding) throw new Error('已不存在人员不能返回钉钉身份');
        if (ids.length) resolved.set(raw.user_id, ding);
      });
    }
    const proposed = [];
    const occupied = new Map(before.mappings.map((row) => [keyOf(row), row.userId]));
    for (const user of users) {
      const ding = resolved.get(user.ssoUserId);
      const existingDing = before.mappings.filter((row) => row.userId === user.id && row.kind === 'dingtalk');
      if (existingDing.some((row) => !ding || keyOf(row) !== keyOf(ding))) throw new Error('已保存钉钉身份发生变化，禁止替换或降级');
      for (const identity of [{ kind: 'legacy', namespace: source, subject: String(user.ssoUserId) }, ...(ding ? [ding] : [])]) {
        const key = keyOf(identity);
        const owner = occupied.get(key);
        if (owner && owner !== user.id) throw new Error('身份冲突：同一个钉钉人员或旧数字账号关联了不同本地用户');
        if (!owner) { proposed.push({ ...identity, userId: user.id }); occupied.set(key, user.id); }
      }
    }
    const preview = { source_api: source, app_id: appId, legacy_users: users.length,
      portable_users: [...resolved.values()].filter(Boolean).length,
      legacy_only_users: [...resolved.values()].filter((v) => !v).length,
      new_identity_rows: proposed.length, snapshot_sha256: hash(before), applied: false };
    if (!apply) return preview;
    if (!backupDirectory || !isAbsolute(backupDirectory)) throw new Error('--apply 必须指定绝对路径 --backup-directory');
    if (!proposed.length && before.state.identitiesReady && before.state.sourceSsoApiUrl === source) return { ...preview, applied: true, unchanged: true };
    mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
    const backup = join(backupDirectory, `before-dingtalk-${Date.now()}-${randomUUID()}.db`);
    writeFileSync(backup, '', { flag: 'wx', mode: 0o600 });
    // SQLite creates a consistent independent backup, including uncheckpointed pages.
    await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    chmodSync(backup, 0o600);
    const backupReader = new PrismaClient({ datasources: { db: { url: `file:${backup}` } } });
    try {
      const integrity = await backupReader.$queryRawUnsafe('PRAGMA integrity_check');
      const foreignKeys = await backupReader.$queryRawUnsafe('PRAGMA foreign_key_check');
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || foreignKeys.length !== 0) throw new Error('备份完整性检查失败，未应用迁移');
      if (hash(await snapshot(backupReader)) !== hash(before)) throw new Error('账号或接入状态已经变化，请重新预览');
    } finally { await backupReader.$disconnect(); }
    await prisma.$transaction(async (tx) => {
      if (hash(await snapshot(tx)) !== hash(before)) throw new Error('账号、角色、映射或接入状态已经变化，请重新预览');
      if (proposed.length) await tx.ssoIdentityMapping.createMany({ data: proposed });
      const data = { sourceSsoApiUrl: source, identitiesReady: true };
      // Preserve rollback anchors for an interrupted pre-upgrade mapping batch.
      if (before.state.snapshotJson && before.state.identitySnapshotJson === null) {
        const previous = JSON.parse(before.state.snapshotJson);
        const all = [...before.mappings, ...proposed].map(({ kind, namespace, subject, userId }) => ({ kind, namespace, subject, userId }));
        data.identitySnapshotJson = JSON.stringify(all.filter((row) => previous[row.userId] != null));
      }
      if (before.state.mappedFingerprint && before.state.mappedIdentityFingerprint === null) {
        const mappings = await tx.ssoIdentityMapping.findMany({ where: before.state.snapshotJson ? { userId: { in: Object.keys(JSON.parse(before.state.snapshotJson)) } } : undefined, select: { kind: true, namespace: true, subject: true, userId: true }, orderBy: [{ kind: 'asc' }, { namespace: 'asc' }, { subject: 'asc' }] });
        const sort = (value) => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, sort(value[key])])) : value;
        data.mappedIdentityFingerprint = hash(sort(mappings));
      }
      await tx.ssoSetupState.update({ where: { id: 1 }, data });
      await tx.ssoSetupAudit.create({ data: { action: 'identity-migration', revision: before.state.revision, detailsJson: JSON.stringify({ source_api: source, rows: proposed.length, before_sha256: hash(before) }) } });
    }, { timeout: 15000 });
    return { ...preview, applied: true, backup };
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  const names = { '--database': 'database', '--source-api': 'sourceApi', '--app-id': 'appId', '--backup-directory': 'backupDirectory' };
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--apply') options.apply = true;
      else if (args[i] === '--dry-run') options.apply = false;
      else if (names[args[i]] && args[i + 1]) options[names[args[i]]] = args[++i];
      else throw new Error('用法：--database 绝对路径 --source-api 原SSO地址 --app-id 应用ID [--dry-run | --apply --backup-directory 绝对路径]；Token 仅从标准输入读取');
    }
    let token = '';
    for await (const chunk of process.stdin) { token += chunk; if (token.length > 16384) throw new Error('Token 过长'); }
    options.token = token.trim();
    console.log(JSON.stringify(await migrateIdentities(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
