/** Exact production image, one CPU, synthetic SSO and a production-sized database.
 * Run: node tests/sso-api/dashboard-preview.mjs <image>; stop with Ctrl-C after browser checks.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const image = process.argv[2]
if (!image) throw new Error('Pass the locally built production image')
const temp = mkdtempSync(join(tmpdir(), 'ai-review-dashboard-'))
const container = `ai-review-dashboard-test-${process.pid}`
const db = join(temp, 'fixture.db')
const imageBytes = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#d9f3e8"/><rect x="60" y="45" width="200" height="150" rx="15" fill="#348569"/></svg>'
async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
// Equal loopback ports inside/outside Docker also exercise middleware's mode fetch.
const port = await freePort()
const ssoPort = await freePort()
const center = `http://127.0.0.1:${ssoPort}/sso`
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
let started = false
async function close() {
  if (started) { docker('rm', '-f', container); started = false }
  rmSync(temp, { recursive: true, force: true })
}
try {
  writeFileSync(db, '')
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], {
    env: { ...process.env, DATABASE_URL: `file:${db}` }, stdio: ['ignore', 'ignore', 'inherit'],
  })
  const p = new PrismaClient({ datasources: { db: { url: `file:${db}` } } })
  const date = new Date()
  await p.user.createMany({ data: Array.from({ length: 142 }, (_, i) => ({
    id: `user-${i}`, name: `合成用户${i}`, email: '', password: '!SSO_ONLY!',
    role: i === 0 ? 'ADMIN' : i === 1 ? 'REVIEWER' : 'UPLOADER', department: i % 2 ? '验证乙部' : '验证甲部',
  })) })
  await p.ssoSetupState.create({ data: {
    id: 1, classification: 'LEGACY', phase: 'SSO_ONLY', revision: 3, sourceSsoApiUrl: center, identitiesReady: true,
  } })
  await p.ssoIdentityMapping.createMany({ data: [0, 1, 2].map(i => ({
    kind: 'legacy', namespace: center, subject: String(101 + i), userId: `user-${i}`,
  })) })
  await p.spu.createMany({ data: Array.from({ length: 737 }, (_, i) => ({
    id: `spu-${i}`, name: `验证商品${i}`, category: `品类${i % 68}`, department: i % 2 ? '验证乙部' : '验证甲部',
    uploadedById: `user-${2 + i % 140}`, assignedReviewerId: i % 2 ? 'user-1' : null,
    status: ['PENDING', 'APPROVED', 'REJECTED'][i % 3], createdAt: date,
  })) })
  await p.image.createMany({ data: Array.from({ length: 4843 }, (_, i) => ({
    id: `image-${i}`, filename: `image-${i}.svg`, storedPath: '/uploads/synthetic.svg', fileSize: Buffer.byteLength(imageBytes), mimeType: 'image/svg+xml',
    storedLocalPath: i % 2 ? '/app/approved-images/synthetic.svg' : null, status: ['PENDING', 'APPROVED', 'REJECTED'][i % 3],
    spuId: `spu-${i % 737}`, uploadedById: `user-${2 + (i % 737) % 140}`,
  })) })
  await p.reviewRecord.createMany({ data: Array.from({ length: 4879 }, (_, i) => ({
    imageId: `image-${i % 4843}`, reviewerId: 'user-1', action: i % 2 ? 'APPROVED' : 'REJECTED', comment: i % 2 ? null : '验证驳回原因',
  })) })
  await p.archive.createMany({ data: Array.from({ length: 640 }, (_, i) => ({
    spuId: `spu-${i}`, spuName: `验证商品${i}`, uploadedByName: '合成用户', department: '验证甲部', imageCount: 6,
  })) })
  await p.notification.createMany({ data: Array.from({ length: 2298 }, (_, i) => ({
    userId: `user-${i % 142}`, message: `合成通知${i}`,
  })) })
  const scoped = await p.spu.count({ where: { uploadedById: 'user-2' } })
  await p.$disconnect()
  // This SSO is exposed only on local loopback. It contains no real identity or credential.
  writeFileSync(join(temp, 'center.cjs'), `
const http = require('node:http');
http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:${port}');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-JX-SSO-Identity, X-JX-SSO-Guard');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const people = { 'synthetic-admin': 101, 'synthetic-reviewer': 102, 'synthetic-uploader': 103 };
  const id = people[(req.headers.authorization || '').replace(/^Bearer /, '')];
  res.writeHead(id ? 200 : 401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: id ? 0 : 401, data: id ? {
    identity_contract: 'dingtalk-v1', app_id: 'APP_TEST', application_allowed: true,
    user_id: id, username: 'synthetic', name: '合成验证管理员', ding_corp_id: null, ding_user_id: null,
    is_application_owner: id === 101, is_global_super_admin: false
  } : {} }));
}).listen(${ssoPort}, '0.0.0.0');
const child = require('node:child_process').spawn(process.execPath, ['scripts/start-server.mjs'], { stdio: 'inherit' });
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('close', code => process.exit(code || 0));
`)
  chmodSync(temp, 0o777); chmodSync(db, 0o666)
  const imageDirectory = join(temp, 'images'); mkdirSync(imageDirectory)
  writeFileSync(join(imageDirectory, 'synthetic.svg'), imageBytes)
  docker('run', '-d', '--platform', 'linux/amd64', '--name', container, '--cpus', '1', '--memory', '1g', '--pids-limit', '256',
    '-p', `127.0.0.1:${port}:${port}`, '-p', `127.0.0.1:${ssoPort}:${ssoPort}`, '-v', `${temp}:/fixture`,
    '-v', `${imageDirectory}:/app/public/uploads:ro`, '-v', `${imageDirectory}:/app/approved-images:ro`,
    '-e', `PORT=${port}`,
    '-e', 'DATABASE_URL=file:/fixture/fixture.db', '-e', 'NEXTAUTH_SECRET=isolated-synthetic-test',
    '-e', 'AUTH_COOKIE_PREFIX=ai-review-dashboard-test', '-e', 'AI_REVIEW_INSTANCE_MODE=validation',
    '-e', 'JX_SSO_APP_ID=APP_TEST', '-e', 'JX_SSO_ONBOARDING_MODE=guided', '-e', 'JX_SSO_OWNER_USER_ID=101',
    '-e', 'JX_SSO_ENVIRONMENT=test', '-e', `JX_SSO_API_URL=${center}`, '-e', `JX_SSO_WEB_URL=http://127.0.0.1:${ssoPort}`,
    image, 'node', '/fixture/center.cjs')
  started = true
  const base = `http://127.0.0.1:${port}`
  async function request(path, token = 'synthetic-admin') {
    const start = performance.now()
    const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
    const isImage = response.headers.get('Content-Type')?.startsWith('image/')
    const body = isImage ? { bytes: await response.text(), cache: response.headers.get('Cache-Control') } : await response.json()
    return { path, status: response.status, body, ms: +(performance.now() - start).toFixed(1) }
  }
  let ready = false
  for (let i = 0; i < 100; i++) {
    try { if ((await request('/api/auth/mode')).status === 200) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(ready, 'container starts')
  const results = []
  // Separate route bundles share one client; repeat concurrent mode/stats/notifications batches.
  for (let batch = 0; batch < 5; batch++) {
    const rows = await Promise.all(Array.from({ length: 12 }, (_, i) => request([
      '/api/auth/mode', '/api/stats?dimension=overall', '/api/notifications', '/api/images/image-0/file',
    ][i % 4])))
    for (const row of rows) {
      assert.equal(row.status, 200, `${row.path}: ${JSON.stringify(row.body)}`)
      if (row.path.startsWith('/api/stats')) {
        assert.equal(row.body.totalSpus, 737); assert.equal(row.body.totalImages, 4843)
        assert.equal(row.body.totalArchived, 640); assert.equal(row.body.currentUser.role, 'ADMIN')
        assert.equal(row.body.categoryDistribution.length, 10); assert.equal(row.body.reviewers.length, 1)
      }
      if (row.path.startsWith('/api/images')) { assert.equal(row.body.bytes, imageBytes); assert.equal(row.body.cache, 'private, no-store') }
    }
    results.push(...rows.map(({ body, ...rest }) => rest))
  }
  assert.equal((await request('/api/stats', 'synthetic-uploader')).body.totalSpus, scoped)
  assert.equal((await request('/api/users', 'synthetic-uploader')).status, 403)
  assert.equal((await request('/api/stats', 'invalid')).status, 401)
  assert.equal((await request('/api/images/image-1/file')).body.bytes, imageBytes, 'approved storage file is readable')
  assert.equal((await request('/api/images/image-0/file', 'invalid')).status, 401)
  assert(!/P1008|P2028|Timed out/.test(docker('logs', container)))
  const times = results.map(row => row.ms).sort((a, b) => a - b)
  assert(times.at(-1) < 5000, 'no five-second SQLite lock stalls')
  console.log(JSON.stringify({ status: 'PASS', image, cpus: 1, requests: results.length, concurrency: 12,
    p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1),
    data: { users: 142, spus: 737, images: 4843, archives: 640, reviews: 4879, notifications: 2298, categories: 68 },
    roleChecks: 'PASS', results, browser: `${base}/dashboard#token=synthetic-admin`, container,
  }))
  process.on('SIGINT', async () => { await close(); process.exit(0) })
  process.on('SIGTERM', async () => { await close(); process.exit(0) })
  setInterval(() => {}, 60000)
  await new Promise(() => {})
} catch (error) { await close(); throw error }
