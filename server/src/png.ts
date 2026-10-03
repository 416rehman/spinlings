// Dependency-free PNG output for og:images: a small RGBA canvas (rectangles, scaled pixel art and
// an embedded 5x7 pixel font) and an encoder that deflates with CompressionStream, which both
// Workers and Node 22 provide.

/** '#rgb', '#rgba', '#rrggbb', '#rrggbbaa', 'rgb()/rgba()', 'hsl()/hsla()', 'transparent' or [r, g, b, a?] */
export type Color = string | readonly [number, number, number, number?]
type Rgba = readonly [number, number, number, number]

export type Canvas = {
  readonly width: number
  readonly height: number
  /** RGBA, row-major, straight (not premultiplied) alpha */
  readonly data: Uint8Array
  fillRect(x: number, y: number, w: number, h: number, color: Color): void
  /** Draws a grid of colors (rows of columns), each cell `scale` pixels square; null cells are skipped. */
  drawPixels(x: number, y: number, pixels: readonly (readonly (Color | null | undefined)[])[], scale?: number): void
  /** Draws text (with '\n' line breaks) from its top-left corner; returns the widest line's width. */
  drawText(x: number, y: number, text: string, color: Color, scale?: number): number
}

const MAX_SIDE = 4096

export function createCanvas(width: number, height: number, background?: Color): Canvas {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
    throw new RangeError('canvas size out of range')
  }
  const data = new Uint8Array(width * height * 4)
  const fill = (x: number, y: number, w: number, h: number, c: Rgba) => {
    if (c[3] === 0) return
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(width, Math.floor(x + w)), y1 = Math.min(height, Math.floor(y + h))
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) blend(data, (py * width + px) * 4, c)
    }
  }
  const canvas: Canvas = {
    width,
    height,
    data,
    fillRect: (x, y, w, h, color) => fill(x, y, w, h, parseColor(color)),
    drawPixels(x, y, pixels, scale = 1) {
      pixels.forEach((row, r) => row.forEach((color, c) => {
        if (color != null) fill(x + c * scale, y + r * scale, scale, scale, parseColor(color))
      }))
    },
    drawText(x, y, text, color, scale = 1) {
      const c = parseColor(color)
      let widest = 0
      text.split('\n').forEach((line, l) => {
        let cx = x
        const top = y + l * LINE_HEIGHT * scale
        for (const ch of line) {
          const at = glyphIndex(ch) * GLYPH_ROWS
          for (let r = 0; r < GLYPH_ROWS; r++) {
            const bits = parseInt(FONT[at + r]!, 32)
            for (let b = 0; b < GLYPH_WIDTH; b++) {
              if (bits & (1 << (GLYPH_WIDTH - 1 - b))) fill(cx + b * scale, top + r * scale, scale, scale, c)
            }
          }
          cx += ADVANCE * scale
        }
        widest = Math.max(widest, textWidth(line, scale))
      })
      return widest
    },
  }
  if (background !== undefined) canvas.fillRect(0, 0, width, height, background)
  return canvas
}

function blend(data: Uint8Array, i: number, [r, g, b, a]: Rgba) {
  if (a === 255) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255
    return
  }
  const sa = a / 255, da = data[i + 3]! / 255
  const oa = sa + da * (1 - sa)
  const mix = (s: number, d: number) => Math.round((s * sa + d * da * (1 - sa)) / oa)
  data[i] = mix(r, data[i]!); data[i + 1] = mix(g, data[i + 1]!); data[i + 2] = mix(b, data[i + 2]!)
  data[i + 3] = Math.round(oa * 255)
}

// ---- Font --------------------------------------------------------------------------------------
// 5 columns x 7 rows above the baseline plus 2 descender rows, for ASCII 32-126 then '·'. Each
// glyph is 9 base-32 digits, one per row, most significant bit leftmost.

const GLYPH_WIDTH = 5
const GLYPH_ROWS = 9
const ADVANCE = 6
const LINE_HEIGHT = 10
const FONT =
  '000000000444440400aaa000000aavavaa004fke5u400op248j300cik8lid0044800000024888420084222480004lel4000044v4400000000cc48000e0000000000cc0001248g000ehjlphe004c4444e00eh1248v00v2421he0026aiv2200vgu11he0068guhhe00v12488800ehhehhe00ehhf12c000cc0cc0000cc0cc480248g8420000v0v0000842124800eh1240400eh1dlle00ehhvhhh00uhhuhhu00ehggghe00sihhhis00vgguggv00vgguggg00ehgnhhf00hhhvhhh00e44444e0072222ic00hikokih00ggggggv00hrllhhh00hhpljhh00ehhhhhe00uhhuggg00ehhhlid00uhhukih00fgge11u00v44444400hhhhhhe00hhhhha400hhhllla00hha4ahh00hha444400v1248gv00e88888e000g8421000e22222e004ah0000000000000v084200000000e1fhf00gguhhhu0000egghe0011fhhhf0000ehvge00698s8880000fhhhf1eggmphhh0040c444e002062222icggikoki00c44444e0000qllll0000mphhh0000ehhhe0000uhhhugg00fhhhf1100mpggg0000fge1u0088s88960000hhhjd0000hhha40000hhlla0000ha4ah0000hhhhf1e00v248v00344844300444444400o44244o00008l20000000cc0000'

function glyphIndex(ch: string): number {
  const code = ch.codePointAt(0)!
  if (code >= 32 && code < 127) return code - 32
  if (ch === '·') return 95
  return ch === '\t' ? 0 : 31 // '?'
}

/** Width in pixels of one line of text at `scale` (no trailing gap). */
export function textWidth(text: string, scale = 1): number {
  const n = [...text].length
  return n ? (n * ADVANCE - 1) * scale : 0
}

// ---- Colors ------------------------------------------------------------------------------------

const colorCache = new Map<string, Rgba>()

export function parseColor(color: Color): Rgba {
  if (typeof color !== 'string') {
    const [r, g, b, a = 255] = color
    return [byte(r), byte(g), byte(b), byte(a)]
  }
  let rgba = colorCache.get(color)
  if (!rgba) {
    rgba = parseCss(color.trim().toLowerCase())
    if (colorCache.size >= 512) colorCache.clear()
    colorCache.set(color, rgba)
  }
  return rgba
}

const byte = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : 0)

function parseCss(s: string): Rgba {
  if (s === 'transparent') return [0, 0, 0, 0]
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s)?.[1]
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map(h => h + h).join('') : hex
    const n = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16)
    return [n(0), n(1), n(2), full.length === 8 ? n(3) : 255]
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(s)
  if (fn) {
    const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean)
    if (parts.length === 3 || parts.length === 4) {
      const percent = (p: string) => (parseFloat(p) / 100) * 255
      const alpha = parts[3] === undefined ? 255 : parts[3].endsWith('%') ? percent(parts[3]) : parseFloat(parts[3]) * 255
      if (fn[1]!.startsWith('rgb')) {
        const [r, g, b] = parts.map(p => (p.endsWith('%') ? percent(p) : parseFloat(p)))
        if ([r, g, b, alpha].every(Number.isFinite)) return [byte(r!), byte(g!), byte(b!), byte(alpha)]
      } else {
        const [h, sat, l] = [parseFloat(parts[0]!), parseFloat(parts[1]!), parseFloat(parts[2]!)]
        if ([h, sat, l, alpha].every(Number.isFinite)) return [...hslToRgb(h, sat, l), byte(alpha)]
      }
    }
  }
  throw new TypeError(`unsupported color ${JSON.stringify(s)}`)
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 30
  const sat = Math.max(0, Math.min(100, s)) / 100, light = Math.max(0, Math.min(100, l)) / 100
  const a = sat * Math.min(light, 1 - light)
  const f = (n: number) => {
    const k = (n + hue) % 12
    return byte((light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
  }
  return [f(0), f(8), f(4)]
}

// ---- Encoder -----------------------------------------------------------------------------------

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

/** Encodes straight-alpha RGBA pixels as an 8-bit RGBA PNG. */
export async function encodePng(image: { width: number; height: number; data: Uint8Array }): Promise<Uint8Array> {
  const { width, height, data } = image
  if (data.length !== width * height * 4) throw new RangeError('pixel data does not match the size')
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height) // each scanline starts with filter type 0
  for (let y = 0; y < height; y++) raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  return concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', await deflate(raw)), chunk('IEND', new Uint8Array(0))])
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // 'deflate' is the zlib wrapper PNG wants; 'deflate-raw' would not be
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, body.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
  return out
}

let crcTable: Uint32Array | undefined

export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
