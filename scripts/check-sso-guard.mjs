import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BROWSER = resolve(ROOT, 'jx-sso-integration/browser')
const PUBLIC = resolve(ROOT, 'public/jx-sso')

// 官方守卫五件套：包内分发与 public 副本必须逐字节一致（禁止手写/裁剪/分叉）
const files = ['jx-sso-guard.js', 'jx-sso-guard.mjs', 'jx-sso-guard.d.ts', 'jx-sso-guard.d.mts']
for (const file of files) {
  const source = readFileSync(resolve(BROWSER, file))
  const distributed = readFileSync(resolve(PUBLIC, file))
  if (!source.equals(distributed)) {
    throw new Error(`守卫分发不一致：${file}`)
  }
}

const expected = Object.fromEntries(
  readFileSync(resolve(BROWSER, 'CHECKSUMS.txt'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => line.split(/\s+/).reverse())
)
for (const file of files) {
  const sha = createHash('sha256').update(readFileSync(resolve(PUBLIC, file))).digest('hex')
  if (sha !== expected[file]) {
    throw new Error(`守卫 SHA-256 与官方清单不一致：${file}`)
  }
}
const guard = readFileSync(resolve(PUBLIC, 'jx-sso-guard.js'), 'utf8')
if (!guard.includes("JX_SSO_GUARD_VERSION = '2.2.0'")) {
  throw new Error('官方守卫版本须为 2.2.0')
}
console.log('官方守卫五件套：SHA-256 校验通过，分发副本与接入包逐字节一致（版本 2.2.0）')
