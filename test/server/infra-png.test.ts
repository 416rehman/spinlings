// PNG validity, checked independently with node:zlib: signature, chunk CRCs, IHDR and the
// inflated scanlines, plus the canvas drawing and the embedded font.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crc32 as zlibCrc32, inflateSync } from 'node:zlib'
import { crc32, createCanvas, encodePng, parseColor, textWidth } from '../../server/src/png.ts'
import type { Canvas } from '../../server/src/png.ts'

type Chunk = { type: string; data: Buffer }

function readPng(bytes: Uint8Array) {
  const buf = Buffer.from(bytes)
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'signature')
  const chunks: Chunk[] = []
  for (let at = 8; at < buf.length;) {
    const length = buf.readUInt32BE(at)
    const type = buf.toString('latin1', at + 4, at + 8)
    const data = buf.subarray(at + 8, at + 8 + length)
    assert.equal(buf.readUInt32BE(at + 8 + length), zlibCrc32(buf.subarray(at + 4, at + 8 + length)), `${type} CRC`)
    chunks.push({ type, data })
    at += 12 + length
  }
  assert.deepEqual(chunks.map(c => c.type), ['IHDR', 'IDAT', 'IEND'])
  const ihdr = chunks[0]!.data
  assert.equal(ihdr.length, 13)
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4)
  assert.deepEqual([...ihdr.subarray(8)], [8, 6, 0, 0, 0], 'bit depth 8, RGBA, deflate, no filter method, no interlace')
  const raw = inflateSync(chunks[1]!.data) // throws unless it is a valid zlib stream
  assert.equal(raw.length, (width * 4 + 1) * height)
  const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (width * 4 + 1)], 0, 'filter type None')
    pixels.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4)
  }
  assert.equal(chunks[2]!.data.length, 0)
  return { width, height, pixels }
}

const at = (c: Pick<Canvas, 'width' | 'data'>, x: number, y: number) => [...c.data.subarray((y * c.width + x) * 4, (y * c.width + x) * 4 + 4)]

describe('PNG encoder', () => {
  it('writes a valid PNG whose pixels round-trip', async () => {
    const canvas = createCanvas(7, 5, '#123456')
    canvas.fillRect(1, 1, 2, 3, '#ff000080')
    canvas.fillRect(5, 0, 9, 9, [0, 255, 0])
    const png = readPng(await encodePng(canvas))
    assert.equal(png.width, 7)
    assert.equal(png.height, 5)
    assert.deepEqual(png.pixels, canvas.data)
  })

  it('encodes transparency and larger images', async () => {
    const canvas = createCanvas(1200, 630)
    canvas.fillRect(100, 100, 50, 50, 'rgba(10, 20, 30, 0.5)')
    const bytes = await encodePng(canvas)
    const png = readPng(bytes)
    assert.deepEqual(png.pixels, canvas.data)
    assert.deepEqual(at(canvas, 0, 0), [0, 0, 0, 0])
    assert.ok(bytes.length < 20_000, `flat art should compress well, got ${bytes.length}`)
  })

  it('computes the standard CRC-32', () => {
    const data = new TextEncoder().encode('123456789')
    assert.equal(crc32(data), 0xcbf43926)
    assert.equal(crc32(data), zlibCrc32(data))
  })

  it('refuses sizes it cannot encode', async () => {
    assert.throws(() => createCanvas(0, 1), RangeError)
    assert.throws(() => createCanvas(5000, 1), RangeError)
    assert.throws(() => createCanvas(1.5, 1), RangeError)
    await assert.rejects(encodePng({ width: 2, height: 2, data: new Uint8Array(3) }), RangeError)
  })
})

describe('canvas', () => {
  it('clips rectangles to the canvas', () => {
    const c = createCanvas(4, 4)
    c.fillRect(-2, -2, 4, 4, '#fff')
    assert.deepEqual(at(c, 1, 1), [255, 255, 255, 255])
    assert.deepEqual(at(c, 2, 2), [0, 0, 0, 0])
    c.fillRect(3, 3, 100, 100, '#000')
    assert.deepEqual(at(c, 3, 3), [0, 0, 0, 255])
  })

  it('blends translucent colors over what is there', () => {
    const c = createCanvas(2, 1, '#000000')
    c.fillRect(0, 0, 1, 1, '#ffffff80')
    assert.deepEqual(at(c, 0, 0), [128, 128, 128, 255])
    c.fillRect(1, 0, 1, 1, 'transparent')
    assert.deepEqual(at(c, 1, 0), [0, 0, 0, 255])
  })

  it('draws pixel grids scaled, skipping empty cells', () => {
    const c = createCanvas(6, 4)
    c.drawPixels(0, 0, [['#f00', null, '#00f'], [undefined, '#0f0', null]], 2)
    assert.deepEqual(at(c, 1, 1), [255, 0, 0, 255])
    assert.deepEqual(at(c, 2, 0), [0, 0, 0, 0])
    assert.deepEqual(at(c, 5, 1), [0, 0, 255, 255])
    assert.deepEqual(at(c, 3, 3), [0, 255, 0, 255])
  })

  it('draws text from the embedded font', () => {
    const c = createCanvas(40, 12)
    const width = c.drawText(0, 0, 'Hi!', '#fff')
    assert.equal(width, textWidth('Hi!'))
    assert.equal(width, 17)
    // 'H': both stems on every row, the bar on row 3
    for (let y = 0; y < 7; y++) {
      assert.equal(at(c, 0, y)[3], 255)
      assert.equal(at(c, 4, y)[3], 255)
    }
    assert.equal(at(c, 2, 3)[3], 255)
    assert.equal(at(c, 2, 2)[3], 0)
    assert.equal(at(c, 5, 0)[3], 0) // the gap between letters
  })

  it('has a glyph for every printable ASCII character', () => {
    const blank = (ch: string) => {
      const c = createCanvas(6, 10)
      c.drawText(0, 0, ch, '#fff')
      return c.data.every((v, i) => i % 4 !== 3 || v === 0)
    }
    for (let code = 33; code < 127; code++) assert.equal(blank(String.fromCharCode(code)), false, String.fromCharCode(code))
    assert.equal(blank(' '), true)
    assert.equal(blank('·'), false)
    const unknown = createCanvas(6, 10), question = createCanvas(6, 10)
    unknown.drawText(0, 0, '☃', '#fff')
    question.drawText(0, 0, '?', '#fff')
    assert.deepEqual(unknown.data, question.data)
  })

  it('gives descenders room below the baseline and breaks lines', () => {
    const c = createCanvas(12, 20)
    c.drawText(0, 0, 'g\nT', '#fff', 1)
    assert.ok([0, 1, 2, 3, 4].some(x => at(c, x, 8)[3] === 255), 'g reaches row 8')
    assert.equal(at(c, 2, 10)[3], 255) // 'T' starts on the next line
  })

  it('parses the color forms the sprites use', () => {
    assert.deepEqual(parseColor('#abc'), [0xaa, 0xbb, 0xcc, 255])
    assert.deepEqual(parseColor('#AABBCC80'), [0xaa, 0xbb, 0xcc, 0x80])
    assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3, 255])
    assert.deepEqual(parseColor('rgb(1 2 3 / 50%)'), [1, 2, 3, 128])
    assert.deepEqual(parseColor('hsl(0, 100%, 50%)'), [255, 0, 0, 255])
    assert.deepEqual(parseColor('hsl(120deg 100% 25%)'), [0, 128, 0, 255])
    assert.deepEqual(parseColor('hsla(240, 100%, 50%, 0.5)'), [0, 0, 255, 128])
    assert.deepEqual(parseColor([300, -4, 7.6]), [255, 0, 8, 255])
    for (const bad of ['red', '#12', 'rgb(1,2)', 'hsl(x, 1%, 1%)', '']) assert.throws(() => parseColor(bad), TypeError, bad)
  })
})
