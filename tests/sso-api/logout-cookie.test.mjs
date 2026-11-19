import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(file, boundaries) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => boundaries[name] ?? require(name), module, module.exports)
  return module.exports
}

test('HTTPS 退出保留 Secure/HttpOnly 属性，只清理本实例 Cookie 及分片', async () => {
  const previous = { AUTH_COOKIE_PREFIX: process.env.AUTH_COOKIE_PREFIX, NEXTAUTH_URL: process.env.NEXTAUTH_URL }
  process.env.AUTH_COOKIE_PREFIX = 'ai-review-sso90-test'
  process.env.NEXTAUTH_URL = 'https://preview.example'
  try {
    const cookies = load('../../src/lib/auth-cookies.ts', {})
    const { POST } = load('../../src/app/api/auth/logout/route.ts', {
      '@/lib/auth-cookies': cookies,
      '@/lib/sso/identity': { sameOrigin: () => {}, getActor: async () => ({}) },
      '@/lib/sso/errors': { handleApiError: error => { throw error } },
    })
    const { NextRequest } = require('next/server')
    const request = new NextRequest('https://preview.example/api/auth/logout', { method: 'POST', headers: {
      cookie: 'next-auth.session-token=old; __Secure-ai-review-sso90-test.session-token.0=chunk',
    } })
    const response = await POST(request)
    const cleared = response.headers.getSetCookie()
    assert.equal(response.status, 200)
    assert.ok(cleared.some(value => value.startsWith('__Host-ai-review-sso90-test.csrf-token=')))
    assert.ok(cleared.some(value => value.startsWith('__Secure-ai-review-sso90-test.session-token.0=')))
    assert.ok(cleared.every(value => !value.includes('next-auth')))
    assert.ok(cleared.every(value => /; Secure/i.test(value) && /; HttpOnly/i.test(value) && /Max-Age=0/i.test(value)))
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  }
})
