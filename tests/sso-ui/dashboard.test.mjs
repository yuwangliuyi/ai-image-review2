import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const stats = {
  totalSpus: 737, totalImages: 4843, pendingCount: 68, approvedCount: 640,
  rejectedCount: 29, totalArchived: 640, approvalRate: '86.8', dimension: 'overall',
  currentDepartment: '', currentUser: { id: 'admin', role: 'ADMIN', department: '合成测试' },
  dailyData: [{ date: '2026-11-17', count: 37 }], recentReviews: [], reviewers: [],
  categoryDistribution: [], rejectionReasons: [], departments: [],
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function mount(reply) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/dashboard' })
  const saved = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  let now = 0, nextId = 1
  const timers = new Map(), requests = []
  const schedule = (fn, ms, interval = false) => {
    const id = nextId++
    timers.set(id, { fn, at: now + ms, interval: interval ? ms : 0 })
    return id
  }
  const source = readFileSync(new URL('../../src/app/dashboard/page.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const boundaries = {
    '@/components/AuthLayout': { __esModule: true, default: ({ children }) => React.createElement('main', null, children) },
    '@/lib/sso/frontend/app-fetch': { ssoFetch: (url, options) => { requests.push({ url, options }); return reply(url, options) } },
    recharts: new Proxy({}, { get: (_, name) => name === '__esModule' ? true : ({ children }) =>
      React.createElement(name === 'BarChart' || name === 'PieChart' ? 'svg' : React.Fragment, null, children) }),
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', compiled)(
    id => Object.hasOwn(boundaries, id) ? boundaries[id] : require(id), module, module.exports,
    (fn, ms) => schedule(fn, ms), id => timers.delete(id),
    (fn, ms) => schedule(fn, ms, true), id => timers.delete(id),
  )
  const container = dom.window.document.getElementById('root'), root = createRoot(container)
  await act(async () => { root.render(React.createElement(module.exports.default)) })
  return {
    container, requests,
    setReply(next) { reply = next },
    async tick(ms) {
      await act(async () => {
        const end = now + ms
        for (;;) {
          const next = [...timers.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
          if (!next) break
          const [id, task] = next; now = task.at
          if (task.interval) task.at += task.interval
          else timers.delete(id)
          task.fn()
        }
        now = end
      })
    },
    async click(label) {
      const button = [...container.querySelectorAll('button')].find(node => node.textContent === label)
      assert.ok(button, `Missing ${label}; visible text: ${container.textContent}`)
      await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })))
    },
    async close() {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      }
    },
  }
}

test('HTTP 500 renders a useful error and retry instead of an empty dashboard', async () => {
  const page = await mount(() => json({ error: '获取统计数据失败' }, 500))
  try {
    assert.match(page.container.querySelector('[role="alert"]')?.textContent || '', /加载统计数据失败/)
    assert.doesNotMatch(page.container.textContent, /归档总数/)
    page.setReply(() => json(stats))
    await page.click('重新加载')
    assert.match(page.container.textContent, /640/)
    assert.equal(page.container.querySelector('[role="alert"]'), null)
  } finally { await page.close() }
})

test('slow requests do not overlap and background refresh keeps the dashboard visible', async () => {
  const pending = deferred()
  const page = await mount(() => pending.promise)
  try {
    await page.tick(90000)
    assert.equal(page.requests.length, 1, 'wait for the current response before scheduling another poll')
    await act(async () => pending.resolve(json(stats)))
    const refresh = deferred(); page.setReply(() => refresh.promise)
    await page.tick(29999); assert.equal(page.requests.length, 1)
    await page.tick(1); assert.equal(page.requests.length, 2)
    assert.match(page.container.textContent, /640/)
    await page.tick(90000); assert.equal(page.requests.length, 2)
    await act(async () => refresh.resolve(json(stats)))
  } finally { await page.close() }
})

test('failed background refresh preserves the last successful counts with an alert', async () => {
  const page = await mount(() => json(stats))
  try {
    page.setReply(() => json({ error: '获取统计数据失败' }, 500))
    await page.tick(30000)
    assert.match(page.container.textContent, /640/)
    assert.match(page.container.querySelector('[role="alert"]')?.textContent || '', /上次/)
  } finally { await page.close() }
})

test('changing filters cancels the old request and ignores a late response', async () => {
  const page = await mount(() => json(stats))
  try {
    const pending = deferred(); page.setReply(() => pending.promise)
    await page.tick(30000)
    const old = page.requests.at(-1)
    page.setReply(() => json({ ...stats, dimension: 'department', totalArchived: 321 }))
    await page.click('部门')
    assert.equal(old.options?.signal.aborted, true)
    assert.match(page.container.textContent, /321/)
    await act(async () => pending.resolve(json({ ...stats, totalArchived: 999 })))
    assert.match(page.container.textContent, /321/)
    assert.doesNotMatch(page.container.textContent, /999/)
  } finally { await page.close() }
})

test('unmount aborts outstanding requests', async () => {
  const pending = deferred()
  const page = await mount(() => pending.promise)
  const signal = page.requests[0].options?.signal
  await page.close()
  assert.equal(signal?.aborted, true)
  await act(async () => pending.resolve(json(stats)))
})
