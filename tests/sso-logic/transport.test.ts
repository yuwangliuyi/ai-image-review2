import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createApi, ApiError } from '../../src/lib/sso/frontend/transport'

function makeApi(overloads: {
  requests: { url: string; init: RequestInit }[]
  respond: (url: string) => { status: number; body: unknown }
}) {
  return createApi({
    origin: 'http://app.example.invalid',
    fetcher: (async (input: any, init: any) => {
      overloads.requests.push({ url: String(input), init })
      const { status, body } = overloads.respond(String(input))
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as unknown as typeof fetch,
    getToken: () => 'token-x',
    assertActive: undefined,
  })
}

test('transport：拒绝跨源、协议相对地址与非 /api/ 目标（Token 白名单）', async () => {
  const api = makeApi({ requests: [], respond: () => ({ status: 200, body: {} }) })
  await assert.rejects(api('//evil.example.invalid/api/x', { identity: 'sso' }), /只允许同源/)
  await assert.rejects(api('http://evil.example.invalid/api/x', { identity: 'sso' }), /只允许同源/)
  await assert.rejects(api('/other/path', { identity: 'sso' }), /只允许同源/)
})

test('transport：SSO 身份附加 Bearer 且 omit 凭据；本地身份携带 Cookie', async () => {
  const overloads = {
    requests: [] as { url: string; init: RequestInit }[],
    respond: () => ({ status: 200, body: { ok: true } }),
  }
  const api = makeApi(overloads)
  await api('/api/stats', { identity: 'sso' })
  await api('/api/stats', { identity: 'local' })
  const [ssoCall, localCall] = overloads.requests
  assert.equal((ssoCall.init.headers as Headers).get('Authorization'), 'Bearer token-x')
  assert.equal(ssoCall.init.credentials, 'omit')
  assert.equal((localCall.init.headers as Headers).get('Authorization'), null)
  assert.equal(localCall.init.credentials, 'same-origin')
})

test('transport：SSO 缺 Token 时直接抛 SSO_UNAUTHORIZED，不发请求', async () => {
  const overloads = { requests: [] as { url: string; init: RequestInit }[], respond: () => ({ status: 200, body: {} }) }
  const api = createApi({
    origin: 'http://app.example.invalid',
    fetcher: (async (...args: unknown[]) => {
      overloads.requests.push({ url: String(args[0]), init: args[1] as RequestInit })
      return new Response('{}')
    }) as unknown as typeof fetch,
    getToken: () => null,
  })
  await assert.rejects(api('/api/stats', { identity: 'sso' }), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.code, 'SSO_UNAUTHORIZED')
    assert.equal(error.source, 'sso')
    return true
  })
  assert.equal(overloads.requests.length, 0)
})

test('transport：错误响应转换为 detail 结构，401 来源分类正确', async () => {
  const overloads = {
    requests: [] as { url: string; init: RequestInit }[],
    respond: (url: string) =>
      url.endsWith('/local')
        ? { status: 401, body: { detail: { code: 'LOCAL_SESSION_REQUIRED', message: '请先登录原应用' } } }
        : { status: 401, body: { detail: { code: 'SSO_UNAUTHORIZED', message: '请重新登录' } } },
  }
  const api = makeApi(overloads)
  await assert.rejects(api('/api/local', { identity: 'local' }), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.source, 'local')
    return true
  })
  await assert.rejects(api('/api/sso', { identity: 'sso' }), (error: unknown) => {
    assert.ok(error instanceof ApiError)
    assert.equal(error.source, 'sso')
    assert.equal(error.status, 401)
    return true
  })
})

test('transport：退出接口允许空 Bearer 且发送请求', async () => {
  const overloads = {
    requests: [] as { url: string; init: RequestInit }[],
    respond: () => ({ status: 200, body: { message: '已退出' } }),
  }
  const api = createApi({
    origin: 'http://app.example.invalid',
    fetcher: (async (input: any, init: any) => {
      overloads.requests.push({ url: String(input), init })
      return new Response(JSON.stringify({ message: '已退出' }))
    }) as unknown as typeof fetch,
    getToken: () => null,
  })
  const result = await api('/api/auth/logout', { identity: 'sso', method: 'POST', body: {} })
  assert.equal((result as { message: string }).message, '已退出')
  assert.equal(overloads.requests.length, 1)
})
