/**
 * guided 接入后端集成测试：mock SSO 中心 + 真实 Next.js 服务 + 隔离 SQLite。
 * 覆盖：模式、旧登录、负责人鉴权、草稿、映射校验、冻结、撤销、完成切换、
 * JIT 待授权、角色分配、统一退出、旧登录关闭与恢复工具。
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const temp = mkdtempSync(join(tmpdir(), 'ai-image-leg-test-'))
const testDb = join(temp, 'test.db')
writeFileSync(testDb, '')
const testDbUrl = `file:${testDb}`
const APP_PORT = 4311
const COOKIE_PREFIX = 'ai-review-sso90-test'
const MOCK_PORT = 4312
const BASE = `http://127.0.0.1:${APP_PORT}`
const APP_ID = 'APP_CABB266C38BF45B46952154A'
const OWNER_TOKEN = 'owner-token'
const ADMIN_TOKEN = 'admin-token'
const STAFF_TOKEN = 'staff-token'
const NEWBIE_TOKEN = 'newbie-token'

const tokens = {
  [OWNER_TOKEN]: { user_id: 1, username: 'owner-center', name: '应用负责人' },
  [ADMIN_TOKEN]: { user_id: 101, username: 'center-admin', name: '赵于淋公司号' },
  [STAFF_TOKEN]: { user_id: 102, username: 'center-staff', name: '中心员工' },
  [NEWBIE_TOKEN]: { user_id: 205, username: 'newbie', name: '新人' },
}
const roster = [
  { user_id: 1, username: 'owner-center', name: '应用负责人', status: 1, access_source: 'ROLE', ding_corp_id: null, ding_user_id: null },
  { user_id: 101, username: 'center-admin', name: '赵于淋公司号', status: 1, access_source: 'ROLE', ding_corp_id: null, ding_user_id: null },
  { user_id: 102, username: 'center-staff', name: '何扬帆公司号', status: 1, access_source: 'ROLE', ding_corp_id: null, ding_user_id: null },
  { user_id: 103, username: 'disabled-person', name: '停用人员', status: 0, access_source: 'ROLE', ding_corp_id: null, ding_user_id: null },
  { user_id: 205, username: 'newbie', name: '新人', status: 1, access_source: 'ROLE', ding_corp_id: null, ding_user_id: null },
]
const logoutCalls = []
let appProcess
let mockServer

function startMockCenter() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`)
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')
      const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/, '')
      const identity = tokens[bearer]
      if (url.pathname === '/sso/auth/verify') {
        if (!identity) return reply(200, { code: 401, msg: 'unauthorized' })
        if (url.searchParams.get('app_id') !== APP_ID) return reply(403, { code: 403, msg: 'forbidden' })
        return reply(200, { code: 0, msg: 'success', data: { identity_contract: 'dingtalk-v1', ding_corp_id: null, ding_user_id: null, is_application_owner: identity.user_id === 1, app_id: APP_ID, application_allowed: true, ...identity } })
      }
      if (url.pathname === '/sso/app/users') {
        if (!identity) return reply(200, { code: 401, msg: 'unauthorized' })
        const pageNo = Number(url.searchParams.get('page_no'))
        const pageSize = Number(url.searchParams.get('page_size'))
        const records = roster.slice((pageNo - 1) * pageSize, pageNo * pageSize)
        return reply(200, {
          code: 0, msg: 'success',
          data: { identity_contract: 'dingtalk-v1', records, page_no: pageNo, page_size: pageSize, total_page: Math.ceil(roster.length / pageSize), total_count: roster.length },
        })
      }
      if (url.pathname === '/sso/app/users/match-phone' && req.method === 'POST') {
        if (!identity) return reply(200, { code: 401, msg: 'unauthorized' })
        const body = JSON.parse(rawBody || '{}')
        return reply(200, {
          code: 0, msg: 'success',
          data: { identity_contract: 'dingtalk-v1', records: (body.rows || []).map((row) => ({ row_key: row.row_key, status: 'no_match', candidate: null })) },
        })
      }
      if (url.pathname === '/sso/auth/logout' && req.method === 'POST') {
        if (!identity) return reply(200, { code: 401, msg: 'unauthorized' })
        logoutCalls.push(JSON.parse(rawBody || '{}'))
        return reply(200, { code: 0, msg: 'success', data: {} })
      }
      reply(404, { code: 404, msg: 'not found' })
    })
  })
  return new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)))
}

async function waitForApp() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/auth/mode`)
      if (response.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('应用启动超时')
}

async function loginLegacy(name, password) {
  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfResponse.json()
  const cookies = (csrfResponse.headers.getSetCookie?.() ?? [])
    .map((part) => part.split(';')[0])
    .join('; ')
  const response = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({ csrfToken, name, password, json: 'true' }),
    redirect: 'manual',
  })
  const sessionCookie = (response.headers.getSetCookie?.() ?? []).find((part) =>
    part.startsWith(`${COOKIE_PREFIX}.session-token=`)
  )
  return { response, cookie: sessionCookie ? sessionCookie.split(';')[0] : null }
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { ...options, cache: 'no-store' })
  const text = await response.text()
  let body = null
  try {
    body = JSON.parse(text)
  } catch {}
  return { status: response.status, body, headers: response.headers }
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` })
const json = { 'Content-Type': 'application/json' }

let adminUserId, staffUserId, uploaderUserId

before(async () => {
  // 1. 隔离测试库（db push + 种子），不触碰开发库
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso` },
    stdio: 'ignore',
  })
  const seed = `
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcryptjs');
    const prisma = new PrismaClient();
    (async () => {
      const users = [
        ['赵于淋', 'ADMIN', 'admin123'],
        ['何扬帆', 'REVIEWER', 'reviewer123'],
        ['测试上传', 'UPLOADER', 'upload123'],
      ];
      for (const [name, role, password] of users) {
        await prisma.user.create({ data: { name, role, department: '视觉部', email: '', password: await bcrypt.hash(password, 4) } });
      }
      await prisma.$disconnect();
    })();
  `
  execFileSync('node', ['-e', seed], { cwd: ROOT, env: { ...process.env, DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso` }, stdio: 'ignore' })
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } })
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } })
  adminUserId = users[0].id
  staffUserId = users[1].id
  uploaderUserId = users[2].id
  await prisma.$disconnect()

  // 2. mock 中心 + 应用
  mockServer = await startMockCenter()
  appProcess = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso`,
      NEXTAUTH_URL: BASE,
      AUTH_COOKIE_PREFIX: COOKIE_PREFIX,
      NEXTAUTH_SECRET: 'test-secret-for-sso-integration',
      JX_SSO_WEB_URL: `http://127.0.0.1:${MOCK_PORT}`,
      JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso`,
      JX_SSO_APP_ID: APP_ID,
      JX_SSO_OWNER_USER_ID: '1',
      JX_SSO_ENVIRONMENT: 'test',
      JX_SSO_ONBOARDING_MODE: 'guided',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let appLog = ''
  appProcess.stdout.on('data', (chunk) => { appLog += chunk })
  appProcess.stderr.on('data', (chunk) => { appLog += chunk })
  appProcess.on('exit', (code) => { appLog += `\n[app exited code=${code}]` })
  try {
    await waitForApp()
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    throw new Error(`${error.message}\n--- 应用日志 ---\n${appLog.slice(-3000)}`)
  }
})

after(async () => {
  // next start 会派生子进程：按进程组结束，避免端口占用影响后续运行
  if (appProcess?.pid) {
    try {
      process.kill(-appProcess.pid, 'SIGKILL')
    } catch {
      appProcess.kill('SIGKILL').catch?.(() => {})
    }
  }
  await new Promise((resolve) => mockServer ? mockServer.close(resolve) : resolve())
  rmSync(temp, { recursive: true, force: true })
})

test('初始模式：LEGACY + MAPPING_REQUIRED，旧登录开放', async () => {
  const { status, body } = await api('/api/auth/mode')
  assert.equal(status, 200)
  assert.equal(body.classification, 'LEGACY')
  assert.equal(body.phase, 'MAPPING_REQUIRED')
  assert.equal(body.legacy_login_enabled, true)
  assert.equal(body.jit_enabled, false)
  assert.equal(body.app_id, APP_ID)
  assert.equal(body.headers?.['cache-control'], undefined) // 模式接口本身 no-store
})

test('准备阶段：原登录与业务可用', async () => {
  const { response, cookie } = await loginLegacy('赵于淋', 'admin123')
  assert.ok(response.status >= 200 && response.status < 400, '旧登录应当成功')
  assert.ok(cookie, '应设置会话 Cookie')
  assert.ok(cookie.startsWith(`${COOKIE_PREFIX}.session-token=`), '并行实例使用独立会话 Cookie')
  assert.ok(!(response.headers.getSetCookie?.() ?? []).some(part => part.startsWith('next-auth.')), '不覆盖旧版 Cookie')
  const stats = await api('/api/stats', { headers: { Cookie: cookie } })
  assert.equal(stats.status, 200)
  const me = await api('/api/auth/me', { headers: { Cookie: cookie } })
  assert.equal(me.status, 200)
  assert.equal(me.body.auth_method, 'local')
  assert.equal(me.body.is_admin, true)
})

test('me 无凭据：401 LOCAL_SESSION_REQUIRED', async () => {
  const { status, body } = await api('/api/auth/me')
  assert.equal(status, 401)
  assert.equal(body.detail.code, 'LOCAL_SESSION_REQUIRED')
})

test('接入接口鉴权：无 Bearer 401；非负责人 403；负责人 200', async () => {
  const anonymous = await api('/api/sso-setup/context')
  assert.equal(anonymous.status, 401)
  assert.equal(anonymous.body.detail.code, 'SSO_UNAUTHORIZED')
  const intruder = await api('/api/sso-setup/context', { headers: bearer(STAFF_TOKEN) })
  assert.equal(intruder.status, 403)
  assert.equal(intruder.body.detail.code, 'APPLICATION_OWNER_REQUIRED')
  const owner = await api('/api/sso-setup/context', { headers: bearer(OWNER_TOKEN) })
  assert.equal(owner.status, 200)
  assert.equal(owner.body.users.length, 3)
  assert.equal(owner.body.roster.length, 5)
  assert.equal(owner.body.connected_user_id, 1)
  assert.equal(owner.body.phase, 'MAPPING_REQUIRED')
})

test('草稿：部分保存成功并递增版本；陈旧版本拒绝', async () => {
  const before = (await api('/api/auth/mode')).body.revision
  const draft = await api('/api/sso-setup/draft', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json },
    body: JSON.stringify({
      revision: before,
      rows: [
        { local_user_id: adminUserId, sso_user_id: 101, selection_source: 'manual' },
        { local_user_id: staffUserId, sso_user_id: null, selection_source: 'manual' },
        { local_user_id: uploaderUserId, sso_user_id: null, selection_source: 'manual' },
      ],
    }),
  })
  assert.equal(draft.status, 200)
  assert.equal(draft.body.draft_rows.find((row) => row.local_user_id === adminUserId).sso_user_id, 101)
  const stale = await api('/api/sso-setup/draft', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json },
    body: JSON.stringify({ revision: before, rows: [] }),
  })
  assert.equal(stale.status, 409) // 陈旧版本或缺失账号集合 → 冲突
  const context = await api('/api/sso-setup/context', { headers: bearer(OWNER_TOKEN) })
  assert.ok(context.body.revision > before, '草稿保存后版本应递增')
})

test('草稿：缺行拒绝（必须完整账号集合）', async () => {
  const { revision } = (await api('/api/auth/mode')).body
  const missing = await api('/api/sso-setup/draft', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json },
    body: JSON.stringify({
      revision,
      rows: [{ local_user_id: adminUserId, sso_user_id: 101, selection_source: 'manual' }],
    }),
  })
  assert.equal(missing.status, 409)
  assert.equal(missing.body.detail.code, 'MAPPING_CONFLICT')
})

test('手机号推荐：本项目无手机号字段 → 全部 invalid、可手选', async () => {
  const { revision } = (await api('/api/auth/mode')).body
  const result = await api('/api/sso-setup/match-phone', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json },
    body: JSON.stringify({ revision }),
  })
  assert.equal(result.status, 200)
  assert.equal(result.body.available, true)
  assert.ok(result.body.suggestions.every((item) => item.status === 'invalid' || item.status === 'no_match'))
})

async function submitMapping(rows, allowUnmapped, revision) {
  return api('/api/sso-setup/mapping', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json },
    body: JSON.stringify({ revision, rows, allow_unmapped: allowUnmapped }),
  })
}

test('映射：缺行 / 重复 / 无管理员 / 未确认留空 均被拒绝', async () => {
  const { revision } = (await api('/api/auth/mode')).body
  const confirmed = (rows) => rows.map((row) => ({ ...row, confirmed: true }))
  const missing = await submitMapping(confirmed([
    { local_user_id: adminUserId, sso_user_id: 101, selection_source: 'manual' },
  ]), true, revision)
  assert.equal(missing.status, 409)
  assert.equal(missing.body.detail.code, 'MAPPING_CONFLICT')

  const duplicated = await submitMapping(confirmed([
    { local_user_id: adminUserId, sso_user_id: 102, selection_source: 'manual' },
    { local_user_id: staffUserId, sso_user_id: 102, selection_source: 'manual' },
    { local_user_id: uploaderUserId, sso_user_id: null, selection_source: 'manual' },
  ]), true, revision)
  assert.equal(duplicated.status, 409)
  assert.equal(duplicated.body.detail.code, 'MAPPING_CONFLICT')

  const noAdmin = await submitMapping(confirmed([
    { local_user_id: adminUserId, sso_user_id: null, selection_source: 'manual' },
    { local_user_id: staffUserId, sso_user_id: 102, selection_source: 'manual' },
    { local_user_id: uploaderUserId, sso_user_id: null, selection_source: 'manual' },
  ]), true, revision)
  assert.equal(noAdmin.status, 409)
  assert.equal(noAdmin.body.detail.code, 'ADMIN_MAPPING_REQUIRED')

  const unconfirmedBlank = await submitMapping(confirmed([
    { local_user_id: adminUserId, sso_user_id: 101, selection_source: 'manual' },
    { local_user_id: staffUserId, sso_user_id: 102, selection_source: 'manual' },
    { local_user_id: uploaderUserId, sso_user_id: null, selection_source: 'manual' },
  ]), false, revision)
  assert.equal(unconfirmedBlank.status, 409)
  assert.equal(unconfirmedBlank.body.detail.code, 'UNMAPPED_CONFIRMATION_REQUIRED')
})

test('映射：confirmed!=true 拒绝（仅整批按钮构造）', async () => {
  const { revision } = (await api('/api/auth/mode')).body
  const unconfirmed = await api('/api/sso-setup/mapping', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json },
    body: JSON.stringify({
      revision,
      allow_unmapped: true,
      rows: [
        { local_user_id: adminUserId, sso_user_id: 101, selection_source: 'manual' },
      ],
    }),
  })
  assert.equal(unconfirmed.status, 422)
})

test('映射：完整整批（含显式留空 + allow_unmapped）→ 待负责人完成', async () => {
  const { revision } = (await api('/api/auth/mode')).body
  const result = await submitMapping([
    { local_user_id: adminUserId, sso_user_id: 101, selection_source: 'manual', confirmed: true },
    { local_user_id: staffUserId, sso_user_id: 102, selection_source: 'manual', confirmed: true },
    { local_user_id: uploaderUserId, sso_user_id: null, selection_source: 'manual', confirmed: true },
  ], true, revision)
  assert.equal(result.status, 200, JSON.stringify(result.body))
  assert.equal(result.body.phase, 'ADMIN_VERIFICATION_REQUIRED')
  assert.equal(result.body.rollback_available, true)
  const users = result.body.users
  assert.equal(users.find((u) => u.local_user_id === adminUserId).sso_user_id, 101)
  assert.equal(users.find((u) => u.local_user_id === uploaderUserId).sso_user_id, null, '留空账号保留且不清除')
})

test('待完成阶段：用户/角色入口冻结；旧登录仍可用', async () => {
  const { cookie } = await loginLegacy('赵于淋', 'admin123')
  assert.ok(cookie)
  const frozen = await api('/api/auth/register', {
    method: 'POST',
    headers: { Cookie: cookie, ...json, Origin: BASE },
    body: JSON.stringify({ name: '新人甲', department: '视觉部', password: '12345678', role: 'UPLOADER' }),
  })
  assert.equal(frozen.status, 409)
  assert.equal(frozen.body.detail.code, 'IDENTITY_FROZEN')
  const patched = await api('/api/users', {
    method: 'PATCH',
    headers: { Cookie: cookie, ...json, Origin: BASE },
    body: JSON.stringify({ id: uploaderUserId, role: 'REVIEWER' }),
  })
  assert.equal(patched.status, 409)
  assert.equal(patched.body.detail.code, 'IDENTITY_FROZEN')
})

test('撤销：回到 MAPPING_REQUIRED，映射恢复为空', async () => {
  const { revision } = (await api('/api/auth/mode')).body
  const rollback = await api('/api/sso-setup/rollback', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json },
    body: JSON.stringify({ revision }),
  })
  assert.equal(rollback.status, 200, JSON.stringify(rollback.body))
  assert.equal(rollback.body.phase, 'MAPPING_REQUIRED')
  assert.equal(rollback.body.users.find((u) => u.local_user_id === adminUserId).sso_user_id, null)
})

test('重新整批映射并完成切换（含错误版本拒绝）', async () => {
  let revision = (await api('/api/auth/mode')).body.revision
  const mapped = await submitMapping([
    { local_user_id: adminUserId, sso_user_id: 101, selection_source: 'manual', confirmed: true },
    { local_user_id: staffUserId, sso_user_id: 102, selection_source: 'manual', confirmed: true },
    { local_user_id: uploaderUserId, sso_user_id: null, selection_source: 'manual', confirmed: true },
  ], true, revision)
  assert.equal(mapped.status, 200)
  revision = mapped.body.revision
  assert.equal(mapped.body.phase, 'ADMIN_VERIFICATION_REQUIRED')

  const wrongRevision = await api('/api/sso-setup/complete', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json, Origin: BASE },
    body: JSON.stringify({ revision: revision + 5 }),
  })
  assert.equal(wrongRevision.status, 409)

  const complete = await api('/api/sso-setup/complete', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json, Origin: BASE },
    body: JSON.stringify({ revision }),
  })
  assert.equal(complete.status, 200, JSON.stringify(complete.body))
  assert.equal(complete.body.phase, 'SSO_ONLY')
  assert.equal(complete.body.jit_enabled, true)
})

test('SSO_ONLY：旧登录被后端拒绝；注册入口关闭', async () => {
  const login = await loginLegacy('赵于淋', 'admin123')
  assert.ok(!login.cookie, 'SSO_ONLY 下不应再颁发旧会话')
  const register = await api('/api/auth/register', {
    method: 'POST',
    headers: { ...bearer(ADMIN_TOKEN), ...json, Origin: BASE },
    body: JSON.stringify({ name: '新人乙', department: '视觉部', password: '12345678', role: 'UPLOADER' }),
  })
  assert.equal(register.status, 409, JSON.stringify(register.body))
  assert.equal(register.body.detail.code, 'STATE_CONFLICT')
})

test('SSO_ONLY：已映射管理员 Bearer 可用；未映射新人 JIT 为待授权', async () => {
  const wizard = await api('/api/sso-setup/context', { headers: bearer(OWNER_TOKEN) })
  assert.equal(wizard.status, 409, '已完成后再进向导应提示完成')
  const me = await api('/api/auth/me', { headers: bearer(ADMIN_TOKEN) })
  assert.equal(me.status, 200)
  assert.equal(me.body.auth_method, 'sso')
  assert.equal(me.body.is_admin, true)
  const stats = await api('/api/stats', { headers: bearer(ADMIN_TOKEN) })
  assert.equal(stats.status, 200)
  const newbie = await api('/api/auth/me', { headers: bearer(NEWBIE_TOKEN) })
  assert.equal(newbie.status, 200)
  assert.equal(newbie.body.is_pending, true)
  const newbieStats = await api('/api/stats', { headers: bearer(NEWBIE_TOKEN) })
  assert.equal(newbieStats.status, 403)
  assert.equal(newbieStats.body.detail.code, 'LOCAL_PERMISSION_PENDING')
})

test('角色分配：管理员分配后立即生效；最后管理员保护', async () => {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ datasources: { db: { url: testDbUrl } } })
  const newbieRow = await prisma.user.findFirst({ where: { role: 'PENDING' } })
  await prisma.$disconnect()
  assert.ok(newbieRow, 'JIT 应已建号')

  // 管理员 Bearer（映射 101 的公司号）分配角色
  const assign = await api('/api/users', {
    method: 'PATCH',
    headers: { ...bearer(ADMIN_TOKEN), ...json, Origin: BASE },
    body: JSON.stringify({ id: newbieRow.id, role: 'UPLOADER' }),
  })
  assert.equal(assign.status, 200, JSON.stringify(assign.body))
  const stats = await api('/api/stats', { headers: bearer(NEWBIE_TOKEN) })
  assert.equal(stats.status, 200, '分配后下一次请求即生效')

  // 最后管理员保护：赵于淋是唯一已关联管理员，降级应被拒绝
  const demote = await api('/api/users', {
    method: 'PATCH',
    headers: { ...bearer(ADMIN_TOKEN), ...json, Origin: BASE },
    body: JSON.stringify({ id: adminUserId, role: 'UPLOADER' }),
  })
  assert.equal(demote.status, 409)
  assert.equal(demote.body.detail.code, 'LAST_ADMIN_REQUIRED')
})

test('统一退出：中心收到 app_id+scope=all；本浏览器 Cookie 被清', async () => {
  logoutCalls.length = 0
  const logout = await api('/api/auth/logout', {
    method: 'POST',
    headers: { ...bearer(NEWBIE_TOKEN), Origin: BASE, Cookie: `next-auth.session-token=old-instance; ${COOKIE_PREFIX}.session-token.0=own-chunk` },
    body: '{}',
  })
  assert.equal(logout.status, 200)
  assert.equal(logout.body.message, '已退出')
  assert.equal(logoutCalls.length, 1)
  assert.deepEqual(logoutCalls[0], { app_id: APP_ID, scope: 'all' })
  const setCookies = logout.headers.getSetCookie?.() ?? []
  assert.ok(setCookies.some(part => part.startsWith(`${COOKIE_PREFIX}.session-token=;`)), '应清除本实例会话 Cookie')
  assert.ok(setCookies.some(part => part.startsWith(`${COOKIE_PREFIX}.session-token.0=;`)), '清理本实例分片')
  assert.ok(setCookies.every(part => part.startsWith(`${COOKIE_PREFIX}.`)), '退出不能清理旧版 Cookie')
})

test('维护者恢复工具：runtime 恢复到待负责人完成并可再次完成', async () => {
  const preview = JSON.parse(execFileSync('node', ['scripts/sso-recovery.mjs', '--kind', 'runtime'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso` },
  }).toString())
  assert.equal(preview.can_recover, true, JSON.stringify(preview))
  const applied = JSON.parse(execFileSync('node', [
    'scripts/sso-recovery.mjs', '--kind', 'runtime', '--apply', '--revision', String(preview.revision),
  ], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso` },
  }).toString())
  assert.equal(applied.applied, true)
  assert.equal(applied.phase, 'ADMIN_VERIFICATION_REQUIRED')
  const mode = (await api('/api/auth/mode')).body
  assert.equal(mode.phase, 'ADMIN_VERIFICATION_REQUIRED')
  assert.equal(mode.legacy_login_enabled, true)

  // 负责人重新完成
  const complete = await api('/api/sso-setup/complete', {
    method: 'POST',
    headers: { ...bearer(OWNER_TOKEN), ...json, Origin: BASE },
    body: JSON.stringify({ revision: mode.revision }),
  })
  assert.equal(complete.status, 200, JSON.stringify(complete.body))
  assert.equal(complete.body.phase, 'SSO_ONLY')
})

test('维护者恢复工具：lock 进入维护锁，API 503，resume 解锁', async () => {
  const preview = JSON.parse(execFileSync('node', ['scripts/sso-recovery.mjs', '--kind', 'lock'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso` },
  }).toString())
  assert.equal(preview.can_recover, true)
  const applied = JSON.parse(execFileSync('node', [
    'scripts/sso-recovery.mjs', '--kind', 'lock', '--apply', '--revision', String(preview.revision),
  ], { cwd: ROOT, env: { ...process.env, DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso` } }).toString())
  assert.equal(applied.maintenance_locked, true)

  const blocked = await api('/api/stats', { headers: bearer(ADMIN_TOKEN) })
  assert.equal(blocked.status, 503)
  assert.equal(blocked.body.detail.code, 'MAINTENANCE_REQUIRED')

  // mapping 恢复会进入带锁的 MAPPING_REQUIRED；随后 resume 解锁
  const mappingPreview = JSON.parse(execFileSync('node', ['scripts/sso-recovery.mjs', '--kind', 'mapping'], {
    cwd: ROOT, env: { ...process.env, DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso` },
  }).toString())
  assert.equal(mappingPreview.can_recover, true, JSON.stringify(mappingPreview))
  const mappingApplied = JSON.parse(execFileSync('node', [
    'scripts/sso-recovery.mjs', '--kind', 'mapping', '--apply', '--revision', String(mappingPreview.revision),
  ], { cwd: ROOT, env: { ...process.env, DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso` } }).toString())
  assert.equal(mappingApplied.phase, 'MAPPING_REQUIRED')
  assert.equal(mappingApplied.maintenance_locked, true)
  assert.ok(mappingApplied.restore_local_ids.includes(adminUserId), '应定向还原管理员映射')

  const resumed = JSON.parse(execFileSync('node', [
    'scripts/sso-recovery.mjs', '--kind', 'resume', '--apply', '--revision', String(mappingApplied.revision), '--reviewed',
  ], { cwd: ROOT, env: { ...process.env, DATABASE_URL: testDbUrl, JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso` } }).toString())
  assert.equal(resumed.maintenance_locked, false)

  const mode = (await api('/api/auth/mode')).body
  assert.equal(mode.phase, 'MAPPING_REQUIRED')
  assert.equal(mode.maintenance_locked, false)
  // 恢复 mapping 后原登录应再次可用
  const { cookie } = await loginLegacy('赵于淋', 'admin123')
  assert.ok(cookie, '定向恢复后原认证可用')
})
