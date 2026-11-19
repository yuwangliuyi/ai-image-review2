import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

test('最终事务重新读取角色、关联和维护锁，仅叠加已验证的本次 SSO 声明', async () => {
  const user = { id: 'old-id', name: 'original', role: 'UPLOADER' }
  const state = { phase: 'SSO_ONLY', maintenanceLocked: false }
  let linked = user
  const tx = { user: { findUnique: async () => ({ ...user }) } }
  const boundaries = {
    crypto: {}, '@/lib/prisma': {}, '@/lib/auth-utils': {}, './sso-client': {},
    './config': { readSsoSettings: () => ({ ssoApiUrl: 'http://isolated/sso' }) },
    './errors': { fail: (status, code) => { throw Object.assign(new Error(code), { status, code }) } },
    './identity-mapping': { findIdentityUser: async () => linked },
    './store': { PHASES: { SSO_ONLY: 'SSO_ONLY' }, getState: async () => state,
      publicUser: (current) => ({ is_enabled: true, is_admin: current.role === 'ADMIN', roles: [current.role] }) },
  }
  const source = readFileSync(new URL('../../src/lib/sso/identity.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => {
    assert.ok(Object.hasOwn(boundaries, name), name); return boundaries[name]
  }, module, module.exports)
  const { recheckActor } = module.exports
  const actor = { user: { ...user, role: 'ADMIN' }, authMethod: 'sso', isGlobalSuperAdmin: true,
    ssoIdentity: { isGlobalSuperAdmin: false } }
  assert.equal((await recheckActor(tx, actor)).user.role, 'UPLOADER', '不能沿用请求开始时的原角色或前端标记')
  actor.ssoIdentity.isGlobalSuperAdmin = true
  assert.equal((await recheckActor(tx, actor)).user.role, 'ADMIN')
  assert.equal(user.role, 'UPLOADER')
  linked = { ...user, id: 'someone-else' }
  await assert.rejects(() => recheckActor(tx, actor), { code: 'MAPPING_CONFLICT' })
  linked = user
  state.maintenanceLocked = true
  await assert.rejects(() => recheckActor(tx, actor), { code: 'MAINTENANCE_REQUIRED' })
  state.maintenanceLocked = false
  actor.authMethod = 'local'
  await assert.rejects(() => recheckActor(tx, actor), { code: 'LOCAL_SESSION_REQUIRED' })
  state.phase = 'MAPPING_REQUIRED'
  assert.equal((await recheckActor(tx, actor)).user.role, 'UPLOADER', '旧 Cookie 不继承全局身份')
})
