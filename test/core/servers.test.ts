import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SERVER, isOnServer, normalizeServerUrl } from '../../plugin/hooks/core/servers.ts'

test('server URLs normalise to their origin', () => {
  const cases: [string, string | null][] = [
    ['https://spinlings.dev', 'https://spinlings.dev'],
    ['  HTTPS://Spinlings.DEV/v1/me?x=1#y ', 'https://spinlings.dev'],
    ['spinlings.dev', 'https://spinlings.dev'],
    ['spinlings.dev.', 'https://spinlings.dev'],
    ['https://play.example.org:443/', 'https://play.example.org'],
    ['https://play.example.org:8443', 'https://play.example.org:8443'],
    ['http://localhost:8787', 'http://localhost:8787'],
    ['http://127.0.0.1', 'http://127.0.0.1'],
    ['http://[::1]:3000/x', 'http://[::1]:3000'],
    ['https://localhost', 'https://localhost'],
    ['http://spinlings.dev', null],
    ['http://192.168.1.4:8787', null],
    ['ftp://spinlings.dev', null],
    ['javascript:alert(1)', null],
    ['https://user:pass@spinlings.dev', null],
    ['https://spinlings.dev@evil.example', null],
    ['https://spïnlings.dev', null],
    ['https://-bad-.dev', null],
    ['https://intranet', null],
    ['https://spinlings.dev:0', null],
    ['https://spinlings.dev:70000', null],
    ['https://spin lings.dev', null],
    ['', null],
  ]
  for (const [input, want] of cases) assert.equal(normalizeServerUrl(input), want, JSON.stringify(input))
  assert.equal(normalizeServerUrl(DEFAULT_SERVER), DEFAULT_SERVER)
})

test('sign-in pages must live on the configured server', () => {
  assert.equal(isOnServer('https://spinlings.dev/passkey/signin?p=abc', DEFAULT_SERVER), true)
  assert.equal(isOnServer('https://evil.example/passkey/signin', DEFAULT_SERVER), false)
  assert.equal(isOnServer('spinlings.dev/passkey', DEFAULT_SERVER), false, 'a full URL is required')
  assert.equal(isOnServer('http://localhost:8787/passkey/add?t=1', 'http://localhost:8787'), true)
})
