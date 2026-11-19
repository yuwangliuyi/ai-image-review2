import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SsoClient } from '../../src/lib/sso/sso-client'

const settings = { appId: 'APP_TEST', ssoApiUrl: 'http://127.0.0.1:9999/sso', ssoWebUrl: 'http://127.0.0.1:9999', ownerUserId: 1, environment: 'test' as const }
const valid = { identity_contract: 'dingtalk-v1', app_id: 'APP_TEST', application_allowed: true, user_id: 7, username: 'employee', name: '员工', ding_corp_id: 'corp-A', ding_user_id: 'person-A', is_application_owner: true }

test('4.2 全局超管仅接受中心严格布尔值，缺失不提权', async () => {
  const previous = globalThis.fetch
  try {
    for (const value of [true, false, undefined]) {
      globalThis.fetch = (async () => Response.json({ code: 0, data: { ...valid, is_global_super_admin: value } })) as typeof fetch
      assert.equal((await new SsoClient(settings).verify('test-token') as any).isGlobalSuperAdmin, value === true)
    }
    for (const value of ['true', 1, null, {}]) {
      globalThis.fetch = (async () => Response.json({ code: 0, data: { ...valid, is_global_super_admin: value } })) as typeof fetch
      await assert.rejects(() => new SsoClient(settings).verify('test-token'), (error: any) => error.code === 'SSO_UNAVAILABLE')
    }
  } finally { globalThis.fetch = previous }
})

test('可信身份协议：保留完整钉钉身份和当前中心负责人标记', async () => {
  const previous = globalThis.fetch
  let headers: Headers | undefined
  globalThis.fetch = (async (_url, init) => {
    headers = new Headers(init?.headers)
    return Response.json({ code: 0, data: valid })
  }) as typeof fetch
  try {
    const identity = await new SsoClient(settings).verify('test-token')
    assert.equal(headers!.get('X-JX-SSO-Identity'), 'dingtalk-v1')
    assert.equal((identity as any).dingCorpId, 'corp-A')
    assert.equal((identity as any).dingUserId, 'person-A')
    assert.equal((identity as any).isApplicationOwner, true)
  } finally { globalThis.fetch = previous }
})

test('缺少新协议/半个钉钉身份/伪造负责人类型不能降级使用数字 ID', async () => {
  const previous = globalThis.fetch
  try {
    for (const change of [{ identity_contract: undefined }, { ding_corp_id: null }, { ding_user_id: '' }, { ding_user_id: 7 }, { is_application_owner: 1 }]) {
      globalThis.fetch = (async () => Response.json({ code: 0, data: { ...valid, ...change } })) as typeof fetch
      await assert.rejects(() => new SsoClient(settings).verify('test-token'), (error: any) => error.code === ('identity_contract' in change ? 'SSO_IDENTITY_CONTRACT_REQUIRED' : 'SSO_UNAVAILABLE'))
    }
  } finally { globalThis.fetch = previous }
})


test('名单和历史解析必须包含完整新协议身份，解析不能漏项或调换 ID', async () => {
  const previous = globalThis.fetch
  try {
    const roster = { identity_contract: 'dingtalk-v1', page_no: 1, page_size: 100, total_page: 1, total_count: 1,
      records: [{ user_id: 1, username: 'one', name: 'one', status: 1, access_source: 'ROLE', ding_corp_id: 'corp-A', ding_user_id: null }] }
    globalThis.fetch = (async () => Response.json({ code: 0, data: roster })) as typeof fetch
    await assert.rejects(() => new SsoClient(settings).roster('token'), (e: any) => e.code === 'SSO_UNAVAILABLE')
    globalThis.fetch = (async () => Response.json({ code: 0, data: { identity_contract: 'dingtalk-v1', records: [{ user_id: 2, found: true, ding_corp_id: null, ding_user_id: null }, { user_id: 1, found: true, ding_corp_id: null, ding_user_id: null }] } })) as typeof fetch
    await assert.rejects(() => new SsoClient(settings).resolveIdentities('token', [1, 2]), (e: any) => e.code === 'SSO_UNAVAILABLE')
  } finally { globalThis.fetch = previous }
})

test('默认分页名单读全组织字段，兼容旧中心和空名单', async () => {
  const previous = globalThis.fetch
  try {
    const pages: number[] = []
    const people = Array.from({ length: 101 }, (_, i) => ({
      user_id: i + 1, status: 1, access_source: 'ROLE', ding_corp_id: null, ding_user_id: null,
      ...(i === 100 ? { organization: {
        departments: [{ full_path: '甲部' }, { full_path: null, department_name: '乙部' }], observed_at: '2026-11-18T02:00:00+08:00',
      } } : {}),
    }))
    globalThis.fetch = (async input => {
      const url = new URL(String(input))
      assert.equal(url.searchParams.has('include'), false)
      const page = Number(url.searchParams.get('page_no'))
      pages.push(page)
      const pageSize = Number(url.searchParams.get('page_size'))
      return Response.json({ code: 0, data: { identity_contract: 'dingtalk-v1', page_no: page, page_size: pageSize,
        total_page: Math.ceil(people.length / pageSize), total_count: people.length,
        records: people.slice((page - 1) * pageSize, page * pageSize) } })
    }) as typeof fetch
    const client = new SsoClient(settings)
    const roster = await client.roster('token')
    assert.deepEqual(pages, [1, 2])
    assert.equal(roster[0].department, undefined)
    assert.equal(roster[100].department, '甲部、乙部')
    people.length = 0
    assert.deepEqual(await client.roster('token'), [])
  } finally { globalThis.fetch = previous }
})
