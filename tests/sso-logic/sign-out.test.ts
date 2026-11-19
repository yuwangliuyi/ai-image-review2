import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ssoStorageKeys } from '../../src/lib/sso/frontend/storage-keys'
import { createSignOut, SignedOutError } from '../../src/lib/sso/frontend/sign-out'
import { prepareStartup, assertMode } from '../../src/lib/sso/frontend/startup'
import type { SsoMode } from '../../src/lib/sso/frontend/types'

function fakeBrowser() {
  const storage = new Map<string, string>()
  const listeners: Record<string, ((event: unknown) => void)[]> = { storage: [], pageshow: [] }
  const browser = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
    addEventListener: (name: string, handler: (event: unknown) => void) => listeners[name].push(handler),
    removeEventListener: (name: string, handler: (event: unknown) => void) => {
      listeners[name] = listeners[name].filter((item) => item !== handler)
    },
    location: { replace: (path: string) => storage.set('__navigated', path) },
    fire: (name: string, event: unknown) => listeners[name].forEach((handler) => handler(event)),
  }
  return { browser, storage, listeners }
}

function mode(overrides: Partial<SsoMode> = {}): SsoMode {
  return {
    classification: 'LEGACY',
    phase: 'MAPPING_REQUIRED',
    revision: 0,
    legacy_login_enabled: true,
    jit_enabled: false,
    maintenance_locked: false,
    app_id: 'APP_TEST',
    sso_web_url: 'http://sso.example.invalid',
    sso_api_url: 'http://sso.example.invalid/sso',
    environment: 'test',
    ...overrides,
  }
}

function fakeGuard(result: { status: 'allowed' | 'redirecting' | 'forbidden' }) {
  const calls: unknown[] = []
  return {
    calls,
    JX_SSO_GUARD_VERSION: '2.1.0',
    readTokenCallback: () => ({ token: '', redirect: '' }),
    guardApplicationAccess: async (options: unknown) => {
      calls.push(options)
      return result
    },
    onUnauthorized: () => true,
  } as any
}

test('sign-out：标记期间请求被拒绝，迟到恢复不能清除标记', () => {
  const { browser } = fakeBrowser()
  const signOut = createSignOut('APP_TEST', browser as any, 'http://sso.example.invalid/sso')
  signOut.complete('http://sso.example.invalid')
  assert.equal(browser.localStorage.getItem(ssoStorageKeys('APP_TEST', 'http://sso.example.invalid/sso').signedOut), '1')
  assert.throws(() => signOut.assertActive(), SignedOutError)
  // complete 已清除本地 Token：即使回跳字符串带着旧 Token，恢复函数也必须拒绝
  const resume = signOut.prepareReentry('token-a')
  assert.ok(resume)
  assert.equal(resume(), false)
  assert.equal(browser.localStorage.getItem(ssoStorageKeys('APP_TEST', 'http://sso.example.invalid/sso').signedOut), '1')
})

test('sign-out：回跳携带新 Token 时允许恢复，且 Token 变化即失效', () => {
  const { browser } = fakeBrowser()
  const signOut = createSignOut('APP_TEST', browser as any, 'http://sso.example.invalid/sso')
  signOut.complete('http://sso.example.invalid')
  // 模拟中心回跳写入新凭据
  browser.localStorage.setItem(ssoStorageKeys('APP_TEST', 'http://sso.example.invalid/sso').token, 'token-b')
  const resume = signOut.prepareReentry('token-b')
  assert.ok(resume)
  assert.equal(resume(), true)
  assert.equal(browser.localStorage.getItem(ssoStorageKeys('APP_TEST', 'http://sso.example.invalid/sso').signedOut), null)
})

test('sign-out：storage/pageshow 事件触发清理并跳转停留页', () => {
  const { browser, storage } = fakeBrowser()
  const signOut = createSignOut('APP_TEST', browser as any, 'http://sso.example.invalid/sso')
  let cleared = false
  signOut.listen(() => {
    cleared = true
  })
  browser.localStorage.setItem(ssoStorageKeys('APP_TEST', 'http://sso.example.invalid/sso').signedOut, '1')
  browser.fire('pageshow', {})
  assert.ok(cleared)
  assert.equal(storage.get('__navigated'), '/signed-out')
})

test('startup：assertMode 拒绝不一致与非法响应', () => {
  const bad = mode({ phase: 'SSO_ONLY', legacy_login_enabled: true, jit_enabled: false })
  assert.throws(() => assertMode(bad), /无效/)
  assert.throws(() => assertMode({ ...mode(), app_id: 'bad id' }), /无效/)
  assert.throws(() => assertMode({ ...mode(), revision: 'x' as unknown as number }), /无效/)
})

test('startup：准备阶段无 Token 的业务页走原登录', async () => {
  const guard = fakeGuard({ status: 'redirecting' })
  const startup = await prepareStartup(
    mode(),
    new URL('http://app.example.invalid/dashboard'),
    guard
  )
  assert.equal(startup, 'legacy')
  assert.equal(guard.calls.length, 0)
})

test('startup：SSO_ONLY 即使有退出标记也必须调用守卫', async () => {
  const { browser } = fakeBrowser()
  const signOut = createSignOut('APP_TEST', browser as any, 'http://sso.example.invalid/sso')
  signOut.complete(undefined as unknown as string) // 本地退出，标记生效
  const guard = fakeGuard({ status: 'redirecting' })
  const startup = await prepareStartup(
    mode({ phase: 'SSO_ONLY', legacy_login_enabled: false, jit_enabled: true }),
    new URL('http://app.example.invalid/dashboard'),
    guard,
    signOut
  )
  assert.equal(guard.calls.length, 1)
  assert.equal(startup, 'stopped')
})

test('startup：准备阶段退出标记拦截旧页面', async () => {
  const { browser } = fakeBrowser()
  const signOut = createSignOut('APP_TEST', browser as any, 'http://sso.example.invalid/sso')
  signOut.complete(undefined as unknown as string)
  const guard = fakeGuard({ status: 'allowed' })
  const startup = await prepareStartup(
    mode(),
    new URL('http://app.example.invalid/dashboard'),
    guard,
    signOut
  )
  assert.equal(startup, 'signed-out')
  assert.equal(guard.calls.length, 0)
})

test('startup：向导路径在准备阶段也进入守卫（回跳目标为向导）', async () => {
  const guard = fakeGuard({ status: 'allowed' })
  const startup = await prepareStartup(
    mode(),
    new URL('http://app.example.invalid/sso-setup'),
    guard
  )
  assert.equal(startup, 'setup-sso')
  assert.equal((guard.calls[0] as any).currentUrl, 'http://app.example.invalid/sso-setup?connect=1')
})

test('startup：SSO_ONLY 业务页守卫使用当前地址', async () => {
  const guard = fakeGuard({ status: 'allowed' })
  const startup = await prepareStartup(
    mode({ phase: 'SSO_ONLY', legacy_login_enabled: false, jit_enabled: true }),
    new URL('http://app.example.invalid/review?a=1'),
    guard
  )
  assert.equal(startup, 'sso')
  assert.equal((guard.calls[0] as any).currentUrl, 'http://app.example.invalid/review?a=1')
})


test('环境隔离：123 退出不能清除 90 凭据或使 90 退出', () => {
  const { browser } = fakeBrowser()
  const a = createSignOut('APP_TEST', browser as any, 'http://90.invalid/sso')
  const b = createSignOut('APP_TEST', browser as any, 'http://123.invalid/sso')
  const keyA = ssoStorageKeys('APP_TEST', 'http://90.invalid/sso')
  const keyB = ssoStorageKeys('APP_TEST', 'http://123.invalid/sso')
  browser.localStorage.setItem(keyA.token, 'token-a')
  browser.localStorage.setItem(keyB.token, 'token-b')
  b.complete()
  assert.equal(browser.localStorage.getItem(keyA.token), 'token-a')
  assert.equal(browser.localStorage.getItem(keyB.token), null)
  assert.equal(a.isBlocked(), false)
  assert.equal(b.isBlocked(), true)
})

test('实际应用与官方 guard 使用完全一致的存储键', () => {
  const guard = require('../../../public/jx-sso/jx-sso-guard.js')
  for (const api of ['http://SSO.example.invalid:80/sso///', 'https://sso.example.invalid/prefix/sso']) {
    assert.equal(ssoStorageKeys(' APP_TEST ', api).token, guard.getSsoStorageKey(' APP_TEST ', api))
  }
})
