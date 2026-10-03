// The self-hosting entry, end to end: a real node:http server, and databases opened from files.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadMigrations, openDatabase } from '../../server/src/node.ts'
import { SECRET } from './infra-helpers.ts'

const entry = fileURLToPath(new URL('../../server/src/node.ts', import.meta.url))

function run(env: Record<string, string>): { child: ChildProcess; ready: Promise<string> } {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', entry], {
    env: { ...process.env, SPINLINGS_DB: ':memory:', PORT: '0', HOST: '127.0.0.1', PUBLIC_URL: '', SECRET: '', NODE_ENV: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  const ready = new Promise<string>((resolve, reject) => {
    child.stdout!.on('data', d => {
      out += d
      const m = /listening on (http:\/\/[\d.]+:\d+)/.exec(out)
      if (m) resolve(m[1]!)
    })
    child.stderr!.on('data', d => { out += d })
    child.on('exit', code => reject(new Error(`server exited ${code}: ${out}`)))
  })
  return { child, ready }
}

describe('node entry', () => {
  let child: ChildProcess
  let base = ''

  before(async () => {
    const server = run({ SECRET })
    child = server.child
    base = await server.ready
  })

  after(() => { child.kill() })

  it('serves the app with its headers over a migrated database', async () => {
    const res = await fetch(`${base}/v1/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
    assert.equal(res.headers.get('x-frame-options'), 'DENY')
    assert.equal(res.headers.get('access-control-allow-origin'), null)
    const challenge = await fetch(`${base}/v1/challenge`)
    assert.equal(challenge.status, 200)
    assert.equal(((await challenge.json()) as { difficulty: number }).difficulty, 18)
  })

  it('answers 413 to an oversized body, declared or streamed', async () => {
    const big = 'x'.repeat(64 * 1024)
    const declared = await fetch(`${base}/v1/health`, { method: 'POST', body: big, headers: { 'content-type': 'application/json' } })
    assert.equal(declared.status, 413)
    assert.equal(((await declared.json()) as { error: { code: string } }).error.code, 'too_large')

    const streamed = await new Promise<number>((resolve, reject) => {
      const req = request(`${base}/v1/health`, { method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } }, res => {
        res.resume()
        resolve(res.statusCode!)
      })
      req.on('error', reject)
      for (let i = 0; i < 8; i++) req.write(big.slice(0, 4096))
      req.end()
    })
    assert.equal(streamed, 413)
  })

  it('ignores the Host header and refuses absolute-form targets', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const url = new URL(base)
      const req = request({ host: url.hostname, port: url.port, path: 'http://evil.example/v1/health', headers: { host: 'evil.example' } }, res => {
        res.resume()
        resolve(res.statusCode!)
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 400)
  })
})

describe('node entry without a SECRET', () => {
  it('makes a random one with a warning outside production', async () => {
    const server = run({})
    let err = ''
    server.child.stderr!.on('data', d => { err += d })
    const base = await server.ready
    assert.equal((await fetch(`${base}/v1/health`)).status, 200)
    assert.match(err, /SECRET is not set/)
    server.child.kill()
  })

  it('refuses to start in production', async () => {
    const server = run({ NODE_ENV: 'production' })
    await assert.rejects(server.ready, /SECRET must be set/)
  })
})

describe('openDatabase', () => {
  it('creates the file, applies migrations once, and reopens it as is', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spinlings-'))
    try {
      const file = join(dir, 'nested', 'spinlings.db')
      const first = openDatabase(file)
      await first.db.batch([{ sql: `INSERT INTO retired_handles (handle, until) VALUES ('kept-fox-1', '2026-12-01')`, params: [] }])
      first.sqlite.close()
      const again = openDatabase(file)
      assert.equal((await again.db.all('SELECT * FROM d1_migrations')).length, loadMigrations().length)
      assert.equal((await again.db.all('SELECT * FROM retired_handles')).length, 1)
      again.sqlite.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
