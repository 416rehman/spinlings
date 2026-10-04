// Checks what build.ts wrote to docs/media before it ships: every SVG under 300 KB, script-free and self-contained,
// well formed, with unique ids, looping on one clock (no syncbase timing), in a dark and a light version; every PNG
// at its exact size. Usage: node scripts/media/check.ts
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/media')
const SIZES: Record<string, [number, number]> = {
  'ph-1-battle.png': [1270, 760], 'ph-2-unique.png': [1270, 760], 'ph-3-pack.png': [1270, 760], 'ph-4-season.png': [1270, 760],
  'x-card.png': [1200, 675], 'x-fusion.png': [1200, 675], 'github-social.png': [1280, 640],
}
const problems: string[] = []
const files = readdirSync(dir)

for (const name of files.filter(f => f.endsWith('.svg'))) {
  const svg = readFileSync(resolve(dir, name), 'utf8')
  const bad = (why: string) => problems.push(`${name}: ${why}`)
  const kb = Buffer.byteLength(svg) / 1024
  if (kb > 300) bad(`${kb.toFixed(1)} KB, over 300 KB`)
  if (/<script|<foreignObject|\bon[a-z]+="/i.test(svg)) bad('script or event handler')
  if (/(?:href|src)="(?:https?:)?\/\//.test(svg) || /url\((?!#)/.test(svg)) bad('an external reference')
  if (/begin="[^"]*\.(?:begin|end)/.test(svg)) bad('syncbase timing (seeks and loops differently across browsers)')
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]!)
  const dup = ids.find((id, i) => ids.indexOf(id) !== i)
  if (dup) bad(`id "${dup}" is used twice`)
  for (const m of svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)) if (!ids.includes(m[1] ?? m[2]!)) bad(`#${m[1] ?? m[2]} points nowhere`)
  const stack: string[] = []
  for (const m of svg.matchAll(/<(\/?)([\w:-]+)[^>]*?(\/?)>/g)) {
    if (m[1]) { if (stack.pop() !== m[2]) { bad(`</${m[2]}> closes the wrong element`); break } } else if (!m[3]) stack.push(m[2]!)
  }
  if (stack.length) bad(`<${stack.at(-1)}> is never closed`)
  const durs = new Set([...svg.matchAll(/<animate(?:Transform)?\b[^>]*repeatCount="indefinite"[^>]*>/g)].map(m => /\bkeyTimes=/.test(m[0]) ? /dur="([^"]+)"/.exec(m[0])?.[1] : null).filter(Boolean))
  const pair = name.replace(/-(dark|light)\.svg$/, (_, t: string) => `-${t === 'dark' ? 'light' : 'dark'}.svg`)
  if (pair === name || !files.includes(pair)) bad('no matching dark or light version')
  console.log(`${name.padEnd(24)} ${kb.toFixed(1).padStart(6)} KB  loop ${[...durs].join(', ') || 'none'}`)
}

for (const [name, [w, h]] of Object.entries(SIZES)) {
  if (!files.includes(name)) { problems.push(`${name}: missing`); continue }
  const png = readFileSync(resolve(dir, name)) as unknown as Uint8Array
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const size = [view.getUint32(16), view.getUint32(20)]
  if (size[0] !== w || size[1] !== h) problems.push(`${name}: ${size[0]}x${size[1]}, wants ${w}x${h}`)
  console.log(`${name.padEnd(24)} ${(png.byteLength / 1024).toFixed(1).padStart(6)} KB  ${size[0]}x${size[1]}`)
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n` + problems.map(p => '  ' + p).join('\n'))
  process.exitCode = 1
} else console.log('\nall media ok')
