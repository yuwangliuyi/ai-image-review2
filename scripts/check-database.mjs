/** Startup is read-only: schema migration is an explicit, offline maintenance step. */
import { stat, realpath } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { PrismaClient, Prisma } from '@prisma/client'

let prisma
try {
  const env = process.env
  if (!env.NEXTAUTH_SECRET || env.NEXTAUTH_SECRET.length < 32) throw new Error('请配置至少 32 字符的独立 NEXTAUTH_SECRET')
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(env.AUTH_COOKIE_PREFIX || '') || env.AUTH_COOKIE_PREFIX === 'next-auth') {
    throw new Error('请配置独立 AUTH_COOKIE_PREFIX，禁止复用旧版 Cookie')
  }
  if (env.JX_SSO_ONBOARDING_MODE !== 'guided' || !/^[A-Z][A-Z0-9_]{1,31}$/.test(env.JX_SSO_APP_ID || '')) {
    throw new Error('请先在 90 SSO 登记应用，并配置 guided 与有效 JX_SSO_APP_ID')
  }
  if (!['local', 'test', 'prod'].includes(env.JX_SSO_ENVIRONMENT)) throw new Error('JX_SSO_ENVIRONMENT 未正确配置')
  for (const key of ['NEXTAUTH_URL', 'JX_SSO_WEB_URL', 'JX_SSO_API_URL']) {
    const url = new URL(env[key])
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(key + ' 地址无效')
  }
  if (!['validation', 'production'].includes(env.AI_REVIEW_INSTANCE_MODE)) throw new Error('请明确 AI_REVIEW_INSTANCE_MODE=validation 或 production')
  const file = (env.DATABASE_URL || '').replace(/^file:/, '')
  if (!env.DATABASE_URL?.startsWith('file:') || !isAbsolute(file) || file.includes('?')) throw new Error('DATABASE_URL 必须指向已存在数据库的绝对路径')
  const resolved = await realpath(file)
  if (resolved.startsWith('/data/ai-image-review/')) throw new Error('禁止连接旧版正式数据目录')
  if (!(await stat(resolved)).isFile()) throw new Error('数据库文件不存在')
  prisma = new PrismaClient({ datasources: { db: { url: `file:${resolved}?connection_limit=1` } } })
  await prisma.$executeRawUnsafe('PRAGMA query_only=ON')
  for (const model of Prisma.dmmf.datamodel.models) {
    const name = model.dbName || model.name
    const columns = await prisma.$queryRawUnsafe(`PRAGMA table_info("${name}")`)
    const expected = model.fields.filter(field => field.kind !== 'object').map(field => field.dbName || field.name)
    if (expected.some(field => !columns.some(column => column.name === field))) {
      throw new Error(`数据库尚未完成受控迁移：${name}；启动不会自动改表或初始化账号`)
    }
  }
  for (const [table, index] of [['User', 'User_ssoUserId_key'], ['SsoIdentityMapping', 'SsoIdentityMapping_kind_namespace_subject_key']]) {
    const indexes = await prisma.$queryRawUnsafe(`PRAGMA index_list("${table}")`)
    if (!indexes.some(item => item.name === index && Number(item.unique) === 1)) throw new Error('缺少身份唯一索引，请先核查迁移结果')
  }
  console.log('配置和数据库结构检查通过；未执行迁移或 seed。')
} catch (error) {
  // Never include connection objects or environment values in startup logs.
  console.error(error instanceof Error ? error.message.replace(/file:[^\s]+/g, '[database]') : '数据库启动检查失败')
  process.exitCode = 1
} finally {
  if (prisma) await prisma.$disconnect()
}
