/** Real Next server + two loopback SSO instances + disposable database copies. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { migrateIdentities } from '../../scripts/sso-migrate-identities.mjs'
import { PrismaClient } from '@prisma/client'

import { fixture, ROOT, APP_ID } from './fixture.mjs'

async function cloneDatabase(source, destination) {
  const p = new PrismaClient({ datasources: { db: { url: `file:${source}` } } })
  try { await p.$executeRawUnsafe(`VACUUM INTO '${destination.replaceAll("'", "''")}'`) }
  finally { await p.$disconnect() }
}

async function businessSnapshot(db) {
  const p = new PrismaClient({ datasources: { db: { url: `file:${db}` } } })
  try { return JSON.stringify({ users: await p.user.findMany({ orderBy: { id: 'asc' } }), spus: await p.spu.findMany(), images: await p.image.findMany(), reviews: await p.reviewRecord.findMany(), notifications: await p.notification.findMany(), archives: await p.archive.findMany() }) }
  finally { await p.$disconnect() }
}

test('90 关联一次，独立数据库副本改配置连接 123 后保持原账号、角色及历史外键', async () => {
  const f = await fixture()
  try {
    const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
    for (const [id, role] of [['admin-local', 'ADMIN'], ['staff-local', 'REVIEWER'], ['manual-local', 'ADMIN']]) {
      await p.user.create({ data: { id, name: id, email: '', department: 'test', password: 'untouched', role } })
    }
    await p.spu.create({ data: { id: 'spu-old', name: 'existing product', uploadedById: 'admin-local', assignedReviewerId: 'staff-local', department: 'test' } })
    await p.image.create({ data: { id: 'image-old', filename: 'old.png', storedPath: '/existing/old.png', fileSize: 2, mimeType: 'image/png', spuId: 'spu-old', uploadedById: 'admin-local' } })
    await p.reviewRecord.create({ data: { id: 'review-old', imageId: 'image-old', reviewerId: 'staff-local', action: 'APPROVE', comment: 'keep' } })
    await p.notification.create({ data: { id: 'notice-old', userId: 'staff-local', message: 'keep' } })
    await p.archive.create({ data: { id: 'archive-old', spuId: 'spu-old', spuName: 'existing product', uploadedByName: 'admin-local', department: 'test', imageCount: 1 } })
    await p.$disconnect()
    await f.start(f.originalDb)
    const context = await f.api('/api/sso-setup/context', 'owner')
    assert.equal(context.status, 200, JSON.stringify(context))
    const rows = [['admin-local', 101], ['staff-local', 102], ['manual-local', 103]].map(([local_user_id, sso_user_id]) => ({ local_user_id, sso_user_id, confirmed: true, selection_source: 'manual' }))
    const mapped = await f.api('/api/sso-setup/mapping', 'owner', { revision: context.data.revision, rows })
    assert.equal(mapped.status, 200, JSON.stringify(mapped))
    const complete = await f.api('/api/sso-setup/complete', 'owner', { revision: mapped.data.revision })
    assert.equal(complete.status, 200, JSON.stringify(complete))
    assert.equal((await f.api('/api/auth/me', 'manual')).data.local_user_id, 'manual-local')
    for (const token of ['collision', 'lost-ding']) {
      const rejected = await f.api('/api/auth/me', token)
      assert.equal(rejected.status, 409, JSON.stringify(rejected))
      assert.equal(rejected.data.detail.code, 'MAPPING_CONFLICT')
    }
    for (const ding_user_id of [null, 'different-person']) {
      f.organizationRoster.staff = { ding_corp_id: ding_user_id ? 'corp-A' : null, ding_user_id }
      const changedIdentity = await f.api('/api/users/members', 'admin')
      assert.equal(changedIdentity.status, 409)
      assert.equal(changedIdentity.data.detail.code, 'MAPPING_CONFLICT')
    }
    delete f.organizationRoster.staff
    const baseline = await businessSnapshot(f.originalDb)
    await f.stop()
    await cloneDatabase(f.originalDb, f.copiedDb)
    await f.start(f.copiedDb, '123')
    const staff = await f.api('/api/auth/me', 'staff')
    assert.equal(staff.status, 200, JSON.stringify(staff))
    assert.equal(staff.data.local_user_id, 'staff-local')
    assert.deepEqual(staff.data.roles, ['REVIEWER'])
    assert.equal((await f.api('/api/auth/me', 'admin')).data.local_user_id, 'admin-local')
    f.organizationRoster.manual = { user_id: 101 }
    const directory = await f.api('/api/users/members', 'staff')
    assert.equal(directory.status, 200)
    const foreignNumber = directory.data.members.find(person => person.ssoUserId === 101)
    assert.equal(foreignNumber.id, null)
    assert.equal(foreignNumber.role, 'PENDING')
    const reviewer = directory.data.members.find(person => person.ssoUserId === 8)
    assert.equal(reviewer.id, 'staff-local')
    assert.equal(reviewer._count.reviews, 1)
    delete f.organizationRoster.manual
    assert.equal(await businessSnapshot(f.copiedDb), baseline)
    const demotion = await f.api('/api/users', 'admin', { id: 'admin-local', role: 'UPLOADER' }, 'PATCH')
    assert.equal(demotion.status, 409, '90-only 手工管理员不能作为123最后管理员的替代者')
    assert.equal(demotion.data.detail.code, 'LAST_ADMIN_REQUIRED')
    const manual = await f.api('/api/auth/me', 'manual')
    assert.equal(manual.status, 403)
    assert.equal(manual.data.detail.code, 'DINGTALK_IDENTITY_REQUIRED')
    for (const token of ['disabled', 'revoked', 'malformed', 'old-contract']) {
      const rejected = await f.api('/api/auth/me', token)
      assert.equal(rejected.status, ['disabled', 'revoked'].includes(token) ? 403 : 503, JSON.stringify(rejected))
    }
    assert.equal(await businessSnapshot(f.copiedDb), baseline, '所有拒绝路径不能改动原账号或建立新用户')
    assert.ok(f.queries.filter((query) => query.path.endsWith('/auth/verify')).every((query) => query.contract === 'dingtalk-v1'))
    const wrongCorp = await f.api('/api/auth/me', 'other-corp')
    assert.equal(wrongCorp.status, 200, JSON.stringify(wrongCorp))
    assert.notEqual(wrongCorp.data.local_user_id, 'admin-local')
    assert.equal(wrongCorp.data.is_pending, true, '其他企业同名人员 ID 不继承管理员')
    const newcomers = await Promise.all(Array.from({ length: 6 }, () => f.api('/api/auth/me', 'newbie')))
    assert.ok(newcomers.every((result) => result.status === 200), JSON.stringify(newcomers))
    assert.equal(new Set(newcomers.map((result) => result.data.local_user_id)).size, 1)
    assert.ok(newcomers.every((result) => result.data.is_pending))
    const dbCheck = new PrismaClient({ datasources: { db: { url: `file:${f.copiedDb}` } } })
    const audits = await dbCheck.ssoSetupAudit.findMany({ where: { action: 'provision' } })
    assert.equal(audits.filter((row) => JSON.parse(row.detailsJson).local_user_id === newcomers[0].data.local_user_id).length, 1, '并发建号审计只记录实际创建一次')
    let acquired
    const held = new Promise((resolve) => { acquired = resolve })
    const lock = dbCheck.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('UPDATE "SsoSetupState" SET "revision" = "revision" WHERE "id" = 1')
      acquired()
      await new Promise((resolve) => setTimeout(resolve, 350))
    })
    await held
    const lockedLogin = await f.api('/api/auth/me', 'locked')
    await lock
    assert.equal(lockedLogin.status, 200, JSON.stringify(lockedLogin))
    assert.equal(lockedLogin.data.is_pending, true)
    assert.equal(await dbCheck.ssoIdentityMapping.count({ where: { kind: 'dingtalk', namespace: 'corp-A', subject: 'person-lock' } }), 1)
    await dbCheck.$disconnect()
    const state = await f.api('/api/auth/mode', 'admin')
    assert.equal(state.data.phase, 'SSO_ONLY')
    await f.start(f.copiedDb, '90')
    assert.equal((await f.api('/api/auth/me', 'manual')).data.local_user_id, 'manual-local')
    assert.equal((await f.api('/api/auth/me', 'staff')).data.local_user_id, 'staff-local')
  } finally { await f.close() }
})


test('旧数字关联显式迁移：dry-run 不写、自动备份、幂等、保留未绑定与已删除中心人员', async () => {
  const f = await fixture()
  try {
    const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
    for (const [id, role, ssoUserId] of [['old-admin', 'ADMIN', 101], ['old-staff', 'REVIEWER', 102], ['old-manual', 'UPLOADER', 103], ['old-deleted', 'UPLOADER', 999]]) {
      await p.user.create({ data: { id, name: id, email: '', department: 'keep', password: 'keep', role, ssoUserId } })
    }
    await p.ssoSetupState.create({ data: { id: 1, classification: 'LEGACY', phase: 'SSO_ONLY', revision: 12 } })
    const originalUsers = JSON.stringify(await p.user.findMany({ orderBy: { id: 'asc' } }))
    const originalState = await p.ssoSetupState.findUnique({ where: { id: 1 } })
    await f.start(f.originalDb, '123')
    const refused = await f.api('/api/auth/me', 'staff')
    assert.equal(refused.status, 409)
    assert.equal(refused.data.detail.code, 'IDENTITY_MIGRATION_REQUIRED')
    assert.equal((await p.ssoSetupState.findUnique({ where: { id: 1 } })).sourceSsoApiUrl, null, '不能将第一次启动的 123 猜成来源')
    await f.stop()
    const args = { database: f.originalDb, sourceApi: `${f.center}/90/sso`, appId: APP_ID, token: 'owner' }
    const preview = await migrateIdentities(args)
    assert.equal(preview.portable_users, 2)
    assert.equal(preview.legacy_only_users, 2)
    assert.equal(await p.ssoIdentityMapping.count(), 0)
    assert.deepEqual(await p.ssoSetupState.findUnique({ where: { id: 1 } }), originalState)
    const migrated = await migrateIdentities({ ...args, apply: true, backupDirectory: join(f.temp, 'backups') })
    assert.equal(migrated.applied, true)
    assert.equal(statSync(migrated.backup).mode & 0o777, 0o600)
    const backup = new PrismaClient({ datasources: { db: { url: `file:${migrated.backup}` } } })
    assert.deepEqual(await backup.ssoSetupState.findUnique({ where: { id: 1 } }), originalState)
    assert.equal(JSON.stringify(await backup.user.findMany({ orderBy: { id: 'asc' } })), originalUsers)
    await backup.$disconnect()
    assert.equal(JSON.stringify(await p.user.findMany({ orderBy: { id: 'asc' } })), originalUsers)
    const changedState = await p.ssoSetupState.findUnique({ where: { id: 1 } })
    assert.equal(changedState.phase, 'SSO_ONLY')
    assert.equal(changedState.revision, 12)
    assert.equal(changedState.identitiesReady, true)
    assert.equal(await p.ssoIdentityMapping.count(), 6)
    const repeat = await migrateIdentities({ ...args, apply: true, backupDirectory: join(f.temp, 'backups') })
    assert.equal(repeat.unchanged, true)
    assert.equal(await p.ssoSetupAudit.count(), 1)
    await assert.rejects(() => migrateIdentities({ ...args, sourceApi: `${f.center}/123/sso` }), /来源/)
    await p.$disconnect()
    await cloneDatabase(f.originalDb, f.copiedDb)
    await f.start(f.copiedDb, '123')
    assert.equal((await f.api('/api/auth/me', 'staff')).data.local_user_id, 'old-staff')
    assert.equal((await f.api('/api/auth/me', 'manual')).status, 403)
    const copied = new PrismaClient({ datasources: { db: { url: `file:${f.copiedDb}` } } })
    const link = await copied.ssoIdentityMapping.findFirst({ where: { kind: 'legacy', subject: '101' } })
    await copied.ssoIdentityMapping.delete({ where: { id: link.id } })
    const incomplete = await f.api('/api/auth/me', 'newbie')
    assert.equal(incomplete.status, 409)
    assert.equal(incomplete.data.detail.code, 'IDENTITY_MIGRATION_REQUIRED')
    assert.equal(await copied.user.count(), 4, 'ready 标记不能掩盖漏迁移并触发重复 JIT')
    await copied.ssoIdentityMapping.create({ data: link })
    await copied.$disconnect()
    await f.start(f.copiedDb, '90')
    assert.equal((await f.api('/api/auth/me', 'manual')).data.local_user_id, 'old-manual')
  } finally { await f.close() }
})

test('旧关联迁移发生身份占用冲突：整批拒绝，原用户角色及映射不变', async () => {
  const f = await fixture()
  const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
  try {
    for (const [id, ssoUserId] of [['one', 101], ['two', 102]]) await p.user.create({ data: { id, name: id, ssoUserId, role: 'ADMIN', email: '', department: '', password: 'keep' } })
    await p.ssoSetupState.create({ data: { id: 1, classification: 'LEGACY', phase: 'SSO_ONLY' } })
    await p.ssoIdentityMapping.create({ data: { kind: 'dingtalk', namespace: 'corp-A', subject: 'person-admin', userId: 'two' } })
    const before = JSON.stringify({ users: await p.user.findMany(), state: await p.ssoSetupState.findMany(), identities: await p.ssoIdentityMapping.findMany() })
    await assert.rejects(() => migrateIdentities({ database: f.originalDb, sourceApi: `${f.center}/90/sso`, appId: APP_ID, token: 'owner', apply: true, backupDirectory: join(f.temp, 'backups') }), /身份冲突|钉钉身份发生变化/)
    assert.equal(JSON.stringify({ users: await p.user.findMany(), state: await p.ssoSetupState.findMany(), identities: await p.ssoIdentityMapping.findMany() }), before)
  } finally { await p.$disconnect(); await f.close() }
})

test('迁移期间原账号发生变化：事务重新核对快照并拒绝写入身份', async () => {
  const f = await fixture()
  const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
  try {
    await p.user.create({ data: { id: 'old', name: 'old', ssoUserId: 101, role: 'ADMIN', email: '', department: '', password: 'keep' } })
    await p.ssoSetupState.create({ data: { id: 1, classification: 'LEGACY', phase: 'SSO_ONLY' } })
    const fetcher = async (url, init) => {
      const response = await fetch(url, init)
      if (String(url).endsWith('/resolve-identities')) await p.user.update({ where: { id: 'old' }, data: { department: 'concurrent-valid-edit' } })
      return response
    }
    await assert.rejects(() => migrateIdentities({ database: f.originalDb, sourceApi: `${f.center}/90/sso`, appId: APP_ID, token: 'owner', apply: true, backupDirectory: join(f.temp, 'backups'), fetcher }), /已经变化/)
    assert.equal(await p.ssoIdentityMapping.count(), 0)
    assert.equal((await p.ssoSetupState.findUnique({ where: { id: 1 } })).identitiesReady, false)
    assert.equal((await p.user.findUnique({ where: { id: 'old' } })).department, 'concurrent-valid-edit')
  } finally { await p.$disconnect(); await f.close() }
})


test('新增数据库迁移只增加身份结构，不改已有用户、角色和业务记录', async () => {
  const f = await fixture()
  const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
  try {
    await p.user.create({ data: { id: 'keep-admin', name: 'keep-admin', role: 'ADMIN', ssoUserId: 101, email: '', department: 'original', password: 'keep' } })
    await p.spu.create({ data: { id: 'keep-spu', name: 'history', uploadedById: 'keep-admin', department: 'original' } })
    await p.ssoSetupState.create({ data: { id: 1, classification: 'LEGACY', phase: 'SSO_ONLY', revision: 8 } })
    const users = JSON.stringify(await p.user.findMany()), spus = JSON.stringify(await p.spu.findMany())
    await p.$executeRawUnsafe('DROP TABLE "SsoIdentityMapping"')
    for (const column of ['sourceSsoApiUrl', 'identitiesReady', 'identitySnapshotJson', 'mappedIdentityFingerprint']) await p.$executeRawUnsafe(`ALTER TABLE "SsoSetupState" DROP COLUMN "${column}"`)
    const sql = readFileSync(join(ROOT, 'prisma/migrations/20261015000000_add_dingtalk_identities/migration.sql'), 'utf8')
    for (const statement of sql.split(';').filter((value) => value.trim())) await p.$executeRawUnsafe(statement)
    assert.equal(JSON.stringify(await p.user.findMany()), users)
    assert.equal(JSON.stringify(await p.spu.findMany()), spus)
    const state = await p.ssoSetupState.findUnique({ where: { id: 1 } })
    assert.equal(state.phase, 'SSO_ONLY'); assert.equal(state.revision, 8)
    assert.equal(state.sourceSsoApiUrl, null); assert.equal(state.identitiesReady, false)
    assert.equal(await p.ssoIdentityMapping.count(), 0)
  } finally { await p.$disconnect(); await f.close() }
})

test('迁移 CLI 从标准输入读取凭据，默认 dry-run 不产生任何身份写入', async () => {
  const f = await fixture()
  const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
  try {
    await p.user.create({ data: { id: 'cli-admin', name: 'cli-admin', role: 'ADMIN', ssoUserId: 101, email: '', department: '', password: 'keep' } })
    await p.ssoSetupState.create({ data: { id: 1, classification: 'LEGACY', phase: 'SSO_ONLY' } })
    const child = spawn(process.execPath, ['scripts/sso-migrate-identities.mjs', '--database', f.originalDb, '--source-api', `${f.center}/90/sso`, '--app-id', APP_ID], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk }); child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.end('owner\n')
    const code = await new Promise((resolve) => child.on('close', resolve))
    assert.equal(code, 0, stderr)
    const preview = JSON.parse(stdout)
    assert.equal(preview.applied, false); assert.equal(preview.portable_users, 1)
    assert.equal(await p.ssoIdentityMapping.count(), 0)
    assert.equal((await p.ssoSetupState.findUnique({ where: { id: 1 } })).sourceSsoApiUrl, null)
  } finally { await p.$disconnect(); await f.close() }
})

test('两个管理员并发撤销自己的权限，最后一名当前环境可用管理员不能被清空', async () => {
  const f = await fixture()
  const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
  try {
    for (const [id, number, subject] of [['admin-one', 101, 'person-admin'], ['admin-two', 102, 'person-staff']]) {
      await p.user.create({ data: { id, name: id, role: 'ADMIN', ssoUserId: number, email: '', department: '', password: 'keep' } })
      await p.ssoIdentityMapping.createMany({ data: [{ kind: 'legacy', namespace: `${f.center}/90/sso`, subject: String(number), userId: id }, { kind: 'dingtalk', namespace: 'corp-A', subject, userId: id }] })
    }
    await p.ssoSetupState.create({ data: { id: 1, classification: 'LEGACY', phase: 'SSO_ONLY', sourceSsoApiUrl: `${f.center}/90/sso`, identitiesReady: true } })
    await f.start(f.originalDb)
    const results = await Promise.all([
      f.api('/api/users', 'admin', { id: 'admin-one', role: 'UPLOADER' }, 'PATCH'),
      f.api('/api/users', 'staff', { id: 'admin-two', role: 'UPLOADER' }, 'PATCH'),
    ])
    assert.equal(await p.user.count({ where: { role: 'ADMIN' } }), 1, JSON.stringify(results))
    assert.deepEqual(results.map((row) => row.status).sort(), [200, 409])
    assert.ok(results.some((row) => row.data.detail?.code === 'LAST_ADMIN_REQUIRED'))
    await p.user.updateMany({ data: { role: 'ADMIN' } })
    const removals = await Promise.all([
      f.api('/api/users', 'admin', { id: 'admin-two' }, 'DELETE'),
      f.api('/api/users', 'staff', { id: 'admin-one' }, 'DELETE'),
    ])
    assert.equal(await p.user.count({ where: { role: 'ADMIN' } }), 2, JSON.stringify(removals))
    assert.deepEqual(removals.map((row) => row.status).sort(), [409, 409])
  } finally { await p.$disconnect(); await f.close() }
})
