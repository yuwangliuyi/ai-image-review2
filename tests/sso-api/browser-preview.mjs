/** Local browser fixture; all identities and data are synthetic. */
import { PrismaClient } from '@prisma/client'
import { createInterface } from 'node:readline'
import { fixture } from './fixture.mjs'

process.env.AI_REVIEW_INSTANCE_MODE = 'validation'
process.env.AUTH_COOKIE_PREFIX = 'ai-review-sso90-browser'
const f = await fixture()
const p = new PrismaClient({ datasources: { db: { url: `file:${f.originalDb}` } } })
for (const [id, name, role] of [['browser-global', '验证用户', 'UPLOADER'], ['browser-admin', '原管理员', 'ADMIN']]) {
  await p.user.create({ data: { id, name, role, email: '', department: '合成验证数据', password: '!SSO_ONLY!' } })
}
await p.spu.create({ data: { name: '历史任务副本', uploadedById: 'browser-admin', department: '合成验证数据' } })
await f.start(f.originalDb)
const context = await f.api('/api/sso-setup/context', 'owner')
const mapped = await f.api('/api/sso-setup/mapping', 'owner', { revision: context.data.revision, rows: [
  { local_user_id: 'browser-global', sso_user_id: 101, confirmed: true, selection_source: 'manual' },
  { local_user_id: 'browser-admin', sso_user_id: 103, confirmed: true, selection_source: 'manual' },
] })
const completed = await f.api('/api/sso-setup/complete', 'owner', { revision: mapped.data.revision })
if (completed.status !== 200) throw new Error(JSON.stringify(completed))
f.claims['browser-90-admin'] = { is_global_super_admin: true }
console.log(JSON.stringify({ app: `${f.base}/dashboard#token=browser-90-admin` }))
const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  if (line === 'revoke') { f.claims['browser-90-admin'] = { is_global_super_admin: false }; console.log('revoked synthetic global role') }
})
async function close() { lines.close(); await p.$disconnect(); await f.close(); process.exit(0) }
process.on('SIGTERM', close); process.on('SIGINT', close)
