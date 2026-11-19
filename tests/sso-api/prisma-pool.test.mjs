import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

test('production route bundles share one SQLite client and can complete concurrent transactions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-review-prisma-pool-'))
  const previous = { database: process.env.DATABASE_URL, mode: process.env.NODE_ENV }
  process.env.DATABASE_URL = `file:${join(directory, 'probe.db')}?socket_timeout=5`
  process.env.NODE_ENV = 'production'
  const source = readFileSync(new URL('../../src/lib/prisma.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const sharedGlobal = {}
  const clients = []
  try {
    // Next's route bundles evaluate their own copy of this module in one process.
    for (let i = 0; i < 3; i += 1) {
      const module = { exports: {} }
      new Function('require', 'module', 'exports', 'globalThis', code)(require, module, module.exports, sharedGlobal)
      clients.push(module.exports.prisma)
    }
    await Promise.all(clients.map(client => client.$connect()))
    assert.equal(new Set(clients).size, 1, 'production bundles must reuse the same pool')
    const results = await Promise.all(clients.map(client => client.$transaction(tx => tx.$queryRaw`SELECT 1 AS value`)))
    assert.ok(results.every(rows => Number(rows[0].value) === 1))
  } finally {
    await Promise.all([...new Set(clients)].map(client => client.$disconnect()))
    if (previous.database === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous.database
    if (previous.mode === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous.mode
    rmSync(directory, { recursive: true, force: true })
  }
})
