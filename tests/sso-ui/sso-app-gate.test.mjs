import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import React, { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const mode = {
  phase: 'SSO_ONLY', classification: 'LEGACY', revision: 1,
  app_id: 'APP_TEST', environment: 'test',
  legacy_login_enabled: false, jit_enabled: true, maintenance_locked: false,
  sso_web_url: 'http://127.0.0.1:18050', sso_api_url: 'http://127.0.0.1:18050/sso',
}
const user = { local_user_id: 'original-admin', name: '原管理员', department: '合成测试', roles: ['ADMIN'], is_pending: false }
const errors = [
  [409, 'IDENTITY_MIGRATION_REQUIRED', '原账号身份迁移尚未完成，请联系维护者处理。'],
  [403, 'SSO_FORBIDDEN', '当前账号没有此应用的访问权限。'],
  [502, 'REQUEST_FAILED', '请求未完成，请稍后重试'],
]
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const failure = ([status, code, message]) => status === 502
  ? new Response('<html>upstream unavailable</html>', { status, headers: { 'Content-Type': 'text/html' } })
  : json({ detail: { code, message } }, status)

// Execute the real TSX components and their frontend modules, without a Next build.
// Only framework session/navigation and the unrelated application shell are replaced.
function sourceLoader(boundaries) {
  const cache = new Map()
  function load(filename) {
    filename = [filename, `${filename}.ts`, `${filename}.tsx`].find((candidate) => existsSync(candidate))
    assert.ok(filename, 'source module must exist')
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const localRequire = (id) => {
      if (Object.hasOwn(boundaries, id)) return boundaries[id]
      if (id.startsWith('@/')) return load(join(ROOT, 'src', id.slice(2)))
      if (id.startsWith('.')) return load(resolve(dirname(filename), id))
      return require(id)
    }
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText
    new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports)
    return module.exports
  }
  return load
}

async function mountGate(initialReply, options = {}) {
  const activeMode = { ...mode, ...options.mode }
  const dom = new JSDOM('<div id="root"></div>', { url: `http://127.0.0.1:18001${options.path || '/dashboard'}`, pretendToBeVisual: true })
  const saved = new Map()
  function global(name, value) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  global('window', dom.window)
  global('document', dom.window.document)
  global('navigator', dom.window.navigator)
  global('IS_REACT_ACT_ENVIRONMENT', true)
  let meReply = initialReply
  let meRequests = 0
  let businessMounts = 0
  let unauthorized = 0
  const requests = []
  global('fetch', async (input) => {
    const url = new URL(String(input), dom.window.location.origin)
    requests.push(url.pathname)
    if (url.origin !== dom.window.location.origin) throw new Error('Tests must not contact any SSO server')
    if (url.pathname === '/api/auth/mode') return json(activeMode)
    if (url.pathname === '/api/auth/me') { meRequests += 1; return meReply() }
    throw new Error(`Unexpected endpoint: ${url.pathname}`)
  })
  dom.window.JxSsoGuard = {
    JX_SSO_GUARD_VERSION: '2.2.0',
    readTokenCallback: () => ({ token: '' }),
    guardApplicationAccess: async () => ({ status: 'allowed' }),
    onUnauthorized: () => { unauthorized += 1 },
  }
  const load = sourceLoader({
    'next-auth/react': { useSession: () => ({ data: null, status: 'unauthenticated' }) },
    'next/navigation': { useRouter: () => ({ push: () => assert.fail('SSO error must not fall back to local login') }) },
    '@/components/AppLayout': { __esModule: true, default: ({ children }) => React.createElement('main', { 'data-app-shell': true }, children) },
  })
  const { getSsoStorageKey } = load(join(ROOT, 'src/lib/sso/frontend/storage-keys.ts'))
  dom.window.localStorage.setItem(getSsoStorageKey(activeMode.app_id, activeMode.sso_api_url), 'synthetic-session')
  const { default: SsoAppGate, useSsoApp } = load(join(ROOT, 'src/components/sso/SsoAppGate.tsx'))
  const { default: AuthLayout } = load(join(ROOT, 'src/components/AuthLayout.tsx'))
  function BusinessPage() {
    const { user, refreshUser } = useSsoApp()
    useEffect(() => { businessMounts += 1 }, [])
    return React.createElement('section', { 'data-business': true },
      `${user?.name || '未校验用户'} ${user?.role || '未知权限'} 私有历史项目`,
      React.createElement('button', { onClick: () => void refreshUser() }, '刷新账号状态'))
  }
  function WizardPage() {
    const { phase, user } = useSsoApp()
    return React.createElement('section', { 'data-wizard': true }, `账号关联向导 ${phase} ${user ? '已有本地账号' : '未关联负责人'}`)
  }
  const child = options.child === 'wizard'
    ? React.createElement(WizardPage)
    : options.child === 'raw-business'
      ? React.createElement(BusinessPage)
      : React.createElement(AuthLayout, null, React.createElement(BusinessPage))
  const container = dom.window.document.getElementById('root')
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(SsoAppGate, null, child))
  })
  async function settle(predicate) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
      if (predicate()) return
    }
    assert.fail(`Expected UI state was not reached; actual text: ${container.textContent}`)
  }
  async function close() {
    await act(async () => root.unmount())
    dom.window.close()
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
  }
  try { await settle(() => meRequests > 0 || container.querySelector('[data-wizard]')) }
  catch (error) { await close(); throw error }
  return {
    container, requests, settle,
    get meRequests() { return meRequests },
    get businessMounts() { return businessMounts },
    get unauthorized() { return unauthorized },
    setReply(reply) { meReply = reply },
    async click(label) {
      const button = [...container.querySelectorAll('button')].find((node) => node.textContent === label)
      assert.ok(button, `Expected visible ${label} action; actual text: ${container.textContent}`)
      await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    },
    close,
  }
}

test('real SsoAppGate and AuthLayout mount business content after a successful current-user response', async () => {
  const page = await mountGate(() => json(user))
  try {
    await page.settle(() => page.businessMounts === 1)
    assert.match(page.container.textContent, /原管理员 ADMIN 私有历史项目/)
    assert.equal(page.unauthorized, 0)
  } finally { await page.close() }
})

test('全局超管显示有效管理权限，刷新撤权后恢复原角色', async () => {
  const page = await mountGate(() => json({ ...user, roles: ['UPLOADER'], is_admin: true, is_global_super_admin: true }))
  try {
    await page.settle(() => page.businessMounts === 1)
    assert.match(page.container.textContent, /原管理员 ADMIN 私有历史项目/)
    page.setReply(() => json({ ...user, roles: ['UPLOADER'], is_admin: false, is_global_super_admin: false }))
    await page.click('刷新账号状态')
    await page.settle(() => page.container.textContent.includes('UPLOADER'))
  } finally { await page.close() }
})

for (const scenario of errors) {
  test(`/api/auth/me ${scenario[0]} shows its error and retry action without mounting private business UI`, async () => {
    const page = await mountGate(() => failure(scenario))
    try {
      assert.equal(page.businessMounts, 0)
      assert.equal(page.container.querySelector('[data-business]'), null)
      assert.ok(page.container.textContent.includes(scenario[2]), `Expected error text; actual UI: ${page.container.innerHTML}`)
      assert.ok([...page.container.querySelectorAll('button')].some((node) => node.textContent === '重试'))
      assert.equal(page.container.querySelector('.animate-spin'), null)
      assert.equal(page.unauthorized, 0, 'Non-401 failures must not redirect back to SSO')
    } finally { await page.close() }
  })
}

test('after identity backfill succeeds, clicking retry enters the original account without a page reload', async () => {
  const page = await mountGate(() => failure(errors[0]))
  try {
    assert.equal(page.businessMounts, 0)
    page.setReply(() => json(user))
    await page.click('重试')
    await page.settle(() => page.businessMounts === 1)
    assert.match(page.container.textContent, /原管理员 ADMIN 私有历史项目/)
    assert.equal(page.container.querySelector('.animate-spin'), null)
    assert.equal(page.meRequests, 2)
  } finally { await page.close() }
})

test('a later current-user rejection removes already displayed business content instead of retaining a stale account', async () => {
  const page = await mountGate(() => json(user))
  try {
    await page.settle(() => page.businessMounts === 1)
    page.setReply(() => failure(errors[1]))
    await page.click('刷新账号状态')
    await page.settle(() => page.meRequests === 2)
    assert.equal(page.container.querySelector('[data-business]'), null, 'Rejected identity must conceal private business content')
    assert.ok(page.container.textContent.includes(errors[1][2]))
    assert.ok([...page.container.querySelectorAll('button')].some((node) => node.textContent === '重试'))
  } finally { await page.close() }
})

for (const phase of ['MAPPING_REQUIRED', 'ADMIN_VERIFICATION_REQUIRED']) {
  test(`an unmapped owner can enter /sso-setup during ${phase} without local identity or business requests`, async () => {
    const page = await mountGate(() => failure(errors[0]), {
      path: '/sso-setup', child: 'wizard',
      mode: { phase, legacy_login_enabled: true, jit_enabled: false },
    })
    try {
      assert.match(page.container.textContent, /账号关联向导 sso 未关联负责人/)
      assert.equal(page.container.querySelector('.animate-spin'), null)
      assert.equal(page.meRequests, 0)
      assert.equal(page.businessMounts, 0)
      assert.deepEqual(page.requests, ['/api/auth/mode'])
    } finally { await page.close() }
  })
}

test('/sso-setup after SSO_ONLY still requires a valid local identity', async () => {
  const page = await mountGate(() => failure(errors[0]), { path: '/sso-setup', child: 'wizard' })
  try {
    assert.equal(page.meRequests, 1)
    assert.equal(page.container.querySelector('[data-wizard]'), null)
    assert.ok(page.container.textContent.includes(errors[0][2]))
  } finally { await page.close() }
})

test('a direct business child is not mounted while local identity validation is pending', async () => {
  let resolveMe
  const reply = new Promise((resolve) => { resolveMe = resolve })
  const page = await mountGate(() => reply, { child: 'raw-business' })
  try {
    assert.equal(page.meRequests, 1)
    assert.equal(page.businessMounts, 0, 'The gate itself must withhold children, independently of AuthLayout')
    assert.equal(page.container.querySelector('[data-business]'), null)
    await act(async () => { resolveMe(json(user)) })
    await page.settle(() => page.businessMounts === 1)
    assert.match(page.container.textContent, /原管理员 ADMIN 私有历史项目/)
  } finally {
    await act(async () => { resolveMe(json(user)) })
    await page.close()
  }
})

test('a network failure ends the spinner and offers retry without revealing direct business children', async () => {
  const page = await mountGate(() => { throw new TypeError('Failed to fetch') }, { child: 'raw-business' })
  try {
    assert.equal(page.businessMounts, 0)
    assert.equal(page.container.querySelector('[data-business]'), null)
    assert.equal(page.container.querySelector('.animate-spin'), null)
    assert.ok([...page.container.querySelectorAll('button')].some((node) => node.textContent === '重试'))
    assert.equal(page.unauthorized, 0)
  } finally { await page.close() }
})

test('a 401 current-user failure is still delegated to the official SSO guard without local login fallback', async () => {
  const page = await mountGate(() => json({ detail: { code: 'SSO_UNAUTHORIZED', message: '登录已失效' } }, 401), { child: 'raw-business' })
  try {
    assert.equal(page.unauthorized, 1)
    assert.equal(page.businessMounts, 0)
    assert.equal(page.container.querySelector('[data-business]'), null)
    assert.deepEqual(page.requests, ['/api/auth/mode', '/api/auth/me'])
  } finally { await page.close() }
})
