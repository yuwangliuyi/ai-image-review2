import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
export const APP_ID = 'APP_TEST'
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const people = {
  owner: { user_id: 1, ding_corp_id: null, ding_user_id: null, is_application_owner: true },
  admin: { user_id: 101, ding_corp_id: 'corp-A', ding_user_id: 'person-admin', is_application_owner: false },
  staff: { user_id: 102, ding_corp_id: 'corp-A', ding_user_id: 'person-staff', is_application_owner: false },
  locked: { user_id: 206, ding_corp_id: 'corp-A', ding_user_id: 'person-lock', is_application_owner: false },
  newbie: { user_id: 205, ding_corp_id: 'corp-A', ding_user_id: 'person-new', is_application_owner: false },
  manual: { user_id: 103, ding_corp_id: null, ding_user_id: null, is_application_owner: false },
}

function centerIdentity(token, target) {
  const person = people[token]
  if (!person) return null
  return { username: token, name: token, ...person,
    user_id: target ? ({ admin: 7, staff: 8, owner: 9 }[token] ?? person.user_id) : person.user_id }
}

export async function fixture() {
  const claims = {}
  const organizationRoster = {}
  const temp = mkdtempSync(join(tmpdir(), 'ai-image-dingtalk-test-'))
  const originalDb = join(temp, 'original.db')
  const copiedDb = join(temp, 'local.db')
  const queries = []
  let browserEnvironment = '90'
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-JX-SSO-Identity, X-JX-SSO-Guard')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    const bodyChunks = []
    for await (const chunk of req) bodyChunks.push(chunk)
    const body = JSON.parse(Buffer.concat(bodyChunks).toString() || '{}')
    const url = new URL(req.url, 'http://loopback')
    if (url.pathname === '/login') {
      const redirect = new URL(url.searchParams.get('redirect_url'))
      if (redirect.hostname !== '127.0.0.1') { res.writeHead(400); res.end(); return }
      redirect.hash = `token=browser-${browserEnvironment}-admin`
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`<h1>隔离 SSO ${browserEnvironment} 测试登录</h1><a href="${redirect.href.replaceAll('&', '&amp;')}">以 admin 登录 ${browserEnvironment}</a>`)
      return
    }
    const target = url.pathname.startsWith('/123/')
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/, '')
    queries.push({ path: url.pathname, contract: req.headers['x-jx-sso-identity'], token })
    const synthetic = token.match(/^browser-(90|123)-(owner|admin|staff)$/)
    const baseIdentity = centerIdentity(synthetic ? (synthetic[1] === (target ? '123' : '90') ? synthetic[2] : '') : token, target)
    const identity = baseIdentity ? { ...baseIdentity, ...claims[token] } : null
    const reply = (status, code, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ code, data })) }
    if (token === 'disabled' || token === 'revoked') return reply(403, 403, {})
    if (url.pathname.endsWith('/auth/verify')) {
      let claims = identity
      if (token === 'collision') claims = { ...centerIdentity('admin', false), ding_user_id: 'attacker' }
      if (token === 'other-corp') claims = { ...centerIdentity('admin', true), ding_corp_id: 'corp-B' }
      if (token === 'lost-ding') claims = { ...centerIdentity('admin', target), ding_corp_id: null, ding_user_id: null }
      if (token === 'malformed') claims = { ...centerIdentity('admin', target), ding_corp_id: null }
      if (token === 'old-contract') claims = centerIdentity('admin', target)
      if (!claims) return reply(401, 401, {})
      return reply(200, 0, { identity_contract: token === 'old-contract' ? undefined : 'dingtalk-v1', app_id: APP_ID, application_allowed: true, ...claims })
    }
    if (!identity) return reply(401, 401, {})
    if (url.pathname.endsWith('/app/users')) {
      const records = Object.keys(people).filter(key => organizationRoster[key] !== false).map(key => ({
        ...centerIdentity(key, target), status: 1, access_source: 'ROLE',
        organization: { departments: [], primary_department: null, observed_at: null },
        ...organizationRoster[key],
      }))
      return reply(200, 0, { identity_contract: 'dingtalk-v1', records, page_no: 1, page_size: 100, total_page: 1, total_count: records.length })
    }
    if (url.pathname.endsWith('/app/users/resolve-identities')) {
      if (!identity.is_application_owner) return reply(403, 403, {})
      const records = body.user_ids.map((id) => {
        const found = Object.values(people).find((item) => item.user_id === id)
        return { user_id: id, found: !!found, ding_corp_id: found?.ding_corp_id ?? null, ding_user_id: found?.ding_user_id ?? null }
      })
      return reply(200, 0, { identity_contract: 'dingtalk-v1', records })
    }
    return reply(404, 404, {})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const center = `http://127.0.0.1:${server.address().port}`
  let app
  let base
  async function stop() {
    if (app) { const done = new Promise((resolve) => app.once('exit', resolve)); app.kill('SIGTERM'); await done; app = null }
  }
  async function start(db, environment = '90', port = 0) {
    await stop()
    browserEnvironment = environment
    app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '-p', String(port)], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: `file:${db}`, NEXTAUTH_SECRET: 'isolated-test', JX_SSO_APP_ID: APP_ID, JX_SSO_ONBOARDING_MODE: 'guided', JX_SSO_OWNER_USER_ID: '1', JX_SSO_ENVIRONMENT: 'test', JX_SSO_WEB_URL: center, JX_SSO_API_URL: `${center}/${environment}/sso` },
    })
    let logs = ''
    app.stdout.on('data', (data) => { logs += data; const match = logs.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) base = match[0] })
    app.stderr.on('data', (data) => { logs += data })
    base = null
    for (let i = 0; i < 120; i++) { if (base) { try { if ((await fetch(`${base}/api/auth/mode`)).ok) return } catch {} } await delay(100) }
    throw new Error(`app failed: ${logs.slice(-4000)}`)
  }
  async function api(path, token, body, method) {
    const res = await fetch(`${base}${path}`, { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, data: await res.json() }
  }
  writeFileSync(originalDb, '')
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: `file:${originalDb}` }, stdio: 'ignore' })
  return { get base() { return base }, claims, organizationRoster, temp, originalDb, copiedDb, start, stop, api, queries, center, close: async () => { await stop(); await new Promise((resolve) => server.close(resolve)); rmSync(temp, { recursive: true, force: true }) } }
}
