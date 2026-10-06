// Real captures stay optional; synthetic PNGs below exercise the build/serve contract without shipping placeholders.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import { CAPTURES, HISTORICAL_ASSETS, MAX_CAPTURE_BYTES, MEDIA_DIR, MEDIA_OUT, buildMedia, captureSize } from '../../scripts/site-media.ts'
import { captureResponse, desktopGallery } from '../../server/src/pages-media.ts'
import { LANDING_CSS } from '../../server/src/pages-landing.ts'
import { createCanvas, encodePng } from '../../server/src/png.ts'
import { DESKTOP_CAPTURES, MEDIA_FILES } from '../../server/static/media.gen.ts'
import { server } from './scaffold-helpers.ts'

const absent = () => Object.assign(new Error('missing capture'), { code: 'ENOENT' })
const smallPng = () => encodePng(createCanvas(3, 2, '#171a24'))
const chunk = (type: string, data: Uint8Array) => {
  const b = Buffer.alloc(data.length + 12)
  b.writeUInt32BE(data.length, 0); b.write(type, 4); b.set(data, 8)
  b.writeUInt32BE(crc32(b.subarray(4, b.length - 4)), b.length - 4)
  return b
}

describe('first-party native Desktop screenshots', () => {
  it('builds only the explicit available captures, and an empty build has no placeholder entries', async () => {
    const bytes = await smallPng(), reads: string[] = []
    const built = await buildMedia(async file => {
      reads.push(file)
      if (file !== CAPTURES[1].file) throw absent()
      return bytes
    })
    assert.deepEqual(reads, [...CAPTURES, ...HISTORICAL_ASSETS].map(c => c.file))
    assert.match(built, /"width":3,"height":2/)
    assert.ok(built.includes(`new Uint8Array([${bytes.join(',')}])`), 'the file bytes are embedded unchanged')
    assert.ok(built.includes(CAPTURES[1].file))
    for (const c of [...CAPTURES.filter(c => c !== CAPTURES[1]), ...HISTORICAL_ASSETS]) assert.ok(!built.includes(c.file), c.file)
    const empty = await buildMedia(async () => { throw absent() })
    assert.match(empty, /DESKTOP_CAPTURES: readonly DesktopCapture\[\] = \[\]/)
    assert.match(empty, /MEDIA_FILES: Readonly<Record<string, Uint8Array>> = \{\}/)
    await assert.rejects(buildMedia(async () => { throw Object.assign(new Error('cannot read'), { code: 'EACCES' }) }), /cannot read/)
  })

  it('requires a complete valid bounded PNG, including chunk checksums and decodable scanlines', async () => {
    const bytes = await smallPng()
    assert.deepEqual(captureSize(bytes), { width: 3, height: 2 })
    const badCrc = Uint8Array.from(bytes); badCrc[29] ^= 1
    for (const bad of [new Uint8Array(), bytes.subarray(0, 30), badCrc, Buffer.concat([bytes, Buffer.from([0])])]) {
      assert.throws(() => captureSize(bad), /Invalid Desktop capture PNG/)
    }
    const signature = bytes.subarray(0, 8), header = Buffer.from(bytes.subarray(16, 29))
    const raw = Buffer.alloc((3 * 4 + 1) * 2); raw[0] = 5
    const invalidFilter = Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())])
    assert.throws(() => captureSize(invalidFilter), /Invalid Desktop capture PNG/)
    header.writeUInt32BE(4097, 0)
    assert.throws(() => captureSize(Buffer.concat([signature, chunk('IHDR', header), bytes.subarray(33)])), /Invalid Desktop capture PNG/)
    assert.throws(() => captureSize(new Uint8Array(MAX_CAPTURE_BYTES + 1)), /exceeds 1 MiB/)
    const padded = Buffer.concat([bytes.subarray(0, 33), chunk('tEXt', Buffer.alloc(700 * 1024, 32)), bytes.subarray(33)])
    assert.deepEqual(captureSize(padded), { width: 3, height: 2 })
    const atLimit = Buffer.concat([bytes.subarray(0, 33), chunk('tEXt', Buffer.alloc(MAX_CAPTURE_BYTES - bytes.length - 12, 32)), bytes.subarray(33)])
    await assert.rejects(buildMedia(async file => CAPTURES.some(c => c.file === file) ? atLimit : readFile(MEDIA_DIR + file)), /exceed 2 MiB together/)
    await assert.rejects(buildMedia(async file => {
      if (file !== HISTORICAL_ASSETS[0].file) throw absent()
      return bytes
    }), /Historical Desktop capture bytes changed/)
  })

  it('serves the exact whitelisted bytes with immutable PNG caching and rejects inherited names', async () => {
    const bytes = await smallPng(), file = CAPTURES[0].file
    const files = Object.assign(Object.create({ inherited: bytes }), { [file]: bytes }) as Record<string, Uint8Array>
    const res = captureResponse(file, files)!
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes)
    for (const name of ['inherited', 'constructor', '__proto__', 'toString', 'desktop-team-0.2.8.png', '../private.png']) {
      assert.equal(captureResponse(name, files), null, name)
    }
  })

  it('registers only available image routes; missing names are plain 404s and actual files retain security/cache headers', async () => {
    const s = server()
    for (const c of [...CAPTURES, ...HISTORICAL_ASSETS]) {
      const res = await s.request('GET', `/media/${c.file}`, { client: null })
      if (Object.hasOwn(MEDIA_FILES, c.file)) {
        assert.equal(res.status, 200, c.file)
        assert.equal(res.headers.get('content-type'), 'image/png')
        assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
        assert.deepEqual(new Uint8Array(await res.arrayBuffer()), MEDIA_FILES[c.file])
        const head = await s.request('HEAD', `/media/${c.file}`, { client: null })
        assert.equal(head.status, 200)
        assert.equal((await head.arrayBuffer()).byteLength, 0)
      } else {
        assert.equal(res.status, 404, c.file)
        assert.match(await res.text(), /No such picture/)
      }
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
      assert.equal(res.headers.get('set-cookie'), null)
    }
    for (const file of ['constructor', '__proto__', 'toString', 'desktop-team-0.2.8.png', 'team-v0.2.15-source.png',
      'desktop-team-0.2.15-source.png', 'github-social.png', 'desktop-duel.png', '%2e%2e%2fprivate.png',
      '%2e%2e%2f%2e%2e%2f.dev%2flaunch-2026-10%2fnative%2fcard-v0.2.15-source.png']) {
      const res = await s.request('GET', `/media/${file}?ignored=private-value`, { client: null })
      assert.equal(res.status, 404, file)
      assert.doesNotMatch(await res.text(), /private-value/)
    }
  })

  it('shows the supplied duel and win scenes while preserving every published screenshot URL', async () => {
    assert.equal(DESKTOP_CAPTURES.length, 2)
    assert.deepEqual(DESKTOP_CAPTURES.map(c => c.file), CAPTURES.map(c => c.file))
    const gallery = desktopGallery().__html
    assert.equal((gallery.match(/<figure>/g) ?? []).length, 2)
    for (const capture of DESKTOP_CAPTURES) {
      assert.match(capture.file, /^desktop-(player-duel|duel-win)-2026-10-06\.png$/)
      assert.match(capture.alt, /Claude Desktop/)
      assert.doesNotMatch(capture.alt + capture.caption, /v0\.2\./, 'the supplied captures have no version footer')
    }
    for (const asset of HISTORICAL_ASSETS) {
      const bytes = await readFile(MEDIA_DIR + asset.file)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.file)
      assert.deepEqual(MEDIA_FILES[asset.file], new Uint8Array(bytes), 'immutable URLs retain their original PNG bytes')
      assert.ok(!gallery.includes(asset.file), 'historical assets do not become gallery cards')
    }
  })

  it('keeps the gallery closed, lazy, same-origin and intrinsically sized without adding script', async () => {
    assert.equal(desktopGallery([]).__html, '')
    const gallery = desktopGallery([{ ...CAPTURES[0], width: 900, height: 700 },
      { ...CAPTURES[1], width: 320, height: 400, alt: '<script>bad</script>', caption: '<b>escaped</b>' }]).__html
    assert.match(gallery, /^<details class="desktop-shots"><summary>In Claude Desktop<\/summary>/)
    assert.doesNotMatch(gallery, /<details[^>]*\bopen|<script|https?:\/\//)
    assert.equal((gallery.match(/loading="lazy" decoding="async"/g) ?? []).length, 2)
    assert.match(gallery, /width="900" height="700"/)
    assert.match(gallery, /&lt;script&gt;bad&lt;\/script&gt;/)
    assert.match(gallery, /&lt;b&gt;escaped&lt;\/b&gt;/)
    for (const [, src] of gallery.matchAll(/\bsrc="([^"]+)"/g)) assert.ok(CAPTURES.some(c => src === `/media/${c.file}`))
    assert.match(LANDING_CSS, /\.desktop-shot-grid\{[^}]*minmax\(min\(100%,360px\),1fr\)/)
    assert.match(LANDING_CSS, /\.desktop-shot-grid figure\{[^}]*min-width:0/)
    assert.match(LANDING_CSS, /\.desktop-shot-grid img\{[^}]*width:auto;max-width:100%;height:auto/)
    const page = await (await server().request('GET', '/', { client: null })).text()
    assert.equal(page.includes('<details class="desktop-shots">'), DESKTOP_CAPTURES.length > 0)
    if (DESKTOP_CAPTURES.length) assert.ok(page.indexOf('<details class="desktop-shots">') > page.indexOf('data-demo'))
  })

  it('keeps the generated payload exactly fresh for the captures present in the checkout', async () => {
    assert.equal(await readFile(MEDIA_OUT, 'utf8'), await buildMedia(), 'run node scripts/site-media.ts after adding or replacing a capture')
    assert.deepEqual(Object.keys(MEDIA_FILES), [...DESKTOP_CAPTURES, ...HISTORICAL_ASSETS].map(c => c.file))
    for (const c of DESKTOP_CAPTURES) assert.deepEqual(captureSize(MEDIA_FILES[c.file]!), { width: c.width, height: c.height })
  })
})
