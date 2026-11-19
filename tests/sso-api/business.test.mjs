import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import XLSX from 'xlsx'
import { fixture, ROOT } from './fixture.mjs'

test('隔离副本的上传、全局超管审核、归档、下载和撤权数据范围', async () => {
  process.env.AI_REVIEW_INSTANCE_MODE = 'validation'
  const f = await fixture()
  const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
  const files = []
  try {
    for (const [id, role] of [['admin-local', 'ADMIN'], ['staff-local', 'UPLOADER']]) {
      await p.user.create({ data: { id, name: id, role, email: '', department: '合成测试', password: 'unchanged' } })
    }
    await f.start(f.originalDb)
    const mode = await fetch(`${f.base}/api/auth/mode`).then(response => response.json())
    assert.equal(mode.validation_only, true, '公开模式必须传递验证环境标识，才能显示提醒')
    const context = await f.api('/api/sso-setup/context', 'owner')
    const mapped = await f.api('/api/sso-setup/mapping', 'owner', { revision: context.data.revision, rows: [
      { local_user_id: 'admin-local', sso_user_id: 101, confirmed: true, selection_source: 'manual' },
      { local_user_id: 'staff-local', sso_user_id: 102, confirmed: true, selection_source: 'manual' },
    ] })
    assert.equal((await f.api('/api/sso-setup/complete', 'owner', { revision: mapped.data.revision })).status, 200)
    const organization = name => ({ departments: [{ full_path: name }], primary_department: null, observed_at: '2026-11-18T02:00:00+08:00' })
    f.organizationRoster.admin = { organization: organization('旧部门') }
    assert.equal((await f.api('/api/users/refresh', 'staff', {})).status, 403)
    assert.equal((await f.api('/api/users/members', 'staff')).status, 403)
    const first = await f.api('/api/users/refresh', 'admin', {})
    assert.equal(first.status, 200)
    assert.equal(first.data.members.length, 6)
    const newcomer = first.data.members.find(row => row.ssoUserId === 205)
    assert.equal(newcomer.id, null)
    assert.equal(newcomer.role, 'PENDING')
    assert.equal(newcomer.createdAt, null)
    assert.equal(await p.user.count(), 2, '读取授权人员不能创建或认领本地账号')
    await p.user.update({ where: { id: 'staff-local' }, data: { role: 'REVIEWER' } })
    assert.equal((await f.api('/api/users/members', 'staff')).data.members.length, 6)
    assert.equal((await f.api('/api/users/refresh', 'staff', {})).status, 403)
    await p.user.update({ where: { id: 'staff-local' }, data: { role: 'UPLOADER' } })
    const created = await f.api('/api/spus', 'admin', { name: '隔离事务测试', category: '软包床' })
    assert.equal(created.status, 201, JSON.stringify(created))
    const spuId = created.data.id
    const form = new FormData()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    form.append('files', new Blob([png], { type: 'image/png' }), 'synthetic.png')
    const uploaded = await fetch(`${f.base}/api/spus/${spuId}/upload`, { method: 'POST', headers: { Authorization: 'Bearer admin' }, body: form })
    assert.equal(uploaded.status, 201)
    const [image] = await uploaded.json()
    files.push(join(ROOT, 'public', image.storedPath))
    const imageUrl = `${f.base}/api/images/${image.id}/file`
    assert.equal((await fetch(imageUrl)).status, 401, 'image tags cannot access protected files without SSO')
    const imageFile = await fetch(imageUrl, { headers: { Authorization: 'Bearer admin' } })
    assert.equal(imageFile.status, 200)
    assert.equal(imageFile.headers.get('Cache-Control'), 'private, no-store')
    assert.deepEqual(Buffer.from(await imageFile.arrayBuffer()), png)
    assert.equal((await f.api(`/api/images/${image.id}/review`, 'staff', { action: 'REJECTED' })).status, 403)
    assert.equal((await f.api('/api/spus', 'staff')).data.total, 0)
    f.claims.staff = { is_global_super_admin: true }
    assert.equal((await f.api('/api/spus', 'staff')).data.total, 1)
    assert.equal((await f.api(`/api/images/${image.id}/review`, 'staff', { action: 'REJECTED' })).status, 200)
    await p.image.update({ where: { id: image.id }, data: { status: 'PENDING' } })
    const reviewed = await f.api(`/api/spus/${spuId}/review`, 'staff', { action: 'APPROVED' })
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed))
    const stored = await p.image.findUnique({ where: { id: image.id } })
    if (stored.storedLocalPath) files.push(stored.storedLocalPath)
    const archivedFile = await fetch(imageUrl, { headers: { Authorization: 'Bearer admin' } })
    assert.equal(archivedFile.status, 200)
    assert.deepEqual(Buffer.from(await archivedFile.arrayBuffer()), png)
    assert.equal((await p.spu.findUnique({ where: { id: spuId } })).status, 'APPROVED')
    assert.equal(await p.reviewRecord.count(), 2)
    assert.ok(await p.notification.count() > 0)
    const archive = await p.archive.findUnique({ where: { spuId } })
    assert.equal(archive.imageCount, 1)
    const zip = await fetch(`${f.base}/api/archives/${archive.id}/download`, { headers: { Authorization: 'Bearer staff' } })
    assert.equal(zip.status, 200)
    assert.equal(Buffer.from(await zip.arrayBuffer()).subarray(0, 2).toString(), 'PK')
    assert.equal((await f.api('/api/stats', 'staff')).status, 200)
    f.organizationRoster.admin = { organization: organization('新部门') }
    f.organizationRoster.staff = { status: 0 }
    const current = await f.api('/api/users/refresh', 'admin', {})
    assert.equal(current.status, 200)
    const linked = current.data.members.find(row => row.id === 'admin-local')
    assert.equal(linked.department, '新部门')
    assert.equal(linked.role, 'ADMIN')
    assert.equal(linked._count.uploadedSpus, 1)
    assert.equal(current.data.members.find(row => row.id === 'staff-local').rosterStatus, 'DISABLED')
    const directory = (await f.api('/api/users', 'admin')).data
    assert.equal(directory.find(row => row.id === 'admin-local').department, '新部门')
    assert.equal(directory.find(row => row.id === 'staff-local').rosterStatus, 'DISABLED')
    f.organizationRoster.staff = false
    f.organizationRoster.admin = { organization: undefined }
    const oldCenter = await f.api('/api/users/refresh', 'admin', {})
    assert.equal(oldCenter.status, 200)
    assert.ok(!oldCenter.data.members.some(row => row.ssoUserId === 102))
    assert.equal(oldCenter.data.members.find(row => row.id === 'admin-local').department, '新部门')
    assert.equal((await p.user.findUnique({ where: {id:'staff-local'} })).rosterStatus, 'NOT_LISTED')
    assert.equal(await p.reviewRecord.count({ where: { reviewerId: 'staff-local' } }), 2)
    f.organizationRoster.admin = { organization: {} }
    assert.equal((await f.api('/api/users/refresh', 'admin', {})).status, 503)
    assert.equal((await p.user.findUnique({where:{id:'admin-local'}})).rosterDepartment, '新部门')
    const exported = await fetch(`${f.base}/api/data-center/export`, { headers: { Authorization: 'Bearer staff' } })
    assert.equal(exported.status, 200)
    const workbook = XLSX.read(await exported.arrayBuffer(), { type: 'array' })
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['图片明细'])[0]['上传部门'], '旧部门')
    assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets['SPU明细'])[0]['上传部门'], '旧部门')
    assert.ok(workbook.SheetNames.length >= 3)
    const rows = workbook.SheetNames.flatMap(name => XLSX.utils.sheet_to_json(workbook.Sheets[name]))
    assert.ok(JSON.stringify(rows).includes('隔离事务测试'), '升级后的 Excel 导出必须保留业务内容')
    f.claims.staff = { is_global_super_admin: false }
    assert.equal((await f.api('/api/spus', 'staff')).data.total, 0)
    assert.equal((await p.user.findUnique({ where: { id: 'staff-local' } })).role, 'UPLOADER')
  } finally {
    for (const file of files) rmSync(file, { force: true })
    await p.$disconnect(); await f.close()
  }
})
