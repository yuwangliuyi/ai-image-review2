/** Manual browser smoke fixture. All identities/data are synthetic and loopback-only. */
import { createServer } from 'node:http'
import { PrismaClient } from '@prisma/client'
import { fixture } from './fixture.mjs'

const f = await fixture()
const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
await p.user.create({ data: { id: 'browser-admin', name: '原管理员', role: 'ADMIN', email: '', department: '测试视觉部', password: 'no-local-login' } })
await p.user.create({ data: { id: 'browser-staff', name: '原审核员', role: 'REVIEWER', email: '', department: '测试视觉部', password: 'no-local-login' } })
await p.spu.create({ data: { id: 'browser-spu', name: '迁移前历史项目', department: '测试视觉部', uploadedById: 'browser-admin', assignedReviewerId: 'browser-staff' } })
await p.image.create({ data: { id: 'browser-image', filename: '保留历史图片.svg', storedPath: '/test-history.svg', mimeType: 'image/svg+xml', fileSize: 10, spuId: 'browser-spu', uploadedById: 'browser-admin' } })
await p.reviewRecord.create({ data: { id: 'browser-review', imageId: 'browser-image', reviewerId: 'browser-staff', action: 'APPROVE', comment: '迁移前审核历史' } })
await p.$disconnect()
await f.start(f.originalDb, '90')
let database = f.originalDb
const control = createServer(async (req, res) => {
  try {
    if (req.url === '/switch' && req.method === 'POST') {
      const port = new URL(f.base).port
      await f.stop()
      const original = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
      const state = await original.ssoSetupState.findUnique({ where: { id: 1 } })
      if (state?.phase !== 'SSO_ONLY') throw new Error('先完成浏览器接入')
      await original.$executeRawUnsafe(`VACUUM INTO '${f.copiedDb.replaceAll("'", "''")}'`)
      await original.$disconnect()
      database = f.copiedDb
      await f.start(database, '123', Number(port))
    }
    const read = new PrismaClient({ datasources: { db: { url: `file:${database}` } } })
    const result = { base: f.base, source: (await read.ssoSetupState.findUnique({ where: { id: 1 } }))?.sourceSsoApiUrl,
      phase: (await read.ssoSetupState.findUnique({ where: { id: 1 } }))?.phase,
      users: await read.user.findMany({ select: { id: true, name: true, role: true, ssoUserId: true } }),
      historyCount: await read.reviewRecord.count(), spuCount: await read.spu.count(),
      foreignCredentialLeak: f.queries.some((row) => row.path.startsWith('/123/') && row.token.startsWith('browser-90-')),
      originalBrowserChecks: f.queries.filter((row) => row.path.startsWith('/90/') && row.token.startsWith('browser-90-')).length,
      targetBrowserChecks: f.queries.filter((row) => row.path.startsWith('/123/') && row.token.startsWith('browser-123-')).length,
    }
    await read.$disconnect()
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result))
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })) }
})
await new Promise((resolve) => control.listen(0, '127.0.0.1', resolve))
console.log(JSON.stringify({ app: f.base, setup: `${f.base}/sso-setup#token=browser-90-owner`, admin: `${f.base}/dashboard#token=browser-90-admin`, control: `http://127.0.0.1:${control.address().port}` }))
async function close() { await new Promise((resolve) => control.close(resolve)); await f.close(); process.exit(0) }
process.on('SIGTERM', close); process.on('SIGINT', close)
