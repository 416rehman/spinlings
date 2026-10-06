// Embed only reviewed native Desktop captures. Missing captures leave no route or gallery entry.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, inflateSync } from 'node:zlib'

export const MEDIA_DIR = fileURLToPath(new URL('../docs/media/', import.meta.url))
export const MEDIA_OUT = fileURLToPath(new URL('../server/static/media.gen.ts', import.meta.url))
export const MAX_CAPTURE_BYTES = 1024 * 1024
export const MAX_MEDIA_BYTES = 2 * 1024 * 1024
export const CAPTURES = [
  { file: 'desktop-player-duel-2026-10-06.png', alt: 'A player duel with an optional special-hit cue in Claude Desktop', caption: 'Player duel in Claude Desktop' },
  { file: 'desktop-duel-win-2026-10-06.png', alt: 'A duel win and streak reward above the prompt in Claude Desktop', caption: 'Duel win and streak reward' },
] as const

// Already published under immutable URLs: retained assets, never extra gallery entries.
export const HISTORICAL_ASSETS = [
  { file: 'desktop-team-0.2.15.png', sha256: '9f9bd8e9a9feabd83cc00edbd46a9aee62354b28f6f772bf3e3ec0c0c85b582d' },
  { file: 'desktop-team-picker-0.2.15.png', sha256: '76a6713d348fda6c817daa1b31d62ab7390712a64e8cf80511d12ac8e2ff92fa' },
  { file: 'desktop-card-0.2.15.png', sha256: '3ac0c498a4aeaf568bb50953582cc8970499becb3d683c0fcccb2a200c320302' },
  { file: 'desktop-collection-0.2.15.png', sha256: '563ee37230a398771e9f3fada05fb1cfd654ade2215eacb9a515673a397b3249' },
  { file: 'desktop-team-0.2.9.png', sha256: 'f3a52e13537b4c198fced5508e2f36dc132a78e3f81992f6c3da7d9bbbf4bd26' },
  { file: 'desktop-team-picker-0.2.9.png', sha256: 'cd16d43ebe1a1d3943a66a19a48edd192c6a8c693e0da66b49f85814724a6241' },
  { file: 'desktop-market-0.2.9.png', sha256: '76a2fcbcc32cc70a766fd914d4aecab147f4dad537b40f5a0a2eaff5b6b563db' },
  { file: 'desktop-pack-0.2.9.png', sha256: 'ab0ceccb7efd79db54c1bb1074c0a220f4d4fb36c140fff059f179309eab0cc4' },
] as const

/** Check the complete PNG, including bounded decompression and each scanline's filter byte. */
export function captureSize(bytes: Uint8Array): { width: number; height: number } {
  const b = Buffer.from(bytes)
  const bad = () => { throw new Error('Invalid Desktop capture PNG') }
  if (b.length > MAX_CAPTURE_BYTES) throw new Error('Desktop capture exceeds 1 MiB')
  if (!b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return bad()
  let at = 8, width = 0, height = 0, depth = 0, color = -1, interlace = 0, ended = false, palette = false, afterData = false
  const data: Uint8Array[] = []
  while (at + 12 <= b.length) {
    const n = b.readUInt32BE(at), end = at + 12 + n
    if (end > b.length) return bad()
    const type = b.toString('latin1', at + 4, at + 8), body = b.subarray(at + 8, at + 8 + n)
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2]!.toUpperCase()
      || crc32(b.subarray(at + 4, at + 8 + n)) !== b.readUInt32BE(at + 8 + n)) return bad()
    if (at === 8 && type !== 'IHDR') return bad()
    if (type === 'IHDR') {
      if (at !== 8 || n !== 13) return bad()
      width = body.readUInt32BE(0); height = body.readUInt32BE(4)
      depth = body[8]!; color = body[9]!; interlace = body[12]!
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!width || !height || width > 4096 || height > 4096 || width * height > 8_000_000
        || !depths[color]?.includes(depth) || body[10] !== 0 || body[11] !== 0 || interlace > 1) return bad()
    } else if (type === 'PLTE') {
      if (palette || data.length || color === 0 || color === 4 || !n || n % 3 || n > 768 || color === 3 && n / 3 > 2 ** depth) return bad()
      palette = true
    } else if (type === 'IDAT') {
      if (afterData || color === 3 && !palette) return bad()
      data.push(body)
    } else if (type === 'IEND') {
      if (n || !data.length || end !== b.length) return bad()
      ended = true
      break
    } else {
      if (type[0] === type[0]!.toUpperCase() || ['acTL', 'fcTL', 'fdAT'].includes(type)) return bad()
      if (data.length) afterData = true
    }
    at = end
  }
  if (!ended) return bad()
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
  const rows = passes.map(([x, y, dx, dy]) => {
    const w = Math.max(0, Math.ceil((width - x!) / dx!)), h = Math.max(0, Math.ceil((height - y!) / dy!))
    return { stride: Math.ceil(w * channels[color]! * depth / 8) + 1, count: w ? h : 0 }
  })
  const size = rows.reduce((n, p) => n + p.stride * p.count, 0)
  let raw: Buffer
  try { raw = inflateSync(Buffer.concat(data), { maxOutputLength: size }) } catch { return bad() }
  if (raw.length !== size) return bad()
  let offset = 0
  for (const p of rows) for (let y = 0; y < p.count; y++, offset += p.stride) if (raw[offset]! > 4) return bad()
  return { width, height }
}

type ReadCapture = (file: string) => Promise<Uint8Array>

export async function buildMedia(read: ReadCapture = file => readFile(resolve(MEDIA_DIR, file))): Promise<string> {
  const captures: { file: string; alt: string; caption: string; width: number; height: number }[] = []
  const files: string[] = []
  let total = 0
  const load = async (file: string, sha256?: string) => {
    let bytes: Uint8Array
    try { bytes = await read(file) } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') return null
      throw error
    }
    const size = captureSize(bytes)
    if (sha256 && createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('Historical Desktop capture bytes changed')
    total += bytes.length
    if (total > MAX_MEDIA_BYTES) throw new Error('Desktop captures exceed 2 MiB together')
    files.push(`${JSON.stringify(file)}:new Uint8Array([${bytes.join(',')}])`)
    return size
  }
  for (const capture of CAPTURES) {
    const size = await load(capture.file)
    if (size) captures.push({ ...capture, ...size })
  }
  for (const asset of HISTORICAL_ASSETS) await load(asset.file, asset.sha256)
  return `// Generated by node scripts/site-media.ts from the explicit native capture and historical asset lists. Do not edit.\n`
    + `export type DesktopCapture = { file: string; alt: string; caption: string; width: number; height: number }\n`
    + `export const DESKTOP_CAPTURES: readonly DesktopCapture[] = ${JSON.stringify(captures)}\n`
    + `export const MEDIA_FILES: Readonly<Record<string, Uint8Array>> = {${files.join(',')}}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeFile(MEDIA_OUT, await buildMedia())
  console.log('Built first-party Desktop screenshot media.')
}
