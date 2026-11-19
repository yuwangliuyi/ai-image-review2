import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import ts from 'typescript'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const imageReply = () => new Response('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', { headers: { 'Content-Type': 'image/svg+xml' } })
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

async function mount({ page = false, lazy = false, visible = true, reply = imageReply, phase = 'sso' } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/upload' })
  const saved = new Map(), requests = [], revoked = [], blobs = [], observers = []
  let unauthorized = 0
  function global(name, value) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  }
  global('window', dom.window); global('document', dom.window.document); global('navigator', dom.window.navigator)
  global('IS_REACT_ACT_ENVIRONMENT', true)
  global('IntersectionObserver', class {
    constructor(callback) { this.callback = callback; observers.push(this) }
    observe(target) { this.target = target; this.callback([{ target, isIntersecting: visible }]) }
    disconnect() { this.disconnected = true }
  })
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
  URL.createObjectURL = blob => { blobs.push(blob); return `blob:synthetic-${blobs.length}` }
  URL.revokeObjectURL = url => revoked.push(url)
  global('fetch', async (input, init) => {
    requests.push({ url: String(input), init })
    if (String(input).startsWith('/api/spus?')) return Response.json({ spus: [{
      id: 'spu-1', name: '合成商品', category: '合成分类', status: 'PENDING', createdAt: '2026-11-17',
      uploadedBy: { name: '合成用户', department: '验证部门' }, _count: { images: 1 },
      _imageStatuses: { approved: 0, rejected: 0, pending: 1 }, images: [{ id: 'image-1', storedPath: '/uploads/synthetic.svg' }],
    }] })
    return reply(input, init)
  })
  const boundaries = {
    '@/components/AuthLayout': { __esModule: true, default: ({ children }) => React.createElement('main', null, children) },
    'react-dropzone': { useDropzone: () => ({ getRootProps: () => ({}), getInputProps: () => ({}), isDragActive: false }) },
  }
  const cache = new Map()
  function load(path) {
    path = [path, path + '.ts', path + '.tsx'].find(existsSync)
    assert(path, 'source must exist')
    if (cache.has(path)) return cache.get(path).exports
    const module = { exports: {} }; cache.set(path, module)
    const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText
    new Function('require', 'module', 'exports', compiled)(id => Object.hasOwn(boundaries, id) ? boundaries[id]
      : id.startsWith('@/') ? load(join(ROOT, 'src', id.slice(2)))
        : id.startsWith('.') ? load(resolve(dirname(path), id)) : require(id), module, module.exports)
    return module.exports
  }
  const transport = load(join(ROOT, 'src/lib/sso/frontend/app-fetch.ts'))
  transport.registerSsoFetchState({ phase, getToken: () => 'synthetic-app-token', signOut: null,
    guard: { onUnauthorized: () => { unauthorized++ } } })
  const Component = load(join(ROOT, page ? 'src/app/upload/page.tsx' : 'src/components/SsoImage.tsx')).default
  const container = document.getElementById('root'), root = createRoot(container)
  const render = async (src = '/api/images/image-1/file') => act(async () => {
    root.render(React.createElement(Component, page ? {} : { src, alt: '合成图片', loading: lazy ? 'lazy' : 'eager', className: 'test-image' }))
  })
  await render()
  let unmounted = false
  const unmount = async () => { if (!unmounted) { await act(async () => root.unmount()); unmounted = true } }
  return { container, requests, revoked, blobs, observers, render, unmount,
    get unauthorized() { return unauthorized },
    visibility: async value => act(async () => { for (const o of observers) o.callback([{ target: o.target, isIntersecting: value }]) }),
    close: async () => {
      await unmount(); dom.window.close(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke
      for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name] }
    },
  }
}

test('upload cover uses an authenticated blob instead of a bare image API URL', async () => {
  const f = await mount({ page: true })
  try {
    const img = f.container.querySelector('img')
    assert.match(img.getAttribute('src') || '', /^blob:/)
    const call = f.requests.find(r => r.url === '/api/images/image-1/file')
    assert.equal(call.init.headers.get('Authorization'), 'Bearer synthetic-app-token')
    assert.equal(call.init.credentials, 'omit')
    assert.doesNotMatch(f.container.innerHTML, /synthetic-app-token/)
  } finally { await f.close() }
})

test('image fetch uses the existing SSO transport, no-store and abort signal', async () => {
  const f = await mount()
  try {
    assert.equal(f.requests[0].init.headers.get('Authorization'), 'Bearer synthetic-app-token')
    assert.equal(f.requests[0].init.cache, 'no-store')
    assert(f.requests[0].init.signal instanceof AbortSignal)
    assert.equal(f.container.querySelector('img').getAttribute('alt'), '合成图片')
  } finally { await f.close() }
})

test('offscreen lazy images wait, release blobs when hidden, and reload on return', async () => {
  const f = await mount({ lazy: true, visible: false })
  try {
    assert.equal(f.requests.length, 0)
    await f.visibility(true)
    assert.equal(f.requests.length, 1)
    assert.equal(f.container.querySelector('img').getAttribute('src'), 'blob:synthetic-1')
    await f.visibility(false)
    assert.deepEqual(f.revoked, ['blob:synthetic-1'])
    assert.equal(f.container.querySelector('img').getAttribute('src'), null)
    await f.visibility(true)
    assert.equal(f.requests.length, 2)
    assert.equal(f.container.querySelector('img').getAttribute('src'), 'blob:synthetic-2')
  } finally { await f.close() }
})

test('changing images cancels old fetches and cannot display their late response', async () => {
  const old = deferred()
  const f = await mount({ reply: url => String(url).includes('image-1') ? old.promise : imageReply() })
  try {
    await f.render('/api/images/image-2/file')
    assert.equal(f.requests[0].init.signal.aborted, true)
    assert.equal(f.container.querySelector('img').getAttribute('src'), 'blob:synthetic-1')
    await act(async () => old.resolve(imageReply()))
    assert.equal(f.blobs.length, 1)
  } finally { await f.close() }
})

test('401/404/500 responses are never displayed as images', async () => {
  for (const status of [401, 404, 500]) {
    const f = await mount({ reply: () => Response.json({ error: 'synthetic' }, { status }) })
    try {
      assert.equal(f.blobs.length, 0)
      assert.equal(f.container.querySelector('img').getAttribute('src'), null)
      assert.match(f.container.querySelector('img').getAttribute('alt'), /图片加载失败/)
      assert.equal(f.unauthorized, status === 401 ? 1 : 0)
    } finally { await f.close() }
  }
})

test('legacy transport keeps cookie login and never adds an SSO token', async () => {
  const f = await mount({ phase: 'legacy' })
  try {
    assert.equal(f.requests[0].init.headers.has('Authorization'), false)
    assert.notEqual(f.requests[0].init.credentials, 'omit')
    assert.equal(f.blobs.length, 1)
  } finally { await f.close() }
})

test('unmount aborts outstanding loads and releases loaded object URLs', async () => {
  const f = await mount()
  try {
    await f.unmount()
    assert.deepEqual(f.revoked, ['blob:synthetic-1'])
    assert.equal(f.requests[0].init.signal.aborted, true)
  } finally { await f.close() }
  const pending = deferred(), g = await mount({ reply: () => pending.promise })
  try {
    await g.unmount()
    await act(async () => pending.resolve(imageReply()))
    assert.equal(g.blobs.length, 0)
  } finally { await g.close() }
})
