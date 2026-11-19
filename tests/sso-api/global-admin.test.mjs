import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PrismaClient } from '@prisma/client'
import { fixture } from './fixture.mjs'

test('全局超管动态继承管理权限，撤销立即恢复原角色，维护与负责人边界不放宽', async () => {
  const f = await fixture()
  const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
  try {
    for (const [id, role] of [['admin-local', 'ADMIN'], ['staff-local', 'UPLOADER'], ['manual-local', 'PENDING']]) {
      await p.user.create({ data: { id, name: id, role, email: '', department: '', password: 'unchanged' } })
    }
    await f.start(f.originalDb)
    const context = await f.api('/api/sso-setup/context', 'owner')
    const rows = [['admin-local', 101], ['staff-local', 102], ['manual-local', 103]].map(([local_user_id, sso_user_id]) => ({ local_user_id, sso_user_id, confirmed: true, selection_source: 'manual' }))
    const mapped = await f.api('/api/sso-setup/mapping', 'owner', { revision: context.data.revision, rows })
    assert.equal(mapped.status, 200, JSON.stringify(mapped))
    assert.equal((await f.api('/api/sso-setup/complete', 'owner', { revision: mapped.data.revision })).status, 200)
    f.claims.staff = { is_global_super_admin: true }
    const me = await f.api('/api/auth/me', 'staff')
    assert.equal(me.data.is_global_super_admin, true)
    assert.equal(me.data.is_admin, true)
    assert.deepEqual(me.data.roles, ['UPLOADER'], '持久角色仍表示独立授权')
    assert.equal((await f.api('/api/users', 'staff')).status, 200)
    const assigned = await f.api('/api/users', 'staff', { id: 'manual-local', role: 'REVIEWER' }, 'PATCH')
    assert.equal(assigned.status, 200, JSON.stringify(assigned))
    assert.equal((await p.user.findUnique({ where: { id: 'staff-local' } })).role, 'UPLOADER')
    assert.equal((await f.api('/api/sso-setup/context', 'staff')).status, 403, '超管不能替代负责人')
    await p.ssoSetupState.update({ where: { id: 1 }, data: { maintenanceLocked: true } })
    assert.equal((await f.api('/api/users', 'staff')).status, 503)
    await p.ssoSetupState.update({ where: { id: 1 }, data: { maintenanceLocked: false } })
    f.claims.staff = { is_global_super_admin: false }
    assert.equal((await f.api('/api/users', 'staff')).status, 403)
    assert.equal((await f.api('/api/auth/me', 'staff')).data.is_admin, false)
    f.claims.staff = { is_global_super_admin: 'true' }
    assert.equal((await f.api('/api/auth/me', 'staff')).status, 503)
  } finally { await p.$disconnect(); await f.close() }
})

test('新全局超管即使也是空项目负责人仍保存 PENDING，撤销后恢复待授权', async () => {
  const f = await fixture()
  const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
  try {
    f.claims.owner = { is_global_super_admin: true }
    await f.start(f.originalDb)
    const me = await f.api('/api/auth/me', 'owner')
    assert.equal(me.status, 200)
    assert.equal(me.data.is_pending, false)
    assert.equal(me.data.is_admin, true)
    assert.equal((await p.user.findUnique({ where: { id: me.data.local_user_id } })).role, 'PENDING')
    assert.equal((await f.api('/api/users', 'owner')).status, 200)
    f.claims.owner = { is_global_super_admin: false }
    assert.equal((await f.api('/api/auth/me', 'owner')).data.is_pending, true)
    assert.equal((await f.api('/api/stats', 'owner')).status, 403)
  } finally { await p.$disconnect(); await f.close() }
})

test('已有项目未完成接入时，全局超管也不能首次建号', async () => {
  const f = await fixture()
  const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
  try {
    await p.user.create({ data: { name: 'old-admin', role: 'ADMIN', email: '', department: '', password: 'unchanged' } })
    f.claims.newbie = { is_global_super_admin: true }
    await f.start(f.originalDb)
    assert.equal((await f.api('/api/auth/me', 'newbie')).status, 403)
    assert.equal(await p.user.count(), 1)
  } finally { await p.$disconnect(); await f.close() }
})
