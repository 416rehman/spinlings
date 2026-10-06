// The installed paintings must be the exact public PNGs, bounded, static, valid and locally embedded.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { crc32, inflateSync } from 'node:zlib'
import { ARENA_PNG } from '../../plugin/hooks/ui/arena-art-data.ts'

const ART = fileURLToPath(new URL('../../art/arenas/', import.meta.url))
const FAMILIES = ['haiku', 'sonnet', 'opus', 'fable'] as const
const PREFIX = 'data:image/png;base64,'
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
type Chunk = { type: string; data: Buffer }

function chunksOf(png: Buffer): Chunk[] {
  assert.ok(png.subarray(0, 8).equals(SIGNATURE), 'arena asset must have a PNG signature')
  const chunks: Chunk[] = []
  let offset = 8
  while (offset < png.length) {
    assert.ok(offset + 12 <= png.length, 'complete PNG chunk header and CRC')
    const length = png.readUInt32BE(offset), end = offset + 12 + length
    assert.ok(end <= png.length, 'PNG chunk length must remain inside the asset')
    const type = png.toString('ascii', offset + 4, offset + 8)
    assert.match(type, /^[A-Za-z]{4}$/)
    assert.equal(crc32(png.subarray(offset + 4, end - 4)), png.readUInt32BE(end - 4), type + ' CRC')
    chunks.push({ type, data: png.subarray(offset + 8, end - 4) })
    offset = end
    if (type === 'IEND') break
  }
  assert.equal(offset, png.length, 'no bytes after the PNG end')
  assert.equal(chunks[0]?.type, 'IHDR')
  assert.equal(chunks.filter(c => c.type === 'IHDR').length, 1)
  assert.equal(chunks.at(-1)?.type, 'IEND')
  assert.equal(chunks.at(-1)?.data.length, 0)
  // No animation, embedded text, profiles, EXIF or unrelated metadata belongs in these static local paintings.
  for (const chunk of chunks) assert.ok(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(chunk.type), 'unexpected PNG chunk ' + chunk.type)
  return chunks
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, aa = Math.abs(p - a), bb = Math.abs(p - b), cc = Math.abs(p - c)
  return aa <= bb && aa <= cc ? a : bb <= cc ? b : c
}

/** Independently reconstruct the indexed scanlines so invalid filters or palette references cannot hide in IDAT. */
function indexedPixels(chunks: Chunk[], width: number, height: number, paletteSize: number): Uint8Array {
  const data = chunks.filter(c => c.type === 'IDAT')
  assert.ok(data.length > 0, 'the PNG must contain its pixel stream')
  const rowBytes = width + 1, raw = inflateSync(Buffer.concat(data.map(c => c.data)), { maxOutputLength: rowBytes * height })
  assert.equal(raw.length, rowBytes * height, 'complete indexed scanlines')
  const pixels = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * rowBytes]!
    assert.ok(filter <= 4, 'supported PNG filter')
    for (let x = 0; x < width; x++) {
      const i = y * width + x, left = x ? pixels[i - 1]! : 0, up = y ? pixels[i - width]! : 0, corner = x && y ? pixels[i - width - 1]! : 0
      const predictor = filter === 1 ? left : filter === 2 ? up : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, corner) : 0
      pixels[i] = (raw[y * rowBytes + x + 1]! + predictor) & 255
      assert.ok(pixels[i]! < paletteSize, 'every decoded pixel must address the bundled palette')
    }
  }
  return pixels
}

describe('the bundled chunky arena artwork', () => {
  it('keeps generated local image data in inspectable source lines', () => {
    const source = readFileSync(new URL('../../plugin/hooks/ui/arena-art-data.ts', import.meta.url), 'utf8')
    assert.ok(source.split('\n').every(line => line.length <= 128), 'generated PNG data must remain readable without minified-length lines')
  })

  it('ships exactly four family backgrounds and distinct local data payloads', () => {
    assert.deepEqual(Object.keys(ARENA_PNG).sort(), [...FAMILIES].sort())
    assert.deepEqual(readdirSync(ART).filter(name => name.endsWith('.png')).sort(), FAMILIES.map(f => f + '.png').sort())
    assert.equal(new Set(Object.values(ARENA_PNG)).size, FAMILIES.length)
  })

  for (const family of FAMILIES) it(family + ' embeds its exact public 32-color, 160 by 30 logical-cell PNG within 36 KiB', () => {
    const uri = ARENA_PNG[family]
    assert.match(uri, /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
    const encoded = uri.slice(PREFIX.length), png = Buffer.from(encoded, 'base64')
    assert.ok(png.length <= 36 * 1024, family + ': compressed PNG payload budget')
    assert.equal(png.toString('base64'), encoded, 'canonical base64 without extra data')
    assert.ok(png.equals(readFileSync(join(ART, family + '.png'))), family + ': embedded and public PNG bytes must be identical')
    const chunks = chunksOf(png), header = chunks[0]!.data
    assert.equal(header.length, 13)
    assert.deepEqual([header.readUInt32BE(0), header.readUInt32BE(4)], [480, 90], 'the camera uses this authored canvas')
    assert.deepEqual([...header.subarray(8)], [8, 3, 0, 0, 0], 'eight-bit indexed PNG, standard compression/filter, no interlace')
    const palettes = chunks.filter(c => c.type === 'PLTE')
    assert.equal(palettes.length, 1)
    const firstPixels = chunks.findIndex(c => c.type === 'IDAT')
    assert.ok(firstPixels > chunks.findIndex(c => c.type === 'PLTE'), 'the palette must precede image data')
    const palette = palettes[0]!.data
    assert.ok(palette.length >= 6 && palette.length <= 32 * 3 && palette.length % 3 === 0, 'the arena palette has at most 32 entries')
    const alpha = chunks.find(c => c.type === 'tRNS')?.data
    if (alpha) {
      assert.ok(chunks.findIndex(c => c.type === 'tRNS') < firstPixels, 'transparency must precede image data')
      assert.ok(alpha.length > 0 && alpha.length <= palette.length / 3)
      assert.ok(alpha.every(value => value === 255), 'the background must paint opaque pixels; SVG masks own fading')
    }
    const pixels = indexedPixels(chunks, 480, 90, palette.length / 3)
    assert.ok(new Set(pixels).size > 1, 'the embedded painting must not decode as a blank solid color')
    assert.ok(pixels.every((value, i) => {
      const x = i % 480, y = Math.floor(i / 480)
      return value === pixels[(y - y % 3) * 480 + x - x % 3]
    }), 'every 3 by 3 block is exactly one pixel of the 160 by 30 logical canvas')
  })
})
