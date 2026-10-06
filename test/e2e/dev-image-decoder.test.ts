// Development tooling only. GHSA-wq5f-xc86-pv6w fixes SVG decoding in librsvg 2.63.2.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'

it('Miniflare resolves the patched native SVG decoder and preserves rendered pixels', async () => {
  const sharp = createRequire(new URL('../../node_modules/miniflare/package.json', import.meta.url))('sharp')
  assert.equal(sharp.versions.sharp, '0.35.5')
  const [major, minor, patch] = sharp.versions.rsvg.split('.').map(Number)
  assert.ok(major > 2 || major === 2 && (minor > 63 || minor === 63 && patch >= 2), 'librsvg must include the 2.63.2 security fix')

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#64ad65"/></svg>'
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  assert.equal(info.width, 4)
  assert.equal(info.height, 4)
  assert.equal(info.channels, 4)
  assert.equal(data.length, 64)
  for (let i = 0; i < data.length; i += 4) assert.deepEqual([...data.subarray(i, i + 4)], [100, 173, 101, 255])
})
