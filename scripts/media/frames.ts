// Checks a recording by eye: paints it at given moments to PNGs with a local headless Chrome or Edge (the SVG is
// paused with setCurrentTime). A development aid only; nothing ships from it.
// Usage: node scripts/media/frames.ts docs/media/encounter-dark.svg 0.5 2 4.2 [--out dir] [--scale 1]
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const args = process.argv.slice(2)
const flag = (name: string, d: string) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1]! : d }
const out = resolve(flag('--out', resolve(tmpdir(), 'spinlings-frames')))
const scale = Number(flag('--scale', '1'))
const [file, ...times] = args
if (!file) throw new Error('usage: frames.ts <file.svg> <seconds...>')

const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
]
const browser = browsers.find(existsSync)
if (!browser) throw new Error('frames: no Chrome or Edge found')

const svg = readFileSync(file, 'utf8')
const w = Number(/width="(\d+)"/.exec(svg)![1]), h = Number(/height="(\d+)"/.exec(svg)![1])
mkdirSync(out, { recursive: true })
for (const t of times.length ? times : ['0']) {
  const page = resolve(out, `${basename(file, '.svg')}-${t}.html`)
  writeFileSync(page, `<!doctype html><html><body style="margin:0;background:#888">${svg}
<script>const s=document.querySelector('svg');s.pauseAnimations();s.setCurrentTime(${Number(t)});</script></body></html>`)
  const png = resolve(out, `${basename(file, '.svg')}-${t}.png`)
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${scale}`,
    `--window-size=${w},${h}`, `--screenshot=${png}`, '--virtual-time-budget=1500', pathToFileURL(page).href], { stdio: 'ignore' })
  console.log(png)
}
