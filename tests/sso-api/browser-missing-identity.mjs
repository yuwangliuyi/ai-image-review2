/** Local-only reproduction of an upgraded legacy app whose identity backfill was not applied. */
import { createServer } from 'node:http'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { migrateIdentities } from '../../scripts/sso-migrate-identities.mjs'
import { fixture, APP_ID } from './fixture.mjs'

const f = await fixture()
const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
for (const [id, name, role, ssoUserId] of [
  ['old-admin', '原管理员', 'ADMIN', 101],
  ['old-reviewer', '原审核员', 'REVIEWER', 102],
]) {
  await p.user.create({ data: { id, name, role, ssoUserId, email: '', department: '合成测试', password: 'no-local-login' } })
}
await p.ssoSetupState.create({ data: { id: 1, classification: 'LEGACY', phase: 'SSO_ONLY', sourceSsoApiUrl: null, identitiesReady: false } })
await p.spu.create({ data: { id: 'history-must-remain', name: '合成历史项目', uploadedById: 'old-admin', assignedReviewerId: 'old-reviewer', department: '合成测试' } })
await p.$disconnect()
await f.start(f.originalDb, '90')

const control = createServer(async (req, res) => {
  try {
    // Both actions operate exclusively on this fixture's generated temporary SQLite file.
    if (req.method === 'POST' && req.url === '/repair') {
      await migrateIdentities({ database: f.originalDb, sourceApi: `${f.center}/90/sso`, appId: APP_ID, token: 'owner', apply: true, backupDirectory: join(f.temp, 'backups') })
    }
    if (req.method === 'POST' && req.url === '/restart') {
      await f.start(f.originalDb, '90', Number(new URL(f.base).port))
    }
    const db = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
    let state
    try {
      state = {
        app: f.base,
        state: await db.ssoSetupState.findUnique({ where: { id: 1 }, select: { phase: true, classification: true, sourceSsoApiUrl: true, identitiesReady: true } }),
        identityCount: await db.ssoIdentityMapping.count(),
        users: await db.user.findMany({ select: { id: true, role: true, ssoUserId: true }, orderBy: { id: 'asc' } }),
        spuCount: await db.spu.count(),
        me: await f.api('/api/auth/me', 'admin'),
      }
    } finally { await db.$disconnect() }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(state))
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: error.message }))
  }
})
await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve))
console.log(JSON.stringify({
  app: f.base,
  admin: `${f.base}/dashboard#token=browser-90-admin`,
  control: `http://127.0.0.1:${control.address().port}`,
  instructions: 'GET control: inspect synthetic state; POST /repair: explicit test-only identity backfill; POST /restart: reload an already rebuilt Next app; Ctrl-C: clean up',
}))
let closing = false
async function close() {
  if (closing) return
  closing = true
  await new Promise((resolve) => control.close(resolve))
  await f.close()
  process.exit(0)
}
process.on('SIGTERM', close)
process.on('SIGINT', close)
