/**
 * GREENFIELD 空项目路径：持久分类为 GREENFIELD，初始即 SSO_ONLY；
 * 负责人首次进入按配置初始化管理权，普通新人待授权。
 */
import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const temp = mkdtempSync(join(tmpdir(), 'ai-image-green-test-'))
const testDb = join(temp, 'test.db')
writeFileSync(testDb, '')
const testDbUrl = `file:${testDb}`
const APP_PORT = 4341
const MOCK_PORT = 4342
const BASE = `http://127.0.0.1:${APP_PORT}`
const APP_ID = 'APP_CABB266C38BF45B46952154A'

const tokens = {
  'owner-token': { user_id: 1, username: 'owner-center', name: '应用负责人' },
  'new-owner-token': { user_id: 2, username: 'new-owner', name: '新负责人' },
  'staff-token': { user_id: 302, username: 'staff', name: '普通人员' },
}
const roster = [
  { user_id: 1, username: 'owner-center', name: '应用负责人', status: 1, access_source: 'ROLE', ding_corp_id: null, ding_user_id: null },
  { user_id: 302, username: 'staff', name: '普通人员', status: 1, access_source: 'ROLE', ding_corp_id: null, ding_user_id: null },
]

let mockServer
let appProcess

function startMock() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/, '')
    const identity = tokens[bearer]
    if (url.pathname === '/sso/auth/verify') {
      if (!identity) return reply(200, { code: 401 })
      return reply(200, { code: 0, msg: 'ok', data: { identity_contract: 'dingtalk-v1', ding_corp_id: null, ding_user_id: null, is_application_owner: [1, 2].includes(identity.user_id), app_id: APP_ID, application_allowed: true, ...identity } })
    }
    if (url.pathname === '/sso/app/users') {
      return reply(200, { code: 0, msg: 'ok', data: { identity_contract: 'dingtalk-v1', records: roster, page_no: 1, page_size: 100, total_page: 1, total_count: roster.length } })
    }
    if (url.pathname === '/sso/auth/logout') return reply(200, { code: 0, msg: 'ok', data: {} })
    reply(404, {})
  })
  return new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)))
}

async function api(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { ...options, cache: 'no-store' })
  const body = await response.json().catch(() => null)
  return { status: response.status, body }
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` })

before(async () => {
  // 空库（不 seed 任何用户）
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate'], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: 'ignore',
  })
  mockServer = await startMock()
  appProcess = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: testDbUrl,
      NEXTAUTH_URL: BASE,
      NEXTAUTH_SECRET: 'greenfield-secret',
      JX_SSO_WEB_URL: `http://127.0.0.1:${MOCK_PORT}`,
      JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso`,
      JX_SSO_APP_ID: APP_ID,
      JX_SSO_OWNER_USER_ID: '1',
      JX_SSO_ENVIRONMENT: 'test',
      JX_SSO_ONBOARDING_MODE: 'guided',
    },
  })
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/auth/mode`)).ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('应用启动超时')
})

after(async () => {
  if (appProcess?.pid) {
    try {
      process.kill(-appProcess.pid, 'SIGKILL')
    } catch {}
  }
  await new Promise((resolve) => (mockServer ? mockServer.close(resolve) : resolve()))
  rmSync(temp, { recursive: true, force: true })
})

test('空项目：GREENFIELD + 初始 SSO_ONLY，JIT 直接启用', async () => {
  const mode = await api('/api/auth/mode')
  assert.equal(mode.status, 200)
  assert.equal(mode.body.classification, 'GREENFIELD')
  assert.equal(mode.body.phase, 'SSO_ONLY')
  assert.equal(mode.body.jit_enabled, true)
  assert.equal(mode.body.legacy_login_enabled, false)
})

test('GREENFIELD：负责人首次进入初始化管理权', async () => {
  const me = await api('/api/auth/me', { headers: bearer('owner-token') })
  assert.equal(me.status, 200)
  assert.equal(me.body.is_admin, true, 'GREENFIELD 负责人按配置初始化 ADMIN')
  const stats = await api('/api/stats', { headers: bearer('owner-token') })
  assert.equal(stats.status, 200)
})

test('GREENFIELD：普通新人 JIT 为待授权', async () => {
  const me = await api('/api/auth/me', { headers: bearer('staff-token') })
  assert.equal(me.status, 200)
  assert.equal(me.body.is_pending, true)
  const stats = await api('/api/stats', { headers: bearer('staff-token') })
  assert.equal(stats.status, 403)
  assert.equal(stats.body.detail.code, 'LOCAL_PERMISSION_PENDING')
})

test('空项目分类持久化：重启后不随账号数量重判', async () => {
  if (appProcess?.pid) {
    try {
      process.kill(-appProcess.pid, 'SIGKILL')
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 800))
  appProcess = spawn('npx', ['next', 'start', '-p', String(APP_PORT)], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: testDbUrl,
      NEXTAUTH_URL: BASE,
      NEXTAUTH_SECRET: 'greenfield-secret',
      JX_SSO_WEB_URL: `http://127.0.0.1:${MOCK_PORT}`,
      JX_SSO_API_URL: `http://127.0.0.1:${MOCK_PORT}/sso`,
      JX_SSO_APP_ID: APP_ID,
      JX_SSO_OWNER_USER_ID: '1',
      JX_SSO_ENVIRONMENT: 'test',
      JX_SSO_ONBOARDING_MODE: 'guided',
    },
  })
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/auth/mode`)).ok) break
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const mode = await api('/api/auth/mode')
  assert.equal(mode.body.classification, 'GREENFIELD')
  assert.equal(mode.body.phase, 'SSO_ONLY')
  const me = await api('/api/auth/me', { headers: bearer('staff-token') })
  assert.equal(me.status, 200, '重启后既有 JIT 账号仍可识别')
})


test('GREENFIELD：转交负责人后未登录新人仍待授权，不重复初始化管理员', async () => {
  const me = await api('/api/auth/me', { headers: bearer('new-owner-token') })
  assert.equal(me.status, 200)
  assert.equal(me.body.is_admin, false)
  assert.equal(me.body.is_pending, true)
})
