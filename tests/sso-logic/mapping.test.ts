import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applySuggestions, restoreRows, rowIssue, validateMapping } from '../../src/lib/sso/frontend/mapping'
import type { MappingRow, PhoneSuggestions, SetupContext } from '../../src/lib/sso/frontend/types'

function context(overrides: Partial<SetupContext> = {}): SetupContext {
  return {
    classification: 'LEGACY',
    phase: 'MAPPING_REQUIRED',
    revision: 2,
    legacy_login_enabled: true,
    jit_enabled: false,
    maintenance_locked: false,
    app_id: 'APP_TEST',
    sso_web_url: 'http://sso.example.invalid',
    sso_api_url: 'http://sso.example.invalid/sso',
    environment: 'test',
    users: [
      { local_user_id: '1', username: 'admin', name: '管理员', roles: ['ADMIN'], is_admin: true, is_enabled: true, sso_user_id: null },
      { local_user_id: '2', username: 'staff', name: '员工', roles: ['UPLOADER'], is_admin: false, is_enabled: true, sso_user_id: null },
    ],
    roster: [
      { user_id: 101, username: 'center-admin', name: '中心管理员', status: 1, access_source: 'ROLE' },
      { user_id: 102, username: 'center-staff', name: '中心员工', status: 1, access_source: 'ROLE' },
      { user_id: 103, username: 'disabled', name: '停用人员', status: 0, access_source: 'ROLE' },
    ],
    draft_rows: [],
    connected_user_id: 101,
    current_sso_user_id: 101,
    operator_local_user_id: null,
    admin_verified: false,
    rollback_available: false,
    csrf_token: null,
    ...overrides,
  }
}

test('restoreRows：已有映射优先，草稿行带 saved', () => {
  const ctx = context({
    draft_rows: [{ local_user_id: '2', sso_user_id: 102, selection_source: 'manual' }],
  })
  const rows = restoreRows(ctx)
  assert.equal(rows[0].sso_user_id, null)
  assert.equal(rows[1].sso_user_id, 102)
  assert.equal(rows[1].saved, true)
})

test('restoreRows：保留本页未保存的人工选择（edited 或未 saved 的选择）', () => {
  const ctx = context()
  const previous: MappingRow[] = [
    { local_user_id: '1', sso_user_id: 101, selection_source: 'manual', edited: true },
    { local_user_id: '2', sso_user_id: 102, selection_source: 'manual' },
  ]
  const rows = restoreRows(ctx, previous, true)
  assert.equal(rows[0].sso_user_id, 101)
  // 未 saved 的本页选择同样保留（“刷新名单保留本页未保存选择”）
  assert.equal(rows[1].sso_user_id, 102)
  // 不传 previous（首次读取）时不保留任何旧值
  const fresh = restoreRows(ctx)
  assert.equal(fresh[0].sso_user_id, null)
  assert.equal(fresh[1].sso_user_id, null)
})

test('applySuggestions：只填空白行，不覆盖人工选择与已占用候选', () => {
  const ctx = context()
  const rows: MappingRow[] = [
    { local_user_id: '1', sso_user_id: 101, selection_source: 'manual' },
    { local_user_id: '2', sso_user_id: null, selection_source: 'manual' },
  ]
  const result: PhoneSuggestions = {
    revision: 2,
    available: true,
    message: '',
    suggestions: [
      // 管理员行建议给 102：该行已人工选择 101，不得覆盖
      { local_user_id: '1', status: 'matched', candidate: { user_id: 102, username: 'center-staff', name: '中心员工', status: 1, access_source: 'ROLE' } },
      { local_user_id: '2', status: 'matched', candidate: { user_id: 101, username: 'center-admin', name: '中心管理员', status: 1, access_source: 'ROLE' } },
    ],
  }
  applySuggestions(ctx, rows, result)
  assert.equal(rows[0].sso_user_id, 101)
  assert.equal(rows[0].selection_source, 'manual')
  // 101 已被第一行占用，第二行不得重复占用
  assert.equal(rows[1].sso_user_id, null)
})

test('rowIssue：stale 与名单外选择必须重新核对', () => {
  const ctx = context()
  assert.match(rowIssue(ctx, { local_user_id: '2', sso_user_id: null, selection_source: 'manual', stale: true }), /已变化/)
  assert.match(
    rowIssue(ctx, { local_user_id: '2', sso_user_id: 103, selection_source: 'manual' }),
    /停用或不在本应用名单/
  )
})

test('validateMapping：缺管理员 / 重复关联 / 覆盖已有关联 / 停用候选', () => {
  const ctx = context()
  assert.match(
    validateMapping(ctx, [
      { local_user_id: '1', sso_user_id: null, selection_source: 'manual' },
      { local_user_id: '2', sso_user_id: 102, selection_source: 'manual' },
    ]),
    /至少关联一名启用的原管理员/
  )
  assert.match(
    validateMapping(ctx, [
      { local_user_id: '1', sso_user_id: 102, selection_source: 'manual' },
      { local_user_id: '2', sso_user_id: 102, selection_source: 'manual' },
    ]),
    /重复/
  )
  const bound = context({
    users: [
      { local_user_id: '1', username: 'admin', name: '管理员', roles: ['ADMIN'], is_admin: true, is_enabled: true, sso_user_id: 101 },
      { local_user_id: '2', username: 'staff', name: '员工', roles: ['UPLOADER'], is_admin: false, is_enabled: true, sso_user_id: null },
    ],
  })
  assert.match(
    validateMapping(bound, [
      { local_user_id: '1', sso_user_id: 102, selection_source: 'manual' },
      { local_user_id: '2', sso_user_id: null, selection_source: 'manual' },
    ]),
    /已有账号关联不能被覆盖/
  )
  assert.match(
    validateMapping(ctx, [
      { local_user_id: '1', sso_user_id: 103, selection_source: 'manual' },
      { local_user_id: '2', sso_user_id: null, selection_source: 'manual' },
    ]),
    /停用或不在本应用名单/
  )
  assert.equal(
    validateMapping(ctx, [
      { local_user_id: '1', sso_user_id: 101, selection_source: 'manual' },
      { local_user_id: '2', sso_user_id: null, selection_source: 'manual' },
    ]),
    ''
  )
})
