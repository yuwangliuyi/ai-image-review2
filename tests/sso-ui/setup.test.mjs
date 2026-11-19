import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const mode = {
  classification: 'LEGACY', phase: 'MAPPING_REQUIRED', environment: 'test', revision: 1,
  legacy_login_enabled: true, jit_enabled: false, maintenance_locked: false, app_id: 'APP_TEST',
  sso_web_url: 'http://sso.test', sso_api_url: 'http://sso.test/sso',
}
const person = (user_id, username, department) => ({ user_id, username, name: '合成同名', department, status: 1, access_source: 'ROLE' })
const local = (local_user_id, sso_user_id, is_admin = false) => ({
  local_user_id, username: local_user_id, name: local_user_id, is_admin, is_enabled: true, sso_user_id,
  roles: [is_admin ? 'ADMIN' : 'UPLOADER'],
})
const context = {
  ...mode, connected_user_id: 10, current_sso_user_id: 10, draft_rows: [],
  users: [local('linked', 10, true), local('recommended', null), local('choose', null)],
  roster: [person(10, 'one', '部门甲'), person(20, 'two', '部门乙'), person(30, 'three', '部门丙')],
}

async function render(t, appMode, api) {
  const doc = new JSDOM('<div id="root"></div>', { url: 'http://app.test/sso-setup' })
  const globals = { window: doc.window, document: doc.window.document, IS_REACT_ACT_ENVIRONMENT: true }
  const saved = new Map()
  for (const [key, value] of Object.entries(globals)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
  }
  const container = doc.window.document.getElementById('root')
  const root = createRoot(container)
  t.after(async () => {
    await act(async () => root.unmount())
    doc.window.close()
    for (const [key, original] of saved) {
      if (original) Object.defineProperty(globalThis, key, original)
      else delete globalThis[key]
    }
  })
  const session = { phase: 'sso', mode: appMode, api, user: null, refreshUser: async () => {} }
  function load(relativePath) {
    const source = readFileSync(new URL('../../src/' + relativePath, import.meta.url), 'utf8')
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } })
    const module = { exports: {} }
    new Function('require', 'module', 'exports', outputText)(id => {
      if (id === '@/components/sso/SsoAppGate') return { useSsoApp: () => session }
      if (id === 'next/link') return ({ children, ...props }) => React.createElement('a', props, children)
      if (id.startsWith('@/lib/sso/frontend/')) return load(id.slice(2) + '.ts')
      if (id.startsWith('./')) return load('lib/sso/frontend/' + id.slice(2) + '.ts')
      return require(id)
    }, module, module.exports)
    return module.exports
  }
  const Page = load('app/sso-setup/page.tsx').default
  await act(async () => root.render(React.createElement(Page)))
  const button = name => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === name)
  return { container, button }
}

test('负责人只核对未关联账号，选择同名成员和保存草稿后可以预览再切换', async t => {
  let savedContext = structuredClone(context)
  const calls = []
  const api = async (url, options) => {
    calls.push(url)
    if (url.endsWith('/context')) return savedContext
    if (url.endsWith('/match-phone')) return { available: true, revision: 1,
      suggestions: [{ local_user_id: 'recommended', status: 'matched', candidate: context.roster[1] }] }
    const rows = options.body.rows
    assert.deepEqual(rows.map(row => [row.local_user_id, row.sso_user_id]), [['linked', 10], ['recommended', 20], ['choose', 30]])
    if (url.endsWith('/draft')) {
      savedContext = { ...savedContext, revision: 2, draft_rows: rows }
      return { ...savedContext, roster: [] }
    }
    assert.ok(url.endsWith('/mapping'))
    assert.equal(options.body.revision, 2)
    savedContext = { ...savedContext, revision: 3, phase: 'ADMIN_VERIFICATION_REQUIRED', draft_rows: [],
      users: context.users.map((user, i) => ({ ...user, sso_user_id: rows[i].sso_user_id })) }
    return savedContext
  }
  const { container, button } = await render(t, mode, api)
  assert.equal(container.querySelector('details').open, false)
  assert.match(container.textContent, /1 个已有绑定，1 个推荐待核对，1 个还需选择/)
  const selects = container.querySelectorAll('select')
  assert.equal(selects.length, 2)
  assert.equal(selects[0].getAttribute('aria-label'), 'choose 对应的公司账号')
  assert.match(selects[0].textContent, /合成同名 · 部门乙 · two/)
  assert.match(selects[0].textContent, /合成同名 · 部门丙 · three/)
  assert.equal(button('确认账号对应关系').disabled, true)
  await act(async () => {
    selects[0].value = '30'
    selects[0].dispatchEvent(new window.Event('change', { bubbles: true }))
  })
  await act(async () => button('保存进度').click())
  assert.match(container.textContent, /已保存草稿 · 手动选择/)
  await act(async () => button('确认账号对应关系').click())
  assert.ok(button('切换为公司账号登录'))
  assert.match(container.textContent, /已关联 3 个旧账号，0 个暂不关联/)
  assert.equal(calls.filter(url => url.endsWith('/complete')).length, 0)
})

test('新应用与已完成接入的项目只显示已完成状态', async t => {
  for (const classification of ['GREENFIELD', 'LEGACY']) {
    await t.test(classification, async sub => {
      const complete = { ...mode, classification, phase: 'SSO_ONLY', jit_enabled: true, legacy_login_enabled: false }
      const { container } = await render(sub, complete, () => assert.fail('完成态不能调用接入接口'))
      assert.match(container.textContent, /已完成接入/)
      assert.equal(container.querySelector('select,button'), null)
    })
  }
})
