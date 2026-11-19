/** Preserve file logs and forward container shutdown to Next.js. */
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'

mkdirSync('/app/logs', { recursive: true })
const log = createWriteStream('/app/logs/app.log', { flags: 'a', mode: 0o600 })
const child = spawn(process.execPath, ['server.js'], { stdio: ['inherit', 'pipe', 'pipe'] })
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
child.stdout.pipe(log, { end: false })
child.stderr.pipe(log, { end: false })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
log.on('error', () => { console.error('日志写入失败'); child.kill('SIGTERM'); process.exitCode = 1 })
child.on('error', () => { console.error('Next.js 启动失败'); log.end(); process.exitCode = 1 })
child.on('close', (code, signal) => { log.end(); process.exitCode = process.exitCode || code || (signal === 'SIGTERM' ? 0 : signal ? 1 : 0) })
