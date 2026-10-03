// Prints generated names for a human to read aloud: the first species of season 1 in every family, as species.ts
// draws them, then legendaries, Mythics and fusions built the way cards.ts builds them, and the numbers that keep the
// generator honest over three years (small-word share, how often an ending recurs, repeats, fusions hearing parent B).
//
// Usage: node scripts/names.ts [lines per family]
//        node scripts/names.ts --scan <word list> [proper nouns]
//
// The scan checks every spelling the vocabulary can make against a full English word list (one word per line; a list
// of capitalised proper nouns is optional) and prints the words a name is, sounds like or holds across its join. Add
// the everyday ones to SCANNED or HEARD in core/names.ts.
import { readFileSync } from 'node:fs'
import type { Family } from '../plugin/hooks/core/types.ts'
import {
  builtEndings, endingKey, endingSource, fusionLine, legendaryNames, mythicName, nameRoot, phonotactics,
  pronounceability, blockReason, scanCandidates, smallWords, soundShape, sourceTails, speciesNames, syllables,
} from '../plugin/hooks/core/names.ts'

const FAMILIES: readonly Family[] = ['haiku', 'sonnet', 'opus', 'fable']
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(1, n - s.length))
const pct = (n: number, of: number) => `${Math.round((100 * n) / of)}%`
const title = (w: string) => w[0]!.toUpperCase() + w.slice(1)

if (process.argv[2] === '--scan') scan(process.argv[3]!, process.argv[4])
else preview(Number(process.argv[2] ?? 5))

function seasons(count: number): { season: number; family: Family; index: number; line: string[] }[] {
  const out: { season: number; family: Family; index: number; line: string[] }[] = []
  for (let s = 1; s <= count; s++) {
    const taken: string[] = []
    for (const f of FAMILIES) {
      for (let i = 0; i <= 8; i++) {
        const line = speciesNames(`spinlings/season/${s}/${f}/${i}`, f, i === 8, taken)
        taken.push(...new Set(line))
        out.push({ season: s, family: f, index: i, line })
      }
    }
  }
  return out
}

function preview(count: number): void {
  const all = seasons(39)
  for (const f of FAMILIES) {
    console.log(`\n== ${f} (season 1) ==`)
    for (const { line } of all.filter(x => x.season === 1 && x.family === f && x.index < count)) {
      console.log(`  ${pad(line[0]!, 10)} -> ${pad(line[1]!, 11)} -> ${pad(line[2]!, 12)} p=${(line.reduce((t, n) => t + pronounceability(n), 0) / 3).toFixed(2)}`)
    }
  }

  console.log('\n== legendaries, seasons 1 to 8 ==')
  for (const f of FAMILIES) console.log(`  ${pad(f, 7)} ${all.filter(x => x.family === f && x.index === 8 && x.season <= 8).map(x => x.line[0]).join(' ')}  (${legendaryNames(f).length} before any repeats)`)

  console.log('\n== mythics ==')
  for (let i = 0; i < 8; i++) console.log(`  ${mythicName(`preview/mythic/${i}`)}`)

  console.log('\n== fusions (A + B: stage 1 / 2 / 3), parents from one season ==')
  for (let k = 0; k < 8; k++) {
    const s = 1 + k
    const pool = all.filter(x => x.season === s && x.index < 8)
    const a = pool[(k * 7) % pool.length]!.line[0]!, b = pool[(k * 11 + 3) % pool.length]!.line[0]!
    const taken = all.filter(x => x.season === s).flatMap(x => x.line)
    console.log(`  ${pad(`${a} + ${b}`, 24)} -> ${fusionLine(a, b, taken).join(' / ')}`)
  }

  console.log('\n== the numbers, three years of seasons ==')
  const regular = all.filter(x => x.index < 8)
  const names = [...new Set(all.flatMap(x => x.line))]
  console.log(`  ${names.length} names: lowest score ${Math.min(...names.map(pronounceability)).toFixed(2)}, ` +
    `${names.filter(n => phonotactics(n) || blockReason(n)).length} break a rule`)
  for (const f of FAMILIES) {
    const years = [0, 1, 2].map(y => regular.filter(x => x.family === f && x.season > 13 * y && x.season <= 13 * (y + 1)))
    const small = years.map(ls => pct(ls.filter(x => smallWords(f).includes(endingKey(x.line[0]!))).length, ls.length))
    const most = (ls: typeof regular, stage: number) => {
      const m = new Map<string, number>()
      for (const x of ls) { const w = endingSource(x.line[stage]!); if (w) m.set(w, (m.get(w) ?? 0) + 1) }
      return Math.max(0, ...m.values())
    }
    console.log(`  ${pad(f, 7)} stage 1 a small word: ${small.join(' / ')} by year; a stage-2 word ends at most ` +
      `${years.map(ls => most(ls, 1)).join('/')} lines a year, a stage-3 word ${years.map(ls => most(ls, 2)).join('/')}; ` +
      `${sourceTails(f, 2).length} stage-2 and ${sourceTails(f, 3).length} stage-3 words, ${builtEndings(f, 2).length} built endings`)
  }
  const grows = regular.filter(({ line: [a, b, c] }) => b!.length > a!.length && c!.length > b!.length && syllables(c!) > syllables(a!)).length
  console.log(`  ${grows} of ${regular.length} lines grow at every stage and by a syllable at the last`)
  const first = new Map<string, number>()
  let soon = 0, later = 0
  for (const { season, line } of all) {
    for (const n of new Set(line)) {
      const was = first.get(n)
      if (was === undefined) first.set(n, season)
      else if (season - was < 26) soon++
      else later++
    }
  }
  console.log(`  names that come back: ${soon} within two years, ${later} in the third`)
  const rimeOf = (w: string) => w.replace(/^[^aeiouy]+/, '')
  const heard = [0, 0, 0]
  let fused = 0
  for (let k = 0; k < 200; k++) {
    const s = 1 + (k % 13)
    const pool = all.filter(x => x.season === s && x.index < 8)
    const a = pool[(k * 7) % pool.length]!.line[0]!, b = pool[(k * 11 + 3) % pool.length]!.line[0]!
    if (a === b) continue
    const line = fusionLine(a, b, all.filter(x => x.season === s).flatMap(x => x.line))
    const echo = rimeOf((nameRoot(b) ?? b.toLowerCase()).slice(0, 4)).slice(0, 2)
    line.forEach((n, i) => { if (n.toLowerCase().slice(2).includes(echo)) heard[i]!++ })
    fused++
  }
  console.log(`  fusions: parent B heard at stage 1 / 2 / 3 in ${heard.map(h => pct(h, fused)).join(' / ')} of ${fused}`)
}

function scan(wordsPath: string, properPath?: string): void {
  const dict = new Set(readFileSync(wordsPath, 'utf8').split(/\r?\n/).map(w => w.trim()).filter(w => /^[a-z]{3,}$/.test(w)))
  const proper = new Set(properPath ? readFileSync(properPath, 'utf8').split(/\r?\n/).map(w => w.trim())
    .filter(w => /^[A-Z][a-z]{3,}$/.test(w)).map(w => w.toLowerCase()) : [])
  const bySound = new Map<string, string>(), byShape = new Map<string, string>()
  for (const w of dict) {
    if (w.length < 4) continue
    const k = soundShape(w)
    if (!bySound.has(k.sound)) bySound.set(k.sound, w)
    if (w.length >= 5 && !byShape.has(k.skeleton)) byShape.set(k.skeleton, w)
  }
  const hits = new Map<string, Map<string, string[]>>()
  const add = (kind: string, word: string, name: string) => {
    const m = hits.get(kind) ?? hits.set(kind, new Map()).get(kind)!
    ;(m.get(word) ?? m.set(word, []).get(word)!).push(name)
  }
  let count = 0
  for (const c of scanCandidates()) {
    const n = c.name
    if (phonotactics(title(n)) || blockReason(title(n))) continue
    count++
    if (dict.has(n)) add('is a word', n, n)
    if (proper.has(n)) add('is a proper noun', n, n)
    const k = soundShape(n)
    const like = bySound.get(k.sound)
    if (like && like !== n) add('sounds like', like, n)
    const shape = n.length >= 5 ? byShape.get(k.skeleton) : undefined
    if (shape && shape !== n && Math.abs(shape.length - n.length) <= 2) add('shaped like', shape, n)
    let join = 0
    while (join < n.length && join < c.root.length && n[join] === c.root[join]) join++
    for (let len = 4; len < n.length; len++) {
      for (let i = 0; i + len <= n.length; i++) {
        const sub = n.slice(i, i + len)
        if (dict.has(sub) && !c.root.includes(sub) && !c.word.includes(sub) && i < join && i + len > join) add('holds across the join', sub, n)
      }
    }
  }
  console.log(`${count} allowed spellings scanned`)
  for (const [kind, m] of hits) {
    const rows = [...m].sort((a, b) => b[1].length - a[1].length)
    console.log(`\n== ${kind}: ${rows.length} words`)
    console.log(rows.map(([w, ns]) => `${w} (${ns.length}: ${ns.slice(0, 3).join(', ')})`).join('\n'))
  }
}
