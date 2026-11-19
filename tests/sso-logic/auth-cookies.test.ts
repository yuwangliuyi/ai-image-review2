import assert from 'node:assert/strict'
import test from 'node:test'
import { authCookies, ownedCookieNames } from '../../src/lib/auth-cookies'

test('同一主机的验证实例使用独立 Cookie，退出不清理旧版 Cookie', () => {
  const env = { AUTH_COOKIE_PREFIX: 'ai-review-sso90-preview', NEXTAUTH_URL: 'http://127.0.0.1:28001' }
  const cookies = authCookies(env)
  assert.equal(cookies.sessionToken.name, 'ai-review-sso90-preview.session-token')
  assert.equal(cookies.csrfToken.name, 'ai-review-sso90-preview.csrf-token')
  const names = ownedCookieNames(['next-auth.session-token', 'next-auth.csrf-token', 'ai-review-sso90-preview.session-token.0'], env)
  assert.ok(names.includes('ai-review-sso90-preview.session-token.0'))
  assert.ok(names.every(name => name.startsWith('ai-review-sso90-preview.')))
})

test('HTTPS Cookie 受限于当前主机，非法名称拒绝启动', () => {
  const cookies = authCookies({ AUTH_COOKIE_PREFIX: 'preview', NEXTAUTH_URL: 'https://review.example.test' })
  assert.equal(cookies.sessionToken.name, '__Secure-preview.session-token')
  assert.equal(cookies.csrfToken.name, '__Host-preview.csrf-token')
  assert.equal(cookies.sessionToken.options.httpOnly, true)
  assert.equal(cookies.sessionToken.options.secure, true)
  assert.equal(cookies.sessionToken.options.sameSite, 'lax')
  assert.equal('domain' in cookies.sessionToken.options, false)
  assert.throws(() => authCookies({ AUTH_COOKIE_PREFIX: 'bad;name' }))
})
