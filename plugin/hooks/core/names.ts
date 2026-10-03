// Creature names (SPEC section 23): pronounceable, evocative, generated per species from a seed.
//
// A species keeps one root for life, a plain nature word (moss, cobble, thunder), and grows by blending that root with
// a word that suits each stage: a small creature at stage 1 (Mossnewt, Leafinch, Coalboar), a fuller creature at stage
// 2 (Mossiskin, Glowyvern) and a grand one at stage 3 (Thundolcano, Cobbastodon). The second word loses only its
// opening consonants, so its stressed syllable survives and it is still heard: a portmanteau, not a stem with a stock
// suffix. When no word suits a root, the ending is built for that species from its family's sounds (Foggo and Mothyn
// at stage 1, Coalobar at stage 2). Legendaries are stately compounds of two whole words (Rivertide, Anvilmaw), Mythics
// are two words from lists of their own (Briarmoor Rainsinger), and a fusion keeps both parents audible.
//
// Every family has a large vocabulary and the rotation spreads it: within a year a stage-2 or stage-3 word ends at most
// three of a family's lines, a small word about five and a built ending one or two, and no root's name comes back for
// at least two years. Every candidate passes a spelling-based phonotactic check, a pronounceability score and the blocklists (rude
// and brand words by spelling and by sound, developer words, franchises, phrases, sound-alikes, words held across the
// join, plain English), and a line grows: more letters at every stage, and by stage 3 at least a syllable and two
// letters more than at stage 1.
//
// Pure ES2023: no I/O, no clock, no Math.random. All randomness comes from the seed through rng.ts.

import type { Family } from './types.ts'
import { hash128, hashString, rngFromSeed, shuffle } from './rng.ts'

export type Stage = 1 | 2 | 3
export type NameLine = [string, string, string]
type Shape = { syllables: readonly [number, number]; letters: readonly [number, number] }

/** Syllables and letters per stage (SPEC section 23). */
export const STAGE_SHAPE: Record<Stage, Shape> = {
  1: { syllables: [2, 2], letters: [4, 8] },
  2: { syllables: [2, 3], letters: [5, 9] },
  3: { syllables: [3, 4], letters: [6, 11] },
}
/** Legendaries: stately two- or three-syllable compounds. */
export const LEGENDARY_SHAPE: Shape = { syllables: [2, 3], letters: [6, 11] }
/** Each word of a Mythic's two-word name. */
export const MYTHIC_WORD_SHAPE: Shape = { syllables: [2, 3], letters: [5, 11] }
/** Candidates weighed per name: at least this many well-formed, allowed spellings per stage, and the rotation picks
 * among the best of them. */
export const CANDIDATES = 24
/** Below this a candidate is never used, however few others survive. */
export const MIN_SCORE = 0.6
/** A candidate this sayable is good enough. Among good candidates the rotation decides, so no single ending wins
 * every time just because it scores a hair higher. */
export const GOOD_SCORE = 0.75

// ---------------------------------------------------------------------------------------------------------------
// Spelling model. Names are read as English spelling, so the rules work on graphemes: a unit is one vowel sound
// (a, ee, oa, final ie...) or one consonant sound (b, th, ck, a doubled ll, qu...).

type Unit = { s: string; v: boolean; silent?: boolean }

const isVowel = (c: string | undefined): boolean => c !== undefined && 'aeiou'.includes(c)
const VOWEL_PAIRS = new Set(['ee', 'ea', 'oo', 'ai', 'ay', 'oa', 'ou', 'oi', 'oy', 'au', 'aw', 'ew', 'ow'])
const FINAL_VOWEL_PAIRS = new Set(['ie', 'ey', 'ue'])
const CONSONANT_PAIRS = new Set(['th', 'sh', 'ch', 'wh', 'ck', 'ng', 'nk', 'ph', 'gh'])

function tokenize(word: string): Unit[] {
  const w = word.toLowerCase()
  const out: Unit[] = []
  let i = 0
  while (i < w.length) {
    const c = w[i]!
    const d = w[i + 1]
    const two = c + (d ?? '')
    const after = w[i + 2]
    if (isVowel(c)) {
      if (i + 2 === w.length && FINAL_VOWEL_PAIRS.has(two)) { out.push({ s: two, v: true }); i += 2; continue }
      if (VOWEL_PAIRS.has(two)) {
        // a w or y before another vowel opens the next syllable: dewella is de-wel-la, maya is ma-ya
        if ((d === 'w' || d === 'y') && (isVowel(after) || after === 'y')) { out.push({ s: c, v: true }); i += 1; continue }
        out.push({ s: two, v: true }); i += 2; continue
      }
      out.push({ s: c, v: true }); i += 1; continue
    }
    if (c === 'y') { out.push({ s: 'y', v: !isVowel(d) }); i += 1; continue }
    if (c === 'q' && d === 'u') { out.push({ s: 'qu', v: false }); i += 2; continue }
    if (CONSONANT_PAIRS.has(two)) { out.push({ s: two, v: false }); i += 2; continue }
    if (d === c) { out.push({ s: two, v: false }); i += 2; continue }
    out.push({ s: c, v: false }); i += 1
  }
  // a final e after a consonant is silent (rune, belle), except the syllabic -le/-re of pebble and ogre
  const n = out.length
  const last = out[n - 1]
  if (last && last.s === 'e' && n >= 3 && !out[n - 2]!.v && out.slice(0, n - 2).some(u => u.v)) {
    const prev = out[n - 2]!.s
    const before = out[n - 3]!
    const syllabic = (prev === 'l' || prev === 'r') && !before.v && before.s !== 'r' && before.s !== 'l'
    if (!syllabic) last.silent = true
  }
  return out
}

const ONSET2 = new Set([
  'b|l', 'b|r', 'c|l', 'c|r', 'd|r', 'f|l', 'f|r', 'g|l', 'g|r', 'p|l', 'p|r', 's|k', 's|l', 's|m', 's|n', 's|p',
  's|t', 's|w', 't|r', 't|w', 'th|r', 'sh|r', 's|qu',
])
const BAD_ONSET1 = new Set(['ng', 'nk', 'ck', 'x', 'ph', 'gh'])
const CODA1 = new Set([
  'b', 'd', 'f', 'ff', 'g', 'k', 'ck', 'l', 'll', 'm', 'n', 'nn', 'p', 'r', 'rr', 's', 'ss', 't', 'tt', 'x', 'th',
  'sh', 'ch', 'ng', 'nk', 'c', 'z',
])
const CODA2 = new Set([
  'n|d', 'n|t', 'n|th', 'n|ch', 'r|n', 'r|d', 'r|k', 'r|t', 'r|m', 'r|l', 'r|s', 'r|th', 'r|ch', 'r|f', 'r|p', 'r|b',
  'r|g', 'r|sh', 's|t', 's|k', 's|p', 'l|t', 'l|d', 'l|m', 'l|p', 'l|th', 'l|k', 'l|f', 'm|p', 'f|t',
])
// consonants before a final silent e: rune, belle, thorne, lance, carve
const PRE_E1 = new Set(['b', 'c', 'd', 'f', 'g', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'th', 'll', 'tt', 'ss', 'nn', 'ff'])
const PRE_E2 = new Set(['r|n', 'r|s', 'r|c', 'n|c', 'n|s', 'l|v', 'r|v'])
// consonants that can close a syllable before the syllabic -le / -re
const PRE_LE = new Set(['b', 'bb', 'd', 'dd', 'g', 'gg', 'k', 'ck', 'p', 'pp', 't', 'tt', 'z', 'zz', 'f', 'ff', 'ss'])
// a syllable cannot end in these before another consonant, nor can these start a syllable after one
const NO_CLOSE = new Set(['qu', 'wh', 'h', 'y', 'w', 'j', 'v', 'z', 'zz', 'x', 'q'])
const NO_OPEN = new Set(['ng', 'nk', 'ck', 'x', 'y', 'j', 'wh', 'ph', 'gh'])
const H_AFTER = new Set(['l', 'll', 'm', 'n', 'r', 'd', 'b', 'ss'])
const STOPS = new Set(['p', 'pp', 'b', 'bb', 't', 'tt', 'd', 'dd', 'k', 'ck', 'c', 'g', 'gg'])
const FRICATIVES = new Set(['f', 'ff', 'th', 'sh', 'ch', 'v'])
const AWKWARD = new Set([
  't|d', 'd|t', 'p|b', 'b|p', 'g|k', 'k|g', 'd|g', 'g|d', 'b|d', 'd|b', 'l|r', 'n|r', 'm|r', 's|r', 'ss|r', 'sh|r',
  'th|r', 'f|v', 'c|s', 's|c', 'ss|c', 'c|g', 'g|c', 'ck|c', 'ck|k', 'k|c', 'c|k', 'c|ck', 'k|ck', 'k|k', 'ng|g',
  'ng|k', 'n|ng', 'n|nk', 'm|n', 'll|r', 'rr|l', 'nn|r', 'll|rr', 'sh|s', 's|sh', 'ss|sh', 'ch|s', 's|ch', 'ss|ch', 'th|s', 'ch|sh', 'sh|ch', 'th|th', 'sh|sh', 'ch|ch', 'th|sh', 'sh|th', 'ss|s', 's|ss',
  't|t', 'tt|t', 'b|v', 'p|v', 'd|v', 't|v', 'g|v', 'k|v', 'ck|v', 'b|f', 'p|f', 'd|f', 'g|f', 'ck|f', 'll|l', 'l|ll', 'p|pp', 'f|ff', 'ff|f', 'nn|n', 'n|nn', 'm|mm', 'mm|m', 'rr|r', 'r|rr',
])
const HIATUS = new Set(['i|a', 'i|o', 'e|o', 'u|a'])
const sound = (u: string): string => (u === 'c' || u === 'k' || u === 'ck' || u === 'q' ? 'K' : u === 'ss' || u === 's' || u === 'z' ? 'S' : u)

type Analysis = { reason: string | null; units: Unit[]; syllables: number }

function analyseWord(word: string): Analysis {
  const w = word.toLowerCase()
  const fail = (reason: string, units: Unit[] = []): Analysis => ({ reason, units, syllables: 0 })
  if (!/^[a-z]+$/.test(w)) return fail('letters')
  if (/(.)\1\1/.test(w)) return fail('triple letter')
  if (/q(?!u)|ph|gh|wr|kn|gn|mb$|hh|ww|yy|jj|vv|kk|cc|xx|qq/.test(w)) return fail('silent or odd letters')
  const units = tokenize(w)
  const syllables = units.filter(u => u.v && !u.silent).length
  if (syllables === 0) return fail('no vowel', units)
  // walk the alternating runs of consonants and vowels
  const runs: { v: boolean; us: Unit[] }[] = []
  for (const u of units) {
    const top = runs[runs.length - 1]
    if (top && top.v === u.v) top.us.push(u)
    else runs.push({ v: u.v, us: [u] })
  }
  const lastUnit = units[units.length - 1]!
  const silentEnd = lastUnit.silent === true
  const syllabicEnd = !silentEnd && lastUnit.s === 'e' && units.length >= 3 && !units[units.length - 2]!.v &&
    !units[units.length - 3]!.v
  let clustersFirst = 0
  let clustersLast = 0
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r]!
    const key = run.us.map(u => u.s).join('|')
    if (run.v) {
      if (run.us.length > 2) return fail('three vowels', units)
      if (run.us.length === 2 && !HIATUS.has(key)) return fail(`vowel clash ${key}`, units)
      continue
    }
    if (run.us.length > 2) return fail('three consonants', units)
    const first = r === 0
    const final = r === runs.length - 1
    const beforeE = r === runs.length - 2 && (silentEnd || syllabicEnd)
    for (const u of run.us) {
      if (u.s.length === 2 && u.s[0] === u.s[1] && 'hwyjvkqx'.includes(u.s[0]!)) return fail('odd double', units)
    }
    if (first) {
      if (run.us.length === 1) {
        const u = run.us[0]!.s
        if (BAD_ONSET1.has(u) || (u.length === 2 && u[0] === u[1])) return fail(`onset ${u}`, units)
      } else {
        if (!ONSET2.has(key)) return fail(`onset ${key}`, units)
        clustersFirst = 1
      }
      if (final) return fail('no vowel', units)
      continue
    }
    if (final) {
      if (run.us.length === 1 ? !CODA1.has(key) : !CODA2.has(key)) return fail(`coda ${key}`, units)
      if (run.us.length === 2) clustersLast = 1
      continue
    }
    if (beforeE && silentEnd) {
      if (run.us.length === 1 ? !PRE_E1.has(key) : !PRE_E2.has(key)) return fail(`coda ${key}e`, units)
      if (run.us.length === 2) clustersLast = 1
      continue
    }
    if (beforeE && syllabicEnd) {
      if (run.us.length !== 2 || !PRE_LE.has(run.us[0]!.s)) return fail(`ending ${key}e`, units)
      continue
    }
    if (run.us.length === 2) {
      const [a, b] = [run.us[0]!.s, run.us[1]!.s]
      if (NO_CLOSE.has(a) || NO_OPEN.has(b)) return fail(`junction ${key}`, units)
      if (b === 'h' && !H_AFTER.has(a)) return fail(`junction ${key}`, units)
      if (b.length === 2 && b[0] === b[1]) return fail(`junction ${key}`, units)
      // a doubled letter only closes a syllable as ss, ll or ff (mossbo, dillwyn), never pebbkin or mammrab
      if (a.length === 2 && a[0] === a[1] && !'slf'.includes(a[0]!)) return fail(`junction ${key}`, units)
      if (AWKWARD.has(key) || sound(a) === sound(b)) return fail(`junction ${key}`, units)
    } else {
      const u = run.us[0]!.s
      if (u === 'ng' && !isVowel(runs[r + 1]?.us[0]?.s[0])) return fail('junction ng', units)
    }
  }
  if (syllables === 1 && clustersFirst + clustersLast > 1) return fail('two clusters in one syllable', units)
  return { reason: null, units, syllables }
}

/** Why a name breaks the phonotactic rules, or null when every word of it is fine. */
export function phonotactics(name: string): string | null {
  for (const w of name.trim().split(/\s+/)) {
    const r = analyse(w).reason
    if (r) return `${w}: ${r}`
  }
  return null
}

/** Spoken syllables (silent final e not counted). Two-word names add up. */
export function syllables(name: string): number {
  return name.trim().split(/\s+/).reduce((n, w) => n + analyse(w).syllables, 0)
}

/** 0..1: how sure a first-time reader is to say the name one way, comfortably. 0 when a hard rule is broken. */
export function pronounceability(name: string): number {
  const words = name.trim().split(/\s+/)
  let worst = 1
  for (const w of words) worst = Math.min(worst, wordScore(w))
  return worst
}

// Pure-function memo: the same strings come up again and again across candidates. Capped, so it cannot grow forever.
function memo<T>(fn: (s: string) => T): (s: string) => T {
  let cache = new Map<string, T>()
  return (s: string): T => {
    const hit = cache.get(s)
    if (hit !== undefined || cache.has(s)) return hit as T
    if (cache.size >= 50000) cache = new Map()
    const v = fn(s)
    cache.set(s, v)
    return v
  }
}

const wordScore = memo(scoreWord)
const analyse = memo(analyseWord)

// A syllable said twice (ro-wor-row, cra-ga-ga) is a stutter: the same consonant before the same vowel.
function repeatsSyllable(us: Unit[]): boolean {
  const seen = new Set<string>()
  for (let i = 0; i + 1 < us.length; i++) {
    const c = us[i]!
    const v = us[i + 1]!
    if (c.v || !v.v || v.silent) continue
    const cs = c.s.length === 2 && c.s[0] === c.s[1] ? c.s[0]! : c.s
    const key = `${sound(cs)}|${v.s[0]}`
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

// The sound class of a vowel spelling, so y and i, or oa and o, count as the same vowel.
function vowelClass(v: string): string {
  if (v === 'y' || v === 'i' || v === 'ie') return 'i'
  if (v === 'e' || v === 'ee' || v === 'ea' || v === 'ey') return 'e'
  if (v === 'a' || v === 'ai' || v === 'ay') return 'a'
  if (v === 'o' || v === 'oa' || v === 'ow') return 'o'
  if (v === 'u' || v === 'oo' || v === 'ou' || v === 'ew' || v === 'ue') return 'u'
  return v
}
// The consonant sound that closes a syllable: a double counts once, ng and nk are their g and k
function closeSound(c: string): string {
  const one = c.length === 2 && c[0] === c[1] ? c[0]! : c
  if (one === 'ng') return 'g'
  if (one === 'nk' || one === 'ck' || one === 'c' || one === 'q') return 'k'
  return one
}

/**
 * A rhyme said twice is a stutter too (gong-og, seal-teal, lyr-irr, gull-il): 0..1, 1 when there is none. Each
 * vowel's syllable is closed by the consonant after it when that consonant cannot open the next syllable (two
 * consonants, a double, ng, the end of the name).
 */
function rhymeEcho(us: Unit[], syl: number): number {
  const rimes: { v: string; close: string | null }[] = []
  for (let i = 0; i < us.length; i++) {
    const u = us[i]!
    if (!u.v || u.silent) continue
    let j = i + 1
    const run: string[] = []
    while (j < us.length && !us[j]!.v) run.push(us[j++]!.s)
    const atEnd = j >= us.length || us[j]!.silent === true
    const first = run[0]
    const closed = first !== undefined &&
      (run.length >= 2 || atEnd || (first.length === 2 && first[0] === first[1]) || NO_OPEN.has(first))
    rimes.push({ v: vowelClass(u.s), close: closed ? closeSound(first) : null })
  }
  let s = 1
  for (let k = 0; k + 1 < rimes.length; k++) {
    const a = rimes[k]!
    const b = rimes[k + 1]!
    if (!a.close || a.close !== b.close) continue
    // the same rhyme twice (gong-og, seal-teal), or in a short name the same close after two vowels (gull-il)
    if (a.v === b.v) s *= 0.5
    else if (syl <= 2) s *= 0.7
  }
  // a vowel, a consonant, the same vowel and the same consonant again (lyr-irr-us)
  for (let i = 0; i + 3 < us.length; i++) {
    const [v1, c1, v2, c2] = [us[i]!, us[i + 1]!, us[i + 2]!, us[i + 3]!]
    if (!v1.v || c1.v || !v2.v || c2.v || v2.silent) continue
    if (vowelClass(v1.s) === vowelClass(v2.s) && closeSound(c1.s) === closeSound(c2.s)) s *= 0.5
  }
  return s
}

function scoreWord(word: string): number {
  const a = analyse(word)
  if (a.reason) return 0
  const w = word.toLowerCase()
  const us = a.units
  // stutters are never names: a repeated chunk (lala, oror), one consonant echoing (titit), a syllable said twice
  if (/([a-z]{2,4})\1/.test(w) || /([^aeiou])[aeiouy]\1[aeiouy]\1/.test(w) || repeatsSyllable(us)) return 0
  const syl = a.syllables
  const len = w.length
  let s = 1
  s *= syl === 1 ? 0.55 : syl <= 4 ? 1 : syl === 5 ? 0.5 : 0.2
  s *= len < 4 ? 0.7 : len <= 11 ? 1 : len === 12 ? 0.85 : 0.55
  // vowel / consonant balance by letters
  let consLetters = 0
  for (const u of us) if (!u.v) consLetters += u.s.length
  const ratio = consLetters / len
  s *= 1 - 1.8 * Math.max(0, ratio - 0.64) - 1.4 * Math.max(0, 0.38 - ratio)
  const perSyl = len / syl
  if (perSyl > 4) s *= 1 - 0.22 * (perSyl - 4)
  // clusters: allowed, but each one costs a little
  let clusters = 0
  let digraphs = 0
  let hiatus = 0
  for (let i = 0; i < us.length; i++) {
    const u = us[i]!
    const next = us[i + 1]
    if (!u.v && next && !next.v) clusters++
    if (u.v && next?.v) hiatus++
    if (u.v && u.s.length === 2) digraphs++
    // soft c and g read two ways (cinder / cat, gem / get)
    if ((u.s === 'c' || u.s === 'g') && next?.v && 'eiy'.includes(next.s[0]!)) s *= u.s === 'g' ? 0.62 : 0.8
    // a doubled consonant after a long vowel looks misspelt (deell, mooss)
    if (u.v && u.s.length === 2 && next && !next.v && next.s.length === 2 && next.s[0] === next.s[1]) s *= 0.8
    if (u.v && u.s === 'ou') s *= 0.85
    if (u.v && u.s === 'ow' && next && !next.v) s *= 0.94
    if (u.v && u.s === 'ea') s *= 0.95
    if (u.v && u.s === 'y' && i > 0 && i < us.length - 1) s *= 0.96
    // a vowel pair, one consonant and -ew blur where the syllables split (bea-newt or bean-ewt)
    const after = us[i + 2]
    if (u.v && u.s.length === 2 && next && !next.v && next.s.length === 1 && after?.v && after.s === 'ew') s *= 0.55
  }
  s *= 0.95 ** clusters
  s *= 0.85 ** hiatus
  if (/eo|ua/.test(w)) s *= 0.9
  if (digraphs > 1) s *= 0.93 ** (digraphs - 1)
  const end = us[us.length - 1]!
  if (end.s === 'i') s *= 0.9
  if (end.s === 'u') s *= 0.6
  if (end.s === 'c') s *= 0.85
  if (!end.v && end.s.length === 2 && end.s[0] === end.s[1] && !'lsf'.includes(end.s[0]!)) s *= 0.9
  // endings that read more than one way: -yr (eer? ur? ire?), and -rl or -lm after a short vowel (gul-larl, min-elm)
  if (/yr$/.test(w)) s *= 0.55
  if (/rl$/.test(w) && syl >= 2) s *= 0.6
  if (/[aeiuy]lm$/.test(w)) s *= 0.6
  // rare letters
  for (const ch of w) if ('jqxz'.includes(ch)) s *= 0.88
  for (let i = 1; i < us.length - 1; i++) {
    const u = us[i]!
    const prev = us[i - 1]!
    const next = us[i + 1]!
    // a glide between vowels reads as a diphthong first (loroyane), so it is a weaker spelling
    if (!u.v && (u.s === 'y' || u.s === 'w') && prev.v && next.v) s *= u.s === 'y' ? 0.75 : 0.93
    // a stop running into another stop or a nasal is hard to say (pupmip, coppko)
    if (!u.v && !prev.v && STOPS.has(prev.s) && (STOPS.has(u.s) || u.s === 'm' || u.s === 'n')) s *= 0.85
    if (!u.v && !prev.v && FRICATIVES.has(prev.s) && (u.s === 'm' || u.s === 'n')) s *= 0.85
  }
  // the opening echoing later (tarratar, mossossom) or a closing echo (crowmum, moorwow)
  if (len >= 6 && w.slice(3).includes(w.slice(0, 3))) s *= 0.6
  if (/([bcdfghjklmnpqrstvwxz])[aeiouy]+\1$/.test(w) && len >= 5) s *= 0.65
  if (/th[aeiouy]+th/.test(w)) s *= 0.7
  if (/([^aeiouy])\1[aeiouy]{1,2}([^aeiouy])\2/.test(w)) s *= 0.75
  if (/(..).\1$/.test(w)) s *= 0.75
  if (/(.)\1.{1,2}\1\1/.test(w)) s *= 0.7
  if (/ng[aeiouy]+ng/.test(w)) s *= 0.5
  s *= rhymeEcho(us, syl)
  return Math.max(0, Math.min(1, s))
}

// ---------------------------------------------------------------------------------------------------------------
// Blocklists. Everything is lowercase. A name is checked word by word and whole.

function words(s: string): string[] {
  return s.split(/\s+/).filter(Boolean)
}

// rude words, slurs, drugs, diseases and body words, blocked anywhere inside a name
const PROFANE = words(`
  fuck shit cunt bitch dick cock piss slut whore twat wank tits titt porn rape nazi fag nigg anus penis vagin boob
  butt poop turd damn crap arse jizz puss pube anal sperm semen dildo clit nipple orgy horny kinky smut skank slag
  retard spaz chink coon gook kike dyke homo tranny paki negro hitler slave bollock bugger spunk minge milf thot
  nonce wop crotch scrot bastard bloody douche ballsack scum meth oral goon sick mess lol pee smok mother grandad pud
  nud troll mammon lilit lilim lilin stoner weed hell rapin rapist tard pimp covid orvid plague leper vomit gimp`)
// short ones only matter at the very start or end (glass and titan are fine)
const PROFANE_EDGE = words(`ass tit cum poo fap sex gay jap spic kkk fart knob bum wee nob pus`)
// The same words by sound: k and c as one letter, doubles as one, x as ks, so Tuskock, Bullox and Ebbay are caught
const RUDE_SOUNDS: readonly RegExp[] = [
  /ko+k/, /d[iy]k/, /fu+k/, /ku+nt/, /sh[iy]t/, /t[aeiou]+rd/, /rap[eiy]/, /pimp/, /b[aeiou]l[aeiou]+ks/, /^eba[yi]/,
  /w(?:ei|ee|ie|y|ea)rdo/, /^aldi/, /pl[aeiou]v[iy]ks/, /ko+v[iy]d/, /orvid/, /^we[ae]s/, /^kil/, /tw[ao]t/,
  /wa+nk/, /^kum|kum$/, /go+k$/, /^ars/, /ars$/, /^pis/, /^peni/, /^kak/, /^fa+g/,
]
/** A spelling reduced to its sound: k for c and ck, f for ph, ks for x, every doubled consonant single. */
function soundSpelling(w: string): string {
  return w.replace(/ck/g, 'k').replace(/c(?![eiy])/g, 'k').replace(/ph/g, 'f').replace(/qu/g, 'kw').replace(/x/g, 'ks')
    .replace(/([bcdfghjklmnpqrstvwxz])\1+/g, '$1')
}
// developer, machine and internet words: the game has no programming puns anywhere (SPEC section 2)
const DEV = words(`
  code debug byte pixel sprite cache stack query regex json html java python rust ruby perl lisp swift kotlin
  scala dart kernel token server client deploy commit merge branch linux unix array lambda async null void bool
  float tensor vector matrix neural prompt claude anthropic agent shell bash sudo cron daemon thread socket
  packet router cookie widget macro script loop fork node react docker yaml repo glitch binary hash queue heap
  cyber robo droid admin login cursor spam noob meme wifi vibe data tech model test parse compile build patch
  modem laser turbo mega giga nano inet runet basic baseline core torrent orrent nite logic online emoji purl
  toolkit tulkit kerberos mistral oracle eclipse obsidian tortoise capybara mamba tinder komodo thunderbird`)
const DEV_EDGE = words(`git bug npm api sql css cpu gpu bot ping mock stub spec web app dev tool awk`)
// internet words that only bite at the end of a name (nimbinet, shalog, rabbit is fine)
const DEV_END = words(`net log bit ware tron exe`)
// endings that read as a stock suffix, a hesitation, a sound effect or a phrase (Bullug, Charmum, Rookick, Reedover)
const BAD_END = words(`um ug ick ee uffin over under lover omen arrow ond goblin ombat auk esk bag bad sad mad tax dud rot rut
  sag sob gut gag nag hag lag god turne yl ane ine`)
// endings that imitate a famous creature franchise
const FRANCHISE_ENDINGS = words(`mon chu saur zard eon pod puff mander dude gotchi nyan pix tuff chomp lax achu tops nado`)
// famous creatures, characters and brands. A name within edit distance 2 of any of these is rejected, and so is a
// name that holds any of the longer ones.
const FRANCHISE = words(`
  bulbasaur ivysaur venusaur charmander charmeleon charizard squirtle wartortle blastoise caterpie metapod
  butterfree weedle kakuna beedrill pidgey pidgeotto pidgeot rattata raticate spearow fearow ekans arbok pikachu
  raichu sandshrew sandslash nidoran nidorina nidoqueen nidorino nidoking clefairy clefable vulpix ninetales
  jigglypuff wigglytuff zubat golbat oddish gloom vileplume paras parasect venonat venomoth diglett dugtrio meowth
  persian psyduck golduck mankey primeape growlithe arcanine poliwag poliwhirl poliwrath abra kadabra alakazam
  machop machoke machamp bellsprout weepinbell victreebel tentacool tentacruel geodude graveler golem ponyta
  rapidash slowpoke slowbro magnemite magneton farfetchd doduo dodrio seel dewgong grimer muk shellder cloyster
  gastly haunter gengar onix drowzee hypno krabby kingler voltorb electrode exeggcute exeggutor cubone marowak
  hitmonlee hitmonchan lickitung koffing weezing rhyhorn rhydon chansey tangela kangaskhan horsea seadra goldeen
  seaking staryu starmie scyther jynx electabuzz magmar pinsir tauros magikarp gyarados lapras ditto eevee
  vaporeon jolteon flareon porygon omanyte omastar kabuto kabutops aerodactyl snorlax articuno zapdos moltres
  dratini dragonair dragonite mewtwo mew chikorita bayleef meganium cyndaquil quilava typhlosion totodile croconaw
  feraligatr togepi togetic marill azumarill sudowoodo hoppip skiploom jumpluff aipom sunkern umbreon espeon
  murkrow misdreavus unown wobbuffet girafarig pineco dunsparce gligar steelix snubbull qwilfish scizor shuckle
  heracross sneasel teddiursa ursaring slugma swinub corsola remoraid octillery delibird mantine skarmory houndour
  houndoom kingdra phanpy donphan smeargle tyrogue miltank blissey raikou entei suicune larvitar pupitar tyranitar
  lugia celebi treecko grovyle sceptile torchic combusken blaziken mudkip marshtomp swampert poochyena zigzagoon
  wurmple lotad seedot taillow wingull ralts kirlia gardevoir surskit shroomish slakoth nincada whismur makuhita
  azurill nosepass skitty sableye mawile aron lairon aggron meditite electrike plusle minun volbeat illumise
  roselia gulpin carvanha wailmer numel torkoal spoink spinda trapinch vibrava flygon cacnea swablu altaria
  zangoose seviper lunatone solrock barboach corphish baltoy lileep anorith feebas milotic castform kecleon
  shuppet duskull dusclops tropius chimecho absol wynaut snorunt glalie spheal sealeo walrein clamperl relicanth
  luvdisc bagon shelgon salamence beldum metang metagross regirock regice registeel latias latios kyogre groudon
  rayquaza jirachi deoxys turtwig grotle torterra chimchar monferno infernape piplup prinplup empoleon starly
  staravia staraptor bidoof kricketot shinx luxio luxray budew roserade cranidos shieldon burmy combee pachirisu
  buizel cherubi shellos drifloon buneary glameow chingling stunky bronzor bonsly happiny chatot spiritomb gible
  gabite garchomp munchlax riolu lucario hippopotas skorupi croagunk carnivine finneon mantyke snover abomasnow
  weavile magnezone rhyperior tangrowth electivire magmortar togekiss yanmega leafeon glaceon gliscor mamoswine
  gallade probopass dusknoir froslass rotom uxie mesprit azelf dialga palkia heatran regigigas giratina cresselia
  phione manaphy darkrai shaymin arceus victini snivy servine serperior tepig pignite emboar oshawott dewott
  samurott patrat lillipup purrloin pansage munna pidove blitzle roggenrola woobat drilbur audino timburr tympole
  sewaddle venipede cottonee petilil basculin sandile darumaka maractus dwebble scraggy sigilyph yamask tirtouga
  archen trubbish zorua zoroark minccino gothita solosis ducklett vanillite deerling emolga karrablast foongus
  frillish alomomola joltik ferroseed klink tynamo elgyem litwick lampent chandelure axew fraxure haxorus cubchoo
  cryogonal shelmet stunfisk mienfoo druddigon golett pawniard bouffalant rufflet vullaby heatmor durant deino
  hydreigon larvesta volcarona cobalion terrakion virizion tornadus thundurus reshiram zekrom landorus kyurem
  keldeo meloetta genesect chespin quilladin chesnaught fennekin braixen delphox froakie frogadier greninja
  bunnelby fletchling talonflame scatterbug vivillon litleo pyroar flabebe floette florges skiddo pancham furfrou
  espurr honedge aegislash spritzee swirlix inkay binacle skrelp clauncher helioptile tyrunt amaura sylveon
  hawlucha dedenne carbink goomy sliggoo goodra klefki phantump pumpkaboo bergmite noibat noivern xerneas yveltal
  zygarde diancie hoopa volcanion rowlet dartrix decidueye litten torracat incineroar popplio brionne primarina
  pikipek yungoos grubbin crabrawler oricorio cutiefly rockruff lycanroc wishiwashi mareanie mudbray dewpider
  fomantis morelull salandit stufful bounsweet comfey oranguru passimian wimpod sandygast pyukumuku silvally
  minior komala turtonator togedemaru mimikyu bruxish drampa dhelmise jangmoo kommoo solgaleo lunala necrozma
  marshadow zeraora meltan melmetal grookey thwackey rillaboom scorbunny raboot cinderace sobble drizzile
  inteleon skwovet rookidee corviknight blipbug nickit gossifleur wooloo chewtle drednaw yamper rolycoly carkol
  coalossal applin flapple appletun silicobra cramorant arrokuda toxel toxtricity sizzlipede clobbopus sinistea
  hatenna hattrem hatterene impidimp morgrem grimmsnarl obstagoon cursola runerigus milcery alcremie falinks
  pincurchin snom frosmoth stonjourner eiscue indeedee morpeko cufant copperajah duraludon dreepy drakloak
  dragapult zacian zamazenta eternatus kubfu urshifu zarude calyrex wyrdeer kleavor ursaluna sneasler enamorus
  sprigatito floragato meowscarada fuecoco crocalor skeledirge quaxly quaxwell quaquaval lechonk tarountula nymble
  pawmi tandemaus fidough smoliv squawkabilly nacli charcadet tadbulb wattrel maschiff shroodle bramblin
  toedscool klawf capsakid rellor flittle tinkatink wiglett bombirdier finizen varoom cyclizar orthworm glimmet
  greavard flamigo cetoddle veluza dondozo tatsugiri clodsire farigiraf kingambit frigibax gimmighoul koraidon
  miraidon pokemon digimon agumon gabumon patamon tentomon palmon gomamon biyomon tailmon gatomon veemon
  guilmon renamon terriermon impmon jibanyan komasan temtem neopets kougra kacheek shoyru zafara usul chomby
  gelert moehog wocky kyrii scorchio meerca grarrl mocchi suezo tamagotchi furby moomin smurf gremlin totoro
  catbus kodama ponyo calcifer stitch simba nala timon pumbaa dumbo bambi thumper baymax elmo grover kermit gonzo
  ewok wookiee chewbacca yoda grogu porg jawa tribble gollum smaug shrek minion kirby yoshi mario luigi bowser
  goomba koopa wario waluigi zelda navi epona korok sonic spyro banjo kazooie rayman pacman metroid samus
  pikmin chocobo moogle cactuar tonberry pusheen kuromi cinnamoroll pompompurin keroppi rilakkuma doraemon
  hamtaro snoopy garfield odie scooby pluto goofy mickey minnie daffy tweety pingu barney teletubby tinky dipsy
  laalaa paddington pooh tigger eeyore gruffalo grinch lorax hobbit ninja disney pixar nintendo sega sony lego
  nike adidas pepsi coca google tesla barbie hasbro mattel nestle gucci prada rolex ikea xbox playstation twitch
  reddit tiktok youtube netflix hulu spotify uber lyft visa oreo skittles kitkat haribo twix mentos fanta doritos
  cheetos pringles nerf roblox minecraft fortnite starbucks mcdonald pokeball
  gondor mordor aladdin aladin riversong pippin flicky granok merlin gandalf
  sauron balrog narnia hedwig hogwarts gryffindor slytherin hufflepuff ravenclaw thestral hippogriff buckbeak
  fawkes nagini mothra godzilla gamera thanos falkor atreyu toothless stormfly hookfang meatlug owlbear beholder
  tarrasque bahamut tiamat zergling hydralisk ultralisk mutalisk murloc sharknado timbermaw wolverine flounder
  sebastian ursula tinkerbell maleficent ridley aragorn legolas samwise rivendell`)
// short famous names: blocked when a name is or holds one, without the edit-distance halo that would catch half the
// two-syllable names in the language
const FAMOUS_SHORT = words(`
  dobby appa halo nemo rodan groot artax ganon gimli frodo bilbo aslan dory fernet mintel ribena rbena drizzy elmo
  ewok yoda grogu gundam muppet inkling twiglet elfo elfen fennix fenix goyle aldi ebay lidl tesco plavix oberon
  alcon erbil fanta`)
// Edit distance 2 from a famous name of seven letters or more (Pikachoo, Bulbasar); a shorter famous name allows one
// edit (Eeveel, Gengor) and a four-letter one must match exactly, or the rule would catch half the two-syllable names
// in the language (Mossin is two edits from Moomin, Fernip two from Fernet).
function franchiseReach(len: number): number {
  return len >= 7 ? 2 : len >= 5 ? 1 : 0
}
const bigrams = (w: string): Set<string> => {
  const out = new Set<string>()
  for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2))
  return out
}
const FRANCHISE_GRAMS = new Map(FRANCHISE.map(f => [f, bigrams(f)]))
// Famous names by a few of their rarest letter pairs: r edits break at most 2r pairs, so a name within reach of a
// famous one still holds one of any 2r + 1 of its pairs, and only names holding one get measured.
const GRAM_COUNT = new Map<string, number>()
for (const gs of FRANCHISE_GRAMS.values()) for (const g of gs) GRAM_COUNT.set(g, (GRAM_COUNT.get(g) ?? 0) + 1)
const BY_GRAM = new Map<string, string[]>()
for (const [f, gs] of FRANCHISE_GRAMS) {
  const rare = [...gs].sort((a, b) => GRAM_COUNT.get(a)! - GRAM_COUNT.get(b)!).slice(0, 2 * franchiseReach(f.length) + 1)
  for (const g of rare) (BY_GRAM.get(g) ?? BY_GRAM.set(g, []).get(g)!).push(f)
}
const FRANCHISE_SET = new Set(FRANCHISE)
// famous names that hide inside a longer name even with one letter changed (Mammondor holds a near Gondor)
const FAMOUS_CHUNKS = words(`
  gondor mordor aladdin aladin hobbit pippin merlin gandalf sauron balrog narnia ribena pikachu charizard gollum
  smaug totoro mothra godzilla gengar snorlax rivendell hogwarts gremlin mewtwo`)

// Common English words (and their plain forms) are never names: a creature called Ribbon or Mellow reads as a typo.
const COMMON = new Set(words(`
  able about above across act action actually add after again against age ago agree air all allow almost alone
  along already also although always among amount and animal another answer any anyone anything appear apply
  area argue arm army around arrive art article artist ask attack attention author avoid away baby back bad bag
  ball bank bar base battle beat beautiful because become bed before begin behind believe below best better
  between beyond big bill bird bit black blood blue board body book born both box boy break bring brother brown
  build building business but buy call camera campaign cancer candle capital car card care career carry case catch
  cause cell center central century certain chair challenge chance change character charge check child choice
  choose church citizen city civil claim class clear close coach cold collection college color come common
  community company compare computer concern condition conference consider contain continue control cost could
  country couple course court cover create crime culture cup current customer cut dark data daughter day dead deal
  death debate decade decide decision deep defense degree describe design despite detail determine develop
  difference different difficult dinner direction director discover discuss disease doctor dog door down draw
  dream drive drop during each early east easy eat economy edge education effect effort eight either election
  else employee end energy enjoy enough enter entire especially establish even evening event ever every
  everybody everyone everything evidence exactly example exist expect experience expert explain eye face fact
  factor fail fall family far fast father fear federal feel feeling few field fight figure fill film final finally
  find fine finger finish fire firm first fish five floor fly focus follow food foot for force foreign forget form
  former forward four free friend from front full fund future game garden gas general get girl give glass goal good
  great green ground group grow growth guess gun guy hair half hand hang happen happy hard have head health hear
  heart heat heavy help her here herself high him himself his history hit hold home hope hospital hot hotel hour
  house how however huge human hundred husband idea image imagine impact important improve include increase indeed
  indicate industry inside instead interest into issue item itself job join just keep key kid kill kind kitchen
  know land language large last late later laugh law lawyer lay lead leader learn least leave left leg legal less
  let letter level lie life light like likely line list listen little live local long look lose loss lot love low
  machine magazine main major make man manage manager many market marriage material matter may maybe mean measure
  media medical meet meeting member memory mention message method middle might military million mind minute miss
  mission modern moment money month more morning most mother mouth move movement movie much music must myself name
  nation native natural nature near nearly need never news next nice night none nor north not note nothing notice
  now number occur off offer office officer often oil okay old once only onto open option order other others our
  out outside over own owner page pain painting paper parent part partner party pass past patient pattern pay peace
  people perform perhaps period person phone pick picture piece place plan plant play player point police policy
  poor popular position possible power practice prepare present president pressure pretty prevent price private
  probably problem process produce product program project property protect prove provide public pull purpose push
  put quality question quickly quite race radio raise range rate rather reach read ready real reality realize
  really reason receive recent record red reduce reflect region relate remain remember remove report represent
  require research resource respond rest result return reveal rich right rise risk road rock role room rule run
  safe same save say scene school science score sea season seat second section security see seek seem sell send
  senior sense series serious serve service set seven several shake share she shoot short shot should shoulder
  show side sign similar simple simply since sing single sister sit site situation six size skill skin small smile
  social society soldier some somebody someone something sometimes son song soon sort sound source south space
  speak special speech spend sport spring staff stage stand standard star start state station stay step still stock
  stop store story street strong structure student study stuff style subject success such suddenly suffer suggest
  summer support sure surface system table take talk task tax teach teacher team television tell ten tend term than
  thank that their them then theory there these they thing think third this those though thought thousand threat
  three through throw thus time today together tonight too top total tough toward town trade training travel treat
  tree trial trip trouble true truth try turn type under understand unit until upon use usually value various very
  victim view visit voice vote wait walk wall want war watch water way weapon wear week weight well west western
  what whatever when where whether which while white who whole whom whose why wide wife will win wind window wish
  with within without woman wonder word work worker world worry would write writer wrong yard yeah year yes yet you
  young your yourself
  acorn alder amber anchor angel ankle antler apple apron arrow ashen aspen attic autumn badger bagel ballad bamboo
  bandit banner banter barley barrel basil basin basket beacon beaker beaver bellow belly berry billow biscuit
  bitter blanket blossom bobbin bonnet bottle boulder bramble brandy breeze bridle bristle broken bubble bucket
  buckle bumble bundle burrow butter button cabin cactus camel candy canyon carrot castle cattle cavern cellar cherry
  chicken chimney chisel cinder circle clover cobble cobweb collar comet copper coral cotton cradle crimson cricket
  crystal cuddle curtain cushion dagger daisy dapple dazzle denim desert dimple dipper doodle dragon dreamy drizzle
  duckling dusky dwindle eager eagle ember emerald ermine fable falcon fallow feather fennel ferret fiddle fidget
  finch flannel flicker flutter fodder forest fossil fountain frosty funnel furrow gable gallop garlic garnet gentle
  giggle ginger glimmer glitter goblin golden gopher gossip gravel griffin grizzly hammer hamster hazel heather
  hedge hermit heron hollow honey hopper hornet hunter husky icicle igloo jasper jelly jester jigsaw jingle jolly
  juniper kennel kernel kettle kindle kitten ladder lagoon lantern larder lavender leather lemon lentil lily linen
  lion lizard locket lotus lumber magpie mallow mammoth mango maple marble marrow marsh meadow melody mellow melon
  mettle midge minnow mitten molten monarch morsel mossy muffin mussel mustard muzzle napkin nectar needle nettle
  nibble nimble noodle nugget nutmeg oyster paddle panda pansy parrot pastel pebble pepper petal pickle pigeon
  pillow pinecone pistol pixie plover plum pocket poodle poppy porridge possum potter powder pretzel prickle puddle
  puffin pumpkin puppet puppy quiver rabbit raccoon radish raisin rascal raven ribbon riddle ripple river robin
  rocket rubble rudder rumble russet saddle saffron salmon sandal satin scarlet sorrel sparrow spider spindle
  sprinkle squirrel starling stubble sugar summit sunny supper swallow tadpole talon tangle tassel tattle teapot
  temple thimble thistle thunder ticket timber tinker toffee tomato topaz tulip tumble tunnel turnip turtle tusk
  twinkle umber velvet violet waffle walnut walrus weasel whisker whistle wicker widget willow wimple winter wizard
  wobble yellow yonder zephyr pippin melon lemon wagon salon baron bacon canon tenor manor valor rumor humor tumor
  motor rotor minor donor honor sailor tailor pallor ardor vapor raptor slumber member bladder shudder udder fodder
  coffin toxin latin cousin dozen siren heaven haven ripen bitten written rotten mutton glutton lesson fellow
  follow widow elbow narrow barrow sparrow sorrow borrow morrow tallow shallow wallow callow hallow sallow gallon
  flagon sermon demon cannon gibbon carbon bourbon pardon warden burden wooden sudden hidden ridden linden pattern
  tavern eastern bracken socket thicket picket wicket planet helmet ballet fillet mallet pallet wallet gullet
  bullet mullet pellet skillet millet rivet linnet sonnet hornet magnet carpet trumpet limpet tablet goblet hamlet
  piglet eaglet owlet droplet leaflet booklet ringlet rivulet pimple ample staple cable sable noble bible dabble
  babble kibble scribble hobble gobble bobble waddle muddle huddle beetle settle throttle wiggle jiggle juggle
  snuggle haggle goggle toggle tickle sickle fickle trickle chuckle knuckle tipple topple grapple purple hurtle
  myrtle fertile hustle bustle rustle tussle muscle vessel tinsel diesel easel pencil stencil tonsil council mantle
  handle fondle swindle tingle mingle shingle bangle dangle jungle bungle angle sparkle wrinkle tinkle meddle
  pedal medal metal petal rebel level bevel camel hazel motel hotel model novel panel funnel tunnel kennel fennel
  bagel label mabel easel chapel cancel parcel gravel travel marvel vowel towel bowel jewel duel fuel cruel gruel
  pupil tulip civil devil evil peril april basil fossil lentil nostril pistil tendril stencil
  dewy ferny pebbly misty foggy rainy windy stormy sunny cloudy rocky stony leafy woody grassy sandy muddy dusty
  hilly mossy thorny briny salty silky silly fluffy puffy tufty minty hazy smoky ashy inky murky gloomy dusky
  shady starry moony lunar solar polar sonar coral floral dimly gladly
  bloom bud seed leaf petal stem root twig branch bark bough thorn moss fern reed rush sedge weed herb mint sage
  thyme dill cress clover daisy poppy lily rose tulip iris violet pansy aster orchid lotus willow alder aspen birch
  elm oak ash yew pine fir cedar maple hazel holly ivy rowan beech linden larch cypress brook rill creek river
  stream pond pool lake mere marsh fen bog mire swamp tide wave foam spray surf shore beach cove bay sea ocean mist
  fog cloud rain drizzle hail snow frost dew breeze wind gust gale storm thunder lightning sky dawn dusk noon
  twilight night moon star sun comet ember cinder spark flame blaze fire ash smoke coal soot flint stone rock
  pebble boulder crag cliff peak ridge hill dune vale glen dale dell gorge canyon cave cavern mound tor cairn
  barrow fox hare rabbit bunny mouse vole shrew mole otter beaver badger weasel stoat ferret mink marten bear wolf
  lynx deer stag doe fawn elk moose boar bull ram goat sheep lamb pony horse colt foal mule bison ox yak owl crow
  raven rook jay wren finch robin lark swan duck goose gull tern heron crane stork hawk kite falcon eagle dove
  pigeon sparrow swallow swift newt toad frog snail slug moth bee wasp ant gnat midge beetle cricket spider worm
  eel trout pike carp minnow salmon perch crab shell pearl coral kelp
  ruby amber jade opal onyx garnet topaz agate jasper quartz silver gold copper bronze brass iron tin lead
  harp lute lyre flute horn drum gong bell chime fife pipe reed song tune hymn ode verse rhyme ballad carol aria
  hush murmur whisper echo sigh hum lull lilt trill croon
  rune myth tale fable lore spell charm hex omen fate wyrd wraith ghost spirit shade shadow gloom murk haze wisp
  glimmer glow gleam shimmer lantern candle wick tallow torch
  giant titan dragon wyvern griffin golem ogre troll goblin gnome elf fairy pixie sprite imp hob bogey banshee
  kelpie selkie siren sphinx kraken hydra unicorn phoenix
  tiny little small wee teeny dainty grand great mighty huge vast noble royal regal brave bold wild fierce proud
  gentle soft quiet calm still swift quick nimble sly shy merry jolly lucky sunny gloomy
  bitty kitty pinky dinky winky blinky twinkly sparky spooky creepy
  twilit verso versa bullock peacock tuscan cornette burette pipette rosette barrette brunette cassette gazette
  palette coven tideline granny ethane methane butane propane octane nitwit eland island lowland upland inland midland
  galore gallon pylon nylon talent tablet ballot bigot carrot parrot ferret turret garret lancet basset
  petite parade palace malice police notice novice justice office service venice lettuce
  potato tornado volcano avocado armada lasso cameo rodeo patio radio studio piano banjo cello solo
  limbo bingo mango tango jumbo dynamo gecko hero zero halo echo mayo memo photo ego
  aroma drama llama comma dogma karma sauna tuna puma koala panda cobra zebra opera camera
  salad ballad valid vivid timid rapid humid lucid stupid cupid squid acid solid
  lotto ditto motto ghetto grotto bravo bimbo combo gran rump gravy
  humane rubber basket combat muffin baseline pudding mustang marina sonata melody harmony cardinal emperor
  pelican flamingo mermaid dolphin tempest cascade cadence anthem alto osprey egret otter iris onyx eclipse
  serpent panther mantis goblin warlock gorgon hemlock solstice nocturne chimera talisman amulet elixir oracle
  nebula labyrinth equinox impala antelope gazelle parakeet kestrel goshawk peregrine hyacinth marigold
  columbine gossamer cicada daffodil camomile larkspur bobolink siskin chipmunk lapwing wagtail poppet waxwing
  marmot chaffinch primrose locust dormouse foxglove bantam shamrock whinchat curlew mistral marlin narwhal
  whimbrel petrel lamprey minstrel nimbus mallard monsoon cantor serenade nautilus cormorant mandolin beluga
  medusa carillon avocet sirocco soprano clarion barnacle warthog furnace tortoise centaur gargoyle rampart
  cauldron kraken bulwark buzzard hornbill mastiff stallion fortress colossus mastodon monolith citadel minotaur
  crocodile behemoth buffalo timpani pangolin porcupine gorilla komodo baritone hurricane obelisk armadillo
  mandrake vesper boggart kobold corvid grimalkin erebus basilisk revenant ocelot harlequin oberon morrigan`))
for (const w of words(`gusto cornel ladder mitten mister plummet pecan turn pest`)) COMMON.add(w)

// Words a generated name could spell, sound like or hold whole, found by running the dictionary scan in
// scripts/names.ts over every candidate the vocabulary can make (Drumur sounds like drummer, Peakar like pecker,
// Elmitten holds mitten), so the checks stay exact without shipping a dictionary.
const SCANNED = new Set(words(`
  adapt ailing alarm alibi altar alter amaze ambers ambient ambiguity ambit ambulate ambush amend amino arose
  badder barcarole barcode barkeep barkeeper barker barkers barking barleys barque barques beanbag beaned beaner
  beaners beanery beanies beaning beanpole bearable bearer bearers bearing beeline belate belayed beleaguer belief
  belier belittle bellboys bellman belted bender beneath benefit berate bereft beribbon beriberi berried berries
  beryl binder bisector biserial bismuth bistate blossoms bogan bogbean bogeyed bogeyman bogeys boggier boggy
  bogland bomber boolean boomed boomer boomers boomiest booming boomy boulders boules bourree braised braises
  brassard brasserie brasseries brasses brassier brassiest brassy breezed breezes breezeway breezier breeziest
  breezily breezing breezy brooked brooking brooklet brookside bubo bulbed bulbous bulbul bulged bulgier bulgiest
  bulging bulimia bulked bulla bulldog bulldogging bulldoze bulled bullfinch bullhorn bullier bulliest bullish
  bully bullyboy bumbag bumhole bureaucrat bureaus burial buried burier burring burros byssi byssus cairned carnage
  carnal carnality carnelian carnet carneying carnie carnies carnival carnivore chairman charmed charmer charmers
  charming choke chord chose clack clacked clade claimant claimed claimer clamber clammiest clammily clammy clamp
  clang clanger clank clapper claret clash clashed clasher clasp clasper classed classer classily clast clatter
  claviers clayey claymore cloaca cloaked cloaking cloakroom clocker clockers cloven cloves coaled coalmine cobbed
  cobber cobbers cobbing colander colas colder colic collagen collaging collarbone collard collars collate collator
  collector colleen collieries colliery collimate collinear collocate colloquial colonel colonially colonic colony
  coloration colossi colourer colourpoint copay copays coped copes copiers copilot coping copperas coppery copyable
  copyist cornea corneas corned corner corners corniest corning corny creased creaser creases crested crowbait
  crowbar crowd crowed crowing crown dapper daypack delve diddle dilate dilation dilator dillies dilly diluent
  dilutely drain drill drumbeat drumlin drummed drummer drummers drumming dwell ebbed ebbing ebony elfin elfish
  endow entail errand error essay eyeball eyeballed fernery fernier ferniest ferry fierier fiery figged figgy
  figment figural figuration figures figurine firearm fireball firebase firebox fired firelit fireman firepit firer
  fires firing flitters flitting flowed flower flowerier flowers flowery flowing flown foamed foamer foamiest foamy
  fogeyish fogeys fogged foggier foggily foment fomenter frill gaming garner garners garnish gimme gleaned gleaner
  gleaners gleaning glowed glower glowers glowiest glowing glowworm glowy gonged goulash grain gravamen graved
  graveled graven graver graves gravest gravid graving greed grill grime grimed grimes grimier grimiest griming
  grimly grimy gritted gritter gritters grittiest gritting gritty guested gulag gulled gulley gulleys gullible
  gully gustier gustily gusty hailed hailer hailers hairpin halal halalled hales halest halite hallmark hallo
  hallway halon halted halter halvers halyard hammerhead harped harper harpers harpies harping harpist harpoon
  harpooner harpy haste hayloft hazard hazed hazer hazers hazes haziest hazily hazing hinder hollowly holly horned
  horner horniest horning horny hushed hushes hushing imbibe immerse incant incline income incomer incubus incur
  incurious incurs inked inkiest inking inkwell innkeeper inquirer inquiry inquorate intent intern jaspers kelped
  kelpers kelping kobo kopeck labor lapel layer leafage leafed leafier leafiest libel lilted lilting limit liter
  litter loamier loamiest loamy looped looper loopiest loopy loupes loving lowdown lower lowly lullabies lulled
  lulus lumpy lurch lyres lyrical madder manilla manta master mental miner mintage minted minter minters mintiest
  modest molted molter molters molting monger moonbeam mooned mooning moonlit moonset moron mosaic moseyed moseys
  mossback mosses mossier mossiest mothball motherly mould moulder mower muffle mullah murker murkest murkily
  murmurer murmurous murmurs mythic mythical mythology nasty naval navel newer niche nimbi nookie nuclear nucleate
  nuclei nucleon nuked nukes nuking oaked oaken oakum oaten oatmeal ocarina occasion occult occupier occupy occurs
  octal octet okaying okays okras onshore onward otiose otters ottoman owlish palate palmer parley peaked peaky
  peccaries peccary pecker peckers peckish pecorino peculate pecuniary peekaboo peekaboos pekes permit phenology
  phenom piddle plumage plumb plumbed plumber plumbous plume plumed plumerias plumes plumier plumiest pluming
  plummer plummy plump plumy popery popes popover poppas popped popper poppers popping popularise populate
  possessing quarryman radar raincoat rained rainfall rainier rainiest raining randier ranees ranked readable
  readded readding readdress reader readerly readers readies readiest readily readmit readout recall redactor
  redcoat redden reddish redeem redeemer redial redialed redly redneck redound redrill reeducate reedy regret
  ridable ridding rider riders rides ridicule riled riles riparian ripely riper ripest ripoff ripped ripper rippers
  ripping roman rooked rookeries rookery rookie rookies rooking rotter ruckman sadder sailboat sailing sailorly
  sailors salaam salable salami salaries salary sales salesman salient saline salinity salivate sallower salted
  salter salubrity salute saluter salvers sapped sapper sappers sappiest sapping sappy satanist sealant sealed
  sealer sealers sedan sedate sedation seduce sedum seeded seeder seeders seediest seeding seedy selector selfie
  sellable selloff sellout shimmed shimmers shimmies shimming shimmy shine shiny shoaled shuffle simmer skull
  sleeted sleetier sleetiest sleeting sleety smite snowball snowcat snowed snowfall snowier snowing snowline
  snowman snowpack snowshed snowshoer snowsuit snowy soared soarer soaring somber soother sootier sootiest sooty
  sorer sores sorry souterrain spade spent spill spine spoon stain stair stairway stairwell stall stamp starch
  stare stared starer starers stares stargate staring starlet starve steak steal steelhead stern stiff stilt sting
  stink stint surfed surfeit surfer surfers surfing sutler sutures swanned swanning swirled swirliest swirly taboo
  tally taming tarnish taste theft thorned thornier thorniest thunderer thunderous thunders thundery timer tithe
  toadied toadies toadying toddler topper toreador torment toroid torqued torrent torrid torso torture torus trail
  train tufted tufter tufters tufting tumulus tusked tuskers tusking twigged twiggier twiggiest twigging twilled
  usher versatile versed verses verset versifier versify version versional versus wander wanders waning waste
  waster wheat whispers whopper wicked wickeder wickers wicking wickiup widow wikiquette wikis wived wives wiving
  yarned yarning`))
// short words that are heard when a name holds them across the join of its two parts (Mint + allaby holds tall)
const HEARD = new Set(words(`
  amen ammo bomb boss bummer chow dago darn deaf demo dent disk dole doll dolt dong doom drat dull fart flea fool
  foul germ gits glam glib gory goth grab guff guru harm hobo hole hoot howl huff icky imam info itch kick kink
  kiss lack lair lard lass lick limp lips loco logo lump lurk lust mall mama mesh moll moron muff musk mutt narc
  nick nooky ogle pail pant perm pert perv pill ping pits puff pulp putt rant rats sham smog spic spit spook spur
  stun tall tarp tart thug toady toss tush vape vile wart wigs wilt wimp womb wuss`))

// Two- and three-letter words that turn a name into a phrase when it splits around them (soot tax, am bag, oak ox).
const SHORT_WORDS = new Set(words(`
  ad ah am an as at aw ax be by do eh go ha he hi ho if in is it lo ma me my no of oh ok on or ow ox pa so to up
  us we ye yo
  act add ado aft age ago aid ail aim air all and any ape apt arc are ark arm art ash ask ate awe awl axe bad bag
  ban bar bat bay bed bee beg bet bib bid big bin bit boa bob bog boo bow box boy bud bug bum bun bus but buy bye
  cab cad can cap car cat cob cod cog con coo cop cot cow coy cry cub cud cue cup cur cut dab dad dam day den dew
  did die dig dim din dip doe dog don dot dry dub dud due dug dun duo dye ear eat ebb egg ego eke elf elk elm emu
  end era err eve ewe eye fad fan far fat fax fed fee fen few fib fig fin fir fit fix flu fly fob foe fog fop for
  fox fry fun fur gab gag gal gap gas gel gem get gig gin gnu god got gum gun gut guy gym had hag ham has hat hay
  hem hen her hew hid him hip his hit hob hoe hog hop hot how hub hue hug hum hut ice icy ill imp ink inn ion ire
  irk its ivy jab jag jam jar jaw jay jet jig job jog jot joy jug jut keg ken key kid kin kit lab lad lag lap law
  lax lay led leg let lid lie lip lit lob log lop lot low lug mad man map mar mat maw may men met mid mix mob mop
  mow mud mug mum nab nag nap nay net new nib nil nip nit nod nor not now nun nut oak oar oat odd ode off oft oil
  old one opt orb ore our out owe owl own pad pal pan pap par pat paw pay pea peg pen pep per pet pew pie pig pin
  pit ply pod pop pot pox pry pub pug pun pup pus put rag ram ran rap rat raw ray red rib rid rig rim rip rob rod
  roe rot row rub rug rum run rut rye sac sad sag sap sat saw say sea see set sew shy sin sip sir sit six ski sky
  sly sob sod son sow soy spa spy sty sub sue sum sun sup tab tad tag tan tap tar tax tea tee ten the thy tic tie
  tin tip toe ton too top tot tow toy try tub tug tun two urn use van vat vet vex via vie vow wad wag war was wax
  way web wed wee wet who why wig win wit woe wok won woo wow yak yam yap yaw yen yes yet yew you zap zen zip zoo`))

// first names and nicknames: a creature should never read as a person (Caty, Emmie, Bobbill)
const NAMES = new Set(words(`
  aaron abby adam alan albert alex alfie alice amy andy angus anna annie archie arlo arthur ava barry ben benny bert
  beth betty bill billy bob bobby bonnie brad brian bruce bud buddy carl carla carol carrie cathy caty katy kate
  katie charlie chloe chris cindy claire colin connie corin corinne cora dan danny dave davey dean debbie dennis
  derek dick dolly don donny dora dot dottie doug eddie eddy edna elle ella ellie emma emmy emmie emmett eric ernie
  ethan eva evie fay fiona fred freddie gail gary gene george gina ginny glenn grace greg grimm gus hal hank harry
  hattie heidi henry hugo ian ida isla ivan jack jackie jake james jamie jan jane jen jenny jerry jess jill jim
  jimmy jo joe joey john johnny jon josh judy julie kay ken kenny kevin kim kitty larry laura leah len lenny leo
  les lisa liz lizzie lola lou louie lucy luke lulu mabel maddie madge maggie mandy marge maria mark matt matty max
  meg mel mia mick mickey mike millie milly milo mimi minnie mo molly nan nancy nat ned neddy nell nellie nick nicky
  nina noah nora ollie oscar otto pam pat patty paul peggy penny pete peter phil polly rob robbie roger ron ronnie
  rory rosie roy rudy russ ruth sal sally sam sammy sandy sara sarah sid stan steve sue susie suzy ted teddy terry
  tess theo tim timmy aldo tina toby tom tommy tony val vic vicky walt wendy willem willy winnie zoe bobb budd kitt hobb
  pipp dipp twiggy dylan morgan megan tyler logan mason riley bailey hayden jordan taylor
  burren lyra glendale hollyford clovis lindis bullen elma linda brooklyn wanda twila`))
const NAMES_BY_LEN: string[][] = []
for (const n of NAMES) if (n.length >= 5) (NAMES_BY_LEN[n.length] ??= []).push(n)

// a name that opens with one of these reads as a phrase (her low, the moss)
const PHRASE_HEADS = new Set(words('her his him its you our she the'))
// stems that sound like a word even though they are not spelt as one (haz: has)
const SOUNDS_LIKE_WORD = new Set(words('haz wuz iz luv yu thru ye brew'))

const BAD_OPENINGS = words(`her gal mel gran kind bob bud pud run dun drag cat lil emm ott mag bon cor neth bas hob smok tul rum`)

const DERIVED_ENDINGS = ['s', 'es', 'y', 'ey', 'ie', 'er', 'ed', 'ly', 'ish', 'ness', 'ful', 'let', 'ling', 'kin']

/** The sound of a spelling: rubbar and rubber, hummane and humane share one. */
function soundKey(w: string): string {
  return w.replace(/ck|c(?![eiy])|q(?=u)/g, 'k').replace(/ph/g, 'f')
    .replace(/([bcdfghjklmnpqrstvwxz])\1/g, '$1')
    .replace(/(?:ar|or|our|ur|re)$/, 'er').replace(/(?:ey|ie|ee)$/, 'y')
}

/**
 * A word's shape by ear: the sound of its first vowel and its consonants, each later vowel one slot, so a name with
 * only an unstressed vowel changed still matches (plummit and plummet, hornot and hornet, peakan and pecan).
 */
function skeletonKey(w: string): string {
  const k = soundKey(w).replace(/([^aeiouy])e$/, '$1')
  const m = /^[^aeiouy]*([aeiouy]{1,2})/.exec(k)
  if (!m) return ''
  return `${vowelClass(m[1]!)}:${k.replace(/[aeiouy]+/g, 'V')}`
}

/** Levenshtein distance; stops early and returns max + 1 once the distance must exceed `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev: number[] = []
  let cur: number[] = []
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const sub = prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, sub)
      cur[j] = v
      if (v < rowMin) rowMin = v
    }
    if (rowMin > max) return max + 1
    const t = prev
    prev = cur
    cur = t
  }
  return prev[b.length]!
}

function nearFranchise(w: string): string | null {
  // an edit breaks at most two of a word's letter pairs, so a near match keeps nearly all of them
  const grams = bigrams(w)
  const seen = new Set<string>()
  for (const g of grams) {
    for (const f of BY_GRAM.get(g) ?? []) {
      if (seen.has(f)) continue
      seen.add(f)
      const reach = franchiseReach(f.length)
      if (Math.abs(f.length - w.length) > reach) continue
      let common = 0
      for (const x of FRANCHISE_GRAMS.get(f)!) if (grams.has(x)) common++
      if (common >= FRANCHISE_GRAMS.get(f)!.size - 2 * reach && editDistance(w, f, reach) <= reach) return f
    }
  }
  // a famous name held whole anywhere inside
  for (let i = 0; i < w.length; i++) for (let j = i + 5; j <= w.length; j++) if (FRANCHISE_SET.has(w.slice(i, j))) return w.slice(i, j)
  for (const f of FAMOUS_SHORT) if (w.includes(f)) return f
  // one letter off inside a longer name: an edit inside the chunk leaves one of its halves intact, so look there
  for (const f of FAMOUS_CHUNKS) {
    if (w.length < f.length) continue
    const half = Math.ceil(f.length / 2)
    if (!w.includes(f.slice(0, half)) && !w.includes(f.slice(f.length - half))) continue
    for (let i = 0; i < w.length; i++) {
      // a short famous name only by one changed letter (mondor), a long one also by one dropped or added
      const spread = f.length >= 7 ? 1 : 0
      for (let len = f.length - spread; len <= f.length + spread; len++) {
        if (i + len > w.length) break
        if (editDistance(w.slice(i, i + len), f, 1) <= 1) return f
      }
    }
  }
  return null
}

// every root and source word, with sounds and lengths, filled in once the family voices exist (below)
const ROOT_WORDS = new Set<string>()
const ROOT_WORDS_BY_LEN: string[][] = []
const SOUND_KEYS = new Map<string, string>()
const SKELETONS = new Map<string, string[]>()
// the words a name is meant to be made of: a split into two of these is a compound, not a phrase
const DESIGNED = new Set<string>()

const isEnglish = (s: string): boolean => COMMON.has(s) || SCANNED.has(s) || ROOT_WORDS.has(s) || SOUNDS_LIKE_WORD.has(s)
const isWordish = (s: string): boolean => isEnglish(s) || SHORT_WORDS.has(s)

/** True when a word is plain English or a first name (or one plus an everyday ending: mossy, twiggy, ferns). */
function plainWordReason(w: string): string | null {
  if (COMMON.has(w) || SCANNED.has(w) || ROOT_WORDS.has(w)) return `plain word: ${w}`
  if (NAMES.has(w)) return `a first name: ${w}`
  for (let len = w.length - 1; len <= w.length + 1; len++) {
    // one edit leaves the first or the last letter in place, so only those words are measured
    for (const r of ROOT_WORDS_BY_LEN[len] ?? []) {
      if ((r[0] === w[0] || r.at(-1) === w.at(-1)) && editDistance(w, r, 1) <= 1) return `plain word: ${r}`
    }
    for (const n of NAMES_BY_LEN[len] ?? []) {
      if ((n[0] === w[0] || n.at(-1) === w.at(-1)) && editDistance(w, n, 1) <= 1) return `a first name: ${n}`
    }
  }
  const heard = SOUND_KEYS.get(soundKey(w))
  if (heard) return `sounds like ${heard}`
  if (w.length >= 5) {
    const like = SKELETONS.get(skeletonKey(w))?.find(x => x !== w && Math.abs(x.length - w.length) <= 2)
    if (like) return `sounds like ${like}`
  }
  for (const end of DERIVED_ENDINGS) {
    if (!w.endsWith(end) || w.length - end.length < 3) continue
    const stem = w.slice(0, -end.length)
    if (isEnglish(stem) || COMMON.has(stem + 'e') || SCANNED.has(stem + 'e') || ROOT_WORDS.has(stem + 'e') || NAMES.has(stem)) {
      return `plain word: ${stem}+${end}`
    }
    // twiggy -> twigg -> twig
    if (stem.length >= 4 && stem[stem.length - 1] === stem[stem.length - 2]) {
      const one = stem.slice(0, -1)
      if (isEnglish(one)) return `plain word: ${one}+${end}`
    }
  }
  return null
}

/** A name that splits into a phrase: soot + ax, am + bag, ow + ladder, her + low. A designed compound is fine. */
function phraseOf(w: string): string | null {
  const src = sourceOf(w)
  for (let i = 2; i <= w.length - 2; i++) {
    const left = w.slice(0, i)
    const right = w.slice(i)
    if (PHRASE_HEADS.has(left) && isEnglish(right)) return `${left} ${right}`
    // inside a double the split is not heard (fogg-o is not fog go)
    if (w[i - 1] === w[i] || right === src || DESIGNED.has(right)) continue
    if (isWordish(left) && isWordish(right)) return `${left} ${right}`
  }
  return null
}

/**
 * An everyday word the name holds across the join, one its own words do not hold (Elm + itten holds mitten, Owl +
 * adder holds ladder, Gull + etrel holds gullet).
 */
function heldWord(w: string): string | null {
  const at = rootAt(w)
  const root = at?.hit.root.full ?? ''
  const join = at?.length ?? 0
  const src = sourceOf(w) ?? ''
  for (let len = Math.min(w.length - 1, 10); len >= 4; len--) {
    for (let i = 0; i + len <= w.length; i++) {
      const s = w.slice(i, i + len)
      if (s === src || root.includes(s) || src.includes(s)) continue
      // the root with an everyday ending is still the root (glow + yvern holds glowy)
      if (root && s.startsWith(root) && DERIVED_ENDINGS.includes(s.slice(root.length))) continue
      // a word across the join is heard whatever it is (crow + nix holds crown); elsewhere only an everyday word
      // that is not one of the name's own kind of words counts (Hollowdell is made of hollow and dell)
      const across = i < join && i + len > join
      if (across ? HEARD.has(s) || (isEnglish(s) && (len >= 5 || COMMON.has(s))) : len >= 5 && (COMMON.has(s) || SCANNED.has(s)) && !ROOT_WORDS.has(s)) return s
    }
  }
  return null
}

const PROFANE_ANYWHERE = new RegExp(PROFANE.join('|'))
const DEV_ANYWHERE = new RegExp(DEV.join('|'))

/** Why a name may never be used (rude, a developer word, someone else's creature, plain English), or null. */
export const blockReason: (name: string) => string | null = memo(findBlock)

function findBlock(name: string): string | null {
  const whole = name.toLowerCase().replace(/[^a-z]/g, '')
  const parts = name.toLowerCase().split(/[^a-z]+/).filter(Boolean)
  const rude = PROFANE_ANYWHERE.exec(whole)
  if (rude) return `rude: ${rude[0]}`
  for (const w of new Set([whole, ...parts])) {
    const heard = soundSpelling(w)
    for (const re of RUDE_SOUNDS) if (re.test(heard)) return `rude by sound: ${heard.match(re)![0]}`
  }
  const dev = DEV_ANYWHERE.exec(whole)
  if (dev) return `developer word: ${dev[0]}`
  for (const w of parts) {
    for (const bad of PROFANE_EDGE) if (w.startsWith(bad) || w.endsWith(bad)) return `rude at an edge: ${bad}`
    for (const bad of DEV_EDGE) if (w.startsWith(bad) || w.endsWith(bad)) return `developer word at an edge: ${bad}`
    for (const bad of DEV_END) if (w.endsWith(bad)) return `developer word at the end: ${bad}`
    // a stock ending, unless the name ends in one of its own words that merely holds it (moon + wick, moss + jasmine,
    // not rook + ick or gust + ane)
    const own = wordOf(w)
    for (const end of BAD_END) {
      if (w.endsWith(end) && !endsInDesigned(w, end) && !(own?.endsWith(end) && !w.endsWith(own))) return `stock ending: -${end}`
    }
    // -isp reads as an internet provider and a lisp (Rookisp); a wisp is fine
    if (/[^w]isp$/.test(w)) return 'stock ending: -isp'
    if (/[bcdgkpt]owl/.test(w)) return 'splits wrong around -owl'
    for (const end of FRANCHISE_ENDINGS) if (w.endsWith(end)) return `franchise ending: -${end}`
    const f = nearFranchise(w)
    if (f) return `too close to ${f}`
    const plain = plainWordReason(w)
    if (plain) return plain
    const phrase = phraseOf(w)
    if (phrase) return `reads as a phrase: ${phrase}`
    const held = heldWord(w)
    if (held) return `holds the word ${held}`
    // a word or root and -ar, -or, -ur reads as one who does it (Drumur: drummer, Cornur: corner)
    const doer = /^(.+?)(?:ar|or|ur|er|our)$/.exec(w)
    if (doer && doer[1]!.length >= 3) {
      const base = doer[1]!.replace(/([^aeiouy])\1$/, '$1')
      if (isEnglish(base) || ROOT_FORMS.has(base) || ROOT_FORMS.has(doer[1]!)) return `reads as ${base}er`
    }
    const opening = BAD_OPENINGS.find(o => w.startsWith(o))
    if (opening && !w.startsWith(rootOf(w)?.root.full ?? '-')) return `opens with the word ${opening}`
    // cat + efoil: an e after one short vowel and one consonant reads cate-foil or cat-e-foil
    const e = /^([^aeiouy]*[aeiouy][^aeiouy]{1,2}e)[^aeiouy][aeiouy]/.exec(w)
    if (e && !/[^aeiouylr][lr]e$/.test(e[1]!) && !isEnglish(e[1]!)) {
      return 'unclear e after the root'
    }
  }
  if (parts.length > 1) {
    const f = nearFranchise(whole)
    if (f) return `too close to ${f}`
  }
  return null
}

function endsInDesigned(w: string, end: string): boolean {
  for (let k = end.length + 1; k <= Math.min(9, w.length - 2); k++) if (DESIGNED.has(w.slice(-k))) return true
  return false
}

export function isBlockedName(name: string): boolean {
  return blockReason(name) !== null
}

/** Season uniqueness: names within edit distance 1 of each other (case-insensitive) are near-duplicates. */
export function isNearDuplicate(name: string, taken: Iterable<string>): boolean {
  const n = name.toLowerCase()
  for (const t of taken) if (editDistance(n, t.toLowerCase(), 1) <= 1) return true
  return false
}

// ---------------------------------------------------------------------------------------------------------------
// Family voices. Roots are plain nature and whimsy words; "clov|er" marks the short stem a line is built on, so every
// stage of Clover's line starts with Clov-. Small words are one-syllable creatures for stage 1 (Mossnewt, Leafinch).
// Stage-2 words are fuller creatures and stage-3 words grand ones; a word joins a root without its opening consonants
// (Moss + siskin -> Mossiskin, Thund + volcano -> Thundolcano), so its stressed syllable survives and the word is
// still heard. A clip that would leave fewer than five letters (robin -> obin) is not made: such a word only overlaps
// a root that already ends with its opening (Fir + robin -> Firobin). In a word list "a|b" marks a clip of its own and
// "=word" a word that only overlaps. A word that starts with a vowel joins whole, taking the root's last consonant
// (Rook + imp -> Rookimp). The sounds build endings in the family's own voice when no word suits a root.

type Root = { stem: string; full: string; double: boolean; magicE: boolean; legend?: boolean }
type Source = { word: string; tail: string; overlapOnly: boolean }
/**
 * A family's sounds. Endings built from them close a name when no word suits it, so each species gets its own: one
 * syllable at stage 1 (Foggo, Mothyn) and two at stage 2 (Coalobar). Stage 3 is always a grand word.
 */
type Sounds = {
  /** the consonants that may open a one-syllable ending of its own (Moss + lin) */
  onsets: readonly string[]
  /** the first vowel, which takes the root's last consonant as its onset */
  first: readonly string[]
  /** the consonants inside an ending, and the vowels after them */
  inner: readonly string[]
  vowels: readonly string[]
  /** the consonants that close an ending, and the vowels it may end on */
  finals: readonly string[]
  open: readonly string[]
}
type Voice = {
  roots: readonly Root[]
  /** stage-1 small creature words */
  smalls: readonly Source[]
  sounds: Sounds
  /** stage-2 source words */
  mid: readonly Source[]
  /** stage-3 source words */
  grand: readonly Source[]
  /** legendary first words: never a regular root, so a legendary shares no root with its season */
  firsts: readonly string[]
  /** legendary second words */
  crowns: readonly string[]
}

// short-vowel monosyllables double before a vowel (fog -> foggo), as English spelling does
const SHORT_CVC = /^[^aeiouy]*[aeiou][bdgkmnprt]$/

function roots(spec: string): Root[] {
  return words(spec).map(t => {
    const [stem, rest = ''] = t.split('|') as [string, string?]
    const us = tokenize(stem)
    const n = us.length
    // tide, rune, stone: a single vowel kept long by a silent e, which a following vowel would swallow (tid-, run-)
    const magicE = us[n - 1]!.silent === true && !us[n - 2]!.v && us[n - 3]?.v === true && us[n - 3]!.s.length === 1
    const doubled = stem + stem[stem.length - 1]
    const double = rest === '' && SHORT_CVC.test(stem) && !NAMES.has(doubled) && !NAMES.has(doubled + 'y') && !NAMES.has(doubled + 'ie')
    return { stem, full: stem + rest, double, magicE }
  })
}

function sources(spec: string): Source[] {
  return words(spec).map(t => {
    const overlapOnly = t.startsWith('=')
    const bare = t.replace('=', '')
    if (bare.includes('|')) {
      const [head, tail] = bare.split('|') as [string, string]
      return { word: head + tail, tail, overlapOnly }
    }
    if (overlapOnly || isVowel(bare[0])) return { word: bare, tail: bare, overlapOnly }
    const tail = bare.replace(/^[^aeiouy]+/, '')
    // a clip that leaves fewer than five letters loses the word (tapir -> apir): only overlaps keep it whole
    if (tail.length < 5) return { word: bare, tail: bare, overlapOnly: true }
    return { word: bare, tail, overlapOnly }
  })
}

const whole = (spec: string): Source[] => words(spec).map(w => ({ word: w, tail: w, overlapOnly: false }))

// Every word was kept because it joins most of its family's roots as a sayable name of its stage's length (Moss +
// siskin -> Mossiskin, Rill + gondola -> Rillondola). Objects, people, brands and words that clip into another word
// (kitten -> mitten, terrapin -> rapin, goshawk -> o-shawk, corvid -> covid) are out.
const VOICES: Record<Family, Voice> = {
  // small, quick, light nature: soft consonants, light vowels
  haiku: {
    roots: roots(`
      moss fern mint twig tuft flit seed dill bean leaf plum elm burr fir corn oat fig sap cress clov|er popp|y haz|el
      berr|y sorr|el dapp|le plov|er nimb|le lind|en lup|in barl|ey fenn|el`),
    smalls: whole('ant eft nib mink newt bud wasp kid kit dove cub mite fawn vole finch pip foal nut pup'),
    sounds: {
      onsets: ['p', 'l', 'n', 't'], first: ['i', 'e', 'a'], inner: ['p', 'l', 'n', 't', 'b', 'f'], vowels: ['i', 'e'],
      finals: ['p', 't', 'n', 'l', 'b', 'k', 'm'], open: [],
    },
    mid: sources(`
      laurel siskin poplar aster medlar catkin marmot locust dunlin catnip lichen emmet damson marten minnow nectar
      millet fennec ferret beaver elver bantam cricket gibbon`),
    grand: sources(`
      primula violet springbok mimosa agouti conure jasmine marigold lavender salvia papaya cicada oxalis alpaca
      wallaby tamarin galago satsuma rosella gossamer daffodil lorikeet canary jerboa gerbera colibri marmoset lovebird
      camomile parakeet freesia zinnia lantana bobolink cardinal apricot piculet caraway vanilla pomelo olingo kowari
      bergamot`),
    firsts: words(`
      petal willow meadow aspen cowslip pollen tansy mallow bracken daisy blossom april rosy satin muslin cotton posy`),
    crowns: words('wing wisp heart dew song leap silk dance lace wink fen nest sun fair gold hill'),
  },
  // flowing water and air, song: liquid l r w, long vowels
  sonnet: {
    roots: roots(`
      rill rain reed lilt lull harp swan gull foam sail flow surf ebb seal kelp gust bell verse ink tarn snow brook
      breeze shoal swirl sleet hail pool ripp|le murm|ur lyr|ic`),
    smalls: whole('tern eel lute shad teal loon coot pike dace lark ray rail perch krill carp roach note reel'),
    sounds: {
      onsets: ['l', 'r', 'n', 'm'], first: ['a', 'o', 'e', 'i'], inner: ['l', 'r', 'n', 'm'], vowels: ['a', 'o', 'e', 'i'],
      finals: ['l', 'n', 'r', 'll'], open: ['a', 'o'],
    },
    mid: sources(`
      ibis orca nimbus freshet zither cirrus merrow egret dugong godwit limpet cantor tarpon fulmar selkie sculpin
      cuttle chantey petrel conger barbel comber otter marlin curlew mussel scallop ballad mullet`),
    grand: sources(`
      rivulet mermaid vibrato gavotte avocet undine kithara flotilla sonata harmony monsoon anthem gondola
      rusalka mazurka indigo caravel aurora flamingo cadence marimba oriole calypso lambada horizon nautilus soprano
      clarion madrigal marina dulcimer violin galatea glissando mandolin mallard carillon porpoise allegro
      bolero fandango mandarin calliope regatta pelican melody beluga legato tremolo medusa`),
    firsts: words(`
      river silver echo tempest opal pearl shore lake wave dawn harbor crystal siren cloud ocean azure beacon anchor
      billow chorus`),
    crowns: words('tide lyre mere veil chime tune sound wake call voice gale fall wash dune bay sea keel mast wind'),
  },
  // stone, fire, thunder, grandeur: plosives, open heavy vowels
  opus: {
    roots: roots(`
      coal boom oak tusk horn bull gong drum soot peak bark tor grit brass cairn cliff clay loam bould|er cind|er
      thund|er bis|on cobb|le molt|en jasp|er garn|et amb|er copp|er dolm|en grav|el`),
    smalls: whole('ape elk boar bear buck mole ram gaur wolf roc moose hog hart mule goat dog'),
    sounds: {
      onsets: ['b', 'd', 'g'], first: ['o', 'a', 'u'], inner: ['b', 'd', 'g', 'r', 'm', 'n'], vowels: ['o', 'a', 'u'],
      finals: ['g', 'd', 'r', 'n', 'm', 'b', 'rn', 'rg'], open: ['o'],
    },
    mid: sources(`
      ogre ibex urus oryx toucan baboon cougar coyote sulfur raptor cobalt pumice tusker caiman jackal carbon menhir
      taurus langur zircon sambar timbal tumult cavern grouper =kraken`),
    grand: sources(`
      kodiak centaur wapiti massif goliath monarch mammoth buffalo stallion galena diorite gorilla timpani bassoon
      trombone marabou caribou volcano minotaur cinnabar mastodon monolith baritone dolerite colossus crocodile
      pangolin majesty smilodon colobus fanfare argali turaco bonobo inferno marcato onager jabiru lamassu bauxite
      azurite dolomite tamaraw sardonyx stegodon gelada citadel`),
    firsts: words(`
      anvil ember iron lava summit quarry bronze hammer steel tundra tower valor crag crater caldera smelter`),
    crowns: words('maw hoof hide tusk horn bone wolf bear boar mound ram fang maul hart mane jaw buck'),
  },
  // twilight, runes, woods, mystery: th, w, gl, y, shadowed vowels
  fable: {
    roots: roots(`
      moth hush fog owl crow glen bog moon myth murk wick toad glow grim yarn rook wand wyrd thorn charm cloak nook
      star whisp|er ridd|le wyv|ern shimm|er elf twil|ight`),
    smalls: whole('asp eft imp mist puck mote wisp bat kite fay fox hare hound fey rat'),
    sounds: {
      onsets: ['th', 'w', 'l', 'm', 'n'], first: ['o', 'e', 'i'], inner: ['th', 'w', 'l', 'm', 'n'], vowels: ['y', 'o', 'e', 'i'],
      finals: ['n', 'th', 'l', 'll', 'm'], open: ['o'],
    },
    mid: sources(`
      onyx taipan specter magpie kelpie truffle mantis serval augur phantom glamour kobold mystic gorgon wyvern adder
      goblin hermit morrow mummer secret lurker dodder noctule`),
    grand: sources(`
      empusa urchin vampire panther kitsune chimera amulet serpent avalon sorcery caracal warlock wendigo boggart
      gamayun basilisk ocelot hesperus rakshasa talisman alchemy arcana kinkajou oncilla grimalkin morrigan
      domovoi zodiac polaris dullahan almanac lodestar labyrinth nebula revenant harlequin sorceress sifaka bugbear
      tanuki corsac augury colugo sylvan valkyrie polevik hecate selene`),
    firsts: words(`
      vesper omen shadow wither raven lantern umber sable elder nether rowan hemlock dusk gloam candle mirror thicket`),
    crowns: words('wyrm shade mire fang wail rune hood howl hex mask lore wood tome fen well coven lich'),
  },
}

const FAMILY_ORDER: readonly Family[] = ['haiku', 'sonnet', 'opus', 'fable']

// Mythics: a place and a creature, each a compound of whole words from lists of their own, so a Mythic never looks
// like a legendary (no legendary first word, no legendary second word).
type Kind = 'wet' | 'high' | 'low' | 'open' | 'dark'
const MYTHIC_FRONTS = words('frost briar holly nettle pewter russet saffron velvet wicker ivory auburn starling tallow hollow heather juniper')
const PLACES: readonly (readonly [string, Kind])[] = words(`
  dell:low vale:low fell:high holm:open moor:open glen:low wold:open brook:wet marsh:wet hollow:low cairn:high
  tor:high barrow:high heath:open lea:open spire:high deep:wet shore:wet down:open dale:low ford:wet combe:low
  garth:open rise:high`).map(t => t.split(':') as [string, Kind])
const ROOT_KINDS: Record<string, Kind> = Object.fromEntries(words(`
  brook:wet rill:wet rain:wet tide:wet wave:wet shoal:wet foam:wet spray:wet surf:wet swell:wet ebb:wet lake:wet
  shore:wet mist:wet kelp:wet firth:wet river:wet harbor:wet mire:wet bog:wet moor:open heath:open glen:low
  hollow:low canyon:low cliff:high cairn:high peak:high summit:high crag:high quarry:low dune:open meadow:open
  shadow:dark gloom:dark dusk:dark gloam:dark umber:dark murk:dark sable:dark tarn:wet sleet:wet`).map(t => t.split(':')))
const BEASTS = words(`
  tail paw hound stag hare owl fin beak quill talon strider warden dancer singer glider wader drifter piper prowler
  weaver trotter hopper whisker diver skimmer roamer`)

for (const f of FAMILY_ORDER) {
  const v = VOICES[f]
  for (const w of [...v.roots.map(r => r.full), ...v.smalls.map(s => s.word), ...v.mid.map(s => s.word),
    ...v.grand.map(s => s.word), ...v.firsts, ...v.crowns]) ROOT_WORDS.add(w)
  for (const w of [...v.roots.flatMap(r => [r.full, r.stem]), ...v.smalls.map(s => s.word), ...v.mid.map(s => s.word),
    ...v.grand.map(s => s.word), ...v.crowns]) DESIGNED.add(w)
}
for (const w of [...MYTHIC_FRONTS, ...PLACES.map(p => p[0]), ...BEASTS]) { ROOT_WORDS.add(w); DESIGNED.add(w) }
// a long root word one letter off still reads as that word (lentill); a short one is just where a name starts (hazen)
for (const r of ROOT_WORDS) if (r.length >= 6) (ROOT_WORDS_BY_LEN[r.length] ??= []).push(r)
for (const w of [...COMMON, ...SCANNED, ...ROOT_WORDS, ...NAMES]) {
  if (w.length >= 4 && !SOUND_KEYS.has(soundKey(w))) SOUND_KEYS.set(soundKey(w), w)
  if (w.length >= 5) (SKELETONS.get(skeletonKey(w)) ?? SKELETONS.set(skeletonKey(w), []).get(skeletonKey(w))!).push(w)
}

// every spelling a root can take at the front of a name: clov, clover, breez (breeze before a vowel), fogg
const ROOT_FORMS = new Map<string, { root: Root; family: Family }>()
for (const f of FAMILY_ORDER) {
  const v = VOICES[f]
  const legend: Root[] = v.firsts.map(w => ({ stem: normalStem(nameStem(w)), full: w, double: false, magicE: false, legend: true }))
  for (const r of [...v.roots, ...legend]) {
    const forms = [r.full, r.stem]
    if (/[^aeiou]e$/.test(r.stem)) forms.push(r.stem.slice(0, -1))
    if (r.double) forms.push(r.stem + r.stem[r.stem.length - 1])
    for (const form of forms) if (form.length >= 2 && !ROOT_FORMS.has(form)) ROOT_FORMS.set(form, { root: r, family: f })
  }
}

/** The known root a name opens with (longest match), if it was built from one. */
function rootOf(name: string): { root: Root; family: Family } | null {
  return rootAt(name)?.hit ?? null
}

/** The known root a name opens with and how many letters of the name it spells. */
function rootAt(name: string): { hit: { root: Root; family: Family }; length: number } | null {
  const w = name.toLowerCase().replace(/[^a-z]/g, '')
  for (let len = Math.min(w.length - 1, 8); len >= 2; len--) {
    const hit = ROOT_FORMS.get(w.slice(0, len))
    if (hit) return { hit, length: len }
  }
  return null
}

/** The root word a generated name was built on (clover for Clovip and Cloverestrel), or null. */
export function nameRoot(name: string): string | null {
  return rootOf(name.trim().split(/\s+/)[0] ?? '')?.root.full ?? null
}

/** The plain words a family's names are built from: roots, small words, source words and legendary words. */
export function rootWords(family: Family): string[] {
  const v = VOICES[family]
  return [...new Set([...v.roots.map(r => r.full), ...v.smalls.map(s => s.word), ...v.mid.map(s => s.word),
    ...v.grand.map(s => s.word), ...v.firsts, ...v.crowns])]
}

/** Each source word with the ending it lends a name (siskin: iskin, volcano: olcano). */
export function sourceTails(family: Family, stage: 2 | 3): { word: string; tail: string }[] {
  return (stage === 2 ? VOICES[family].mid : VOICES[family].grand).map(s => ({ word: s.word, tail: s.tail }))
}

/** A family's small words for stage 1. */
export function smallWords(family: Family): string[] {
  return VOICES[family].smalls.map(s => s.word)
}

/** A family's roots (the short stem every stage opens with, and its whole word) and the stems its legendaries open with. */
export function familyRoots(family: Family): { regular: { stem: string; full: string }[]; legendary: string[] } {
  const v = VOICES[family]
  return { regular: v.roots.map(r => ({ stem: r.stem, full: r.full })), legendary: v.firsts.map(w => normalStem(nameStem(w))) }
}

/** The words legendaries and Mythics are made of. */
export function compoundWords(): { firsts: string[]; crowns: string[]; fronts: string[]; places: string[]; beasts: string[] } {
  return {
    firsts: FAMILY_ORDER.flatMap(f => VOICES[f].firsts), crowns: FAMILY_ORDER.flatMap(f => VOICES[f].crowns),
    fronts: [...MYTHIC_FRONTS], places: PLACES.map(p => p[0]), beasts: [...BEASTS],
  }
}

// How each family sounds (SPEC section 23): features that carry it, and features that fight it.
const SOUND: Record<Family, readonly (readonly [RegExp, number])[]> = {
  // soft consonants, light vowels
  haiku: [[/p/g, 1.5], [/[bf]/g, 0.8], [/i/g, 1], [/ee|e(?=[lt])/g, 0.7], [/y$|ie$/g, 1], [/ck/g, 0.4],
    [/[ou]/g, -0.6], [/th|g|d|x|z/g, -0.8], [/r/g, -0.3], [/w/g, -0.3]],
  // liquid l, r, w and long vowels
  sonnet: [[/l/g, 1], [/r/g, 0.8], [/w|v/g, 0.8], [/oo|ay|ai|oa|ee|ow/g, 0.8], [/[aiuo][lnr]e$/g, 1.2],
    [/[bdgkpt]|ck|x/g, -0.7], [/th/g, -0.5]],
  // plosives, open heavy vowels
  opus: [[/[bdg]/g, 1.2], [/k|ck|x/g, 0.8], [/r/g, 0.5], [/[aou]/g, 0.6],
    [/i|ee|y/g, -0.8], [/[lwf]/g, -0.5], [/e/g, -0.3]],
  // th, w, gl, y and shadowed vowels
  fable: [[/th/g, 2], [/w/g, 1], [/gl|sh|wh/g, 1.2], [/y/g, 1.2], [/oo|ow|oa|o|u/g, 0.5], [/[mv]/g, 0.4],
    [/p|b/g, -0.8], [/ee|ie/g, -0.8], [/a(?![rnl])/g, -0.2]],
}

/** 0..1: how much a name sounds like its family (soft haiku, liquid sonnet, heavy opus, twilight fable). */
export function familyFit(name: string, family: Family): number {
  const w = name.toLowerCase().replace(/[^a-z]/g, '')
  let total = 0
  for (const [re, weight] of SOUND[family]) total += (w.match(re)?.length ?? 0) * weight
  return Math.max(0, Math.min(1, 0.5 + total / Math.max(1, w.length)))
}

// Endings a family can build from its sounds, by syllables: one for stage 1 (Moth + yn, Moss + lin, Fog + o) and two
// for stage 2 (Coal + obar). A one-syllable ending may open with a consonant; a longer one opens with a vowel that
// takes the root's last consonant. An ending that is a word of its own is left out, or the name would read as two
// words (Moss + pin).
const BUILT = new Map<string, Source[]>()
function built(family: Family, syl: number): Source[] {
  const key = `${family}/${syl}`
  let out = BUILT.get(key)
  if (out) return out
  const s = VOICES[family].sounds
  let open = syl === 1 ? ['', ...s.onsets].flatMap(o => [...new Set([...s.first, ...s.vowels])].map(v => o + v)) : [...s.first]
  for (let k = 1; k < syl; k++) open = open.flatMap(x => s.inner.flatMap(c => s.vowels.map(v => x + c + v)))
  // a vowel and a close (-ip, -og) may take any of the family's closes, and a lone vowel may end it (Foggo); an ending
  // with a consonant of its own, or two syllables, closes softly (-lin, -dor, -orel, -ethyn), never on a stop that
  // makes it clatter (-bap, -ipefet), and never open (-wo)
  const soft = s.finals.filter(c => /^(?:n|l|r|th|t)$/.test(c))
  const made = new Set<string>()
  for (const x of open) {
    const bare = syl === 1 && isVowel(x[0])
    if (bare && s.open.includes(x)) made.add(x)
    if (syl > 1 && s.open.includes(x.at(-1)!) && !/w[aeiou]$/.test(x)) made.add(x)
    for (const c of bare ? s.finals : soft) made.add(x + c)
  }
  // endings that read as a chemical, a brand or a stock suffix are left out (-yl, -ane, -ine, -ix, -ox, -ax)
  out = [...made].filter(x => !isWordish(x) && !NAMES.has(x) && !/(.)\1\1/.test(x) && !/(?:yl|yll|ane|ine|ix|ox|ax)$/.test(x) &&
    !/y.*[aeiouy]/.test(x))
    .map(x => ({ word: x, tail: x, overlapOnly: false }))
  BUILT.set(key, out)
  return out
}

/** Every ending of `syllables` syllables a family can build for a root (1 for stage 1, 2 for stage 2). */
export function builtEndings(family: Family, syllables: 1 | 2 = 1): string[] {
  return built(family, syllables).map(s => s.word)
}

// ---------------------------------------------------------------------------------------------------------------
// Junctions. A root meets an ending at a natural sound boundary: when the root already ends with the word's opening
// sound the two overlap and the whole word survives (moor + raven -> Mooraven); a vowel-initial ending takes the
// root's last consonant as its onset (ott + egret -> Ottegret); short monosyllables double first (fog + o -> Foggo).

const BOUNDARY_DIGRAPHS = new Set([...CONSONANT_PAIRS, ...VOWEL_PAIRS, 'qu'].filter(d => d !== 'nk'))
const misread = (x: string, y: string | undefined): boolean => y !== undefined && BOUNDARY_DIGRAPHS.has(x + y)
// endings whose vowel would merge with the root's own (dew + ith reads "you with", boar + o, aur + ee)
const NEEDS_CONSONANT = /(?:ew|oo|ee|ue|ae|ie|ear|oar|oor|our|aur|eer|ire|ore|ure)$/

// cat + efoil reads cate-foil or cat-e-foil: an e after a single short vowel and one consonant is a silent-e trap
function eAmbiguous(stem: string, tail: string): boolean {
  if (tail[0] !== 'e' || tail.length < 3 || isVowel(tail[1]) || tail[1] === 'y' || !isVowel(tail[2])) return false
  const m = /([aeiouy]+)([^aeiouy]+)$/.exec(stem)
  return m !== null && m[1]!.length === 1
}

/** Every spelling of root + ending worth scoring; empty when no junction is natural. */
function attach(r: Root, tail: string, whole: string, overlapOnly = false): string[] {
  const s = r.stem
  const last = s[s.length - 1]!
  const out: string[] = []
  // the root already ends with the word's opening: moor + raven, chirp + pip. Never inside a digraph: myth + hound
  // would read my-thound.
  for (let k = Math.min(3, whole.length - 2); k >= 1; k--) {
    if (!s.endsWith(whole.slice(0, k)) || isVowel(whole[0]) || misread(last, whole[k]) || s.length <= k) continue
    if (k === 1 && CONSONANT_PAIRS.has(s.slice(-2))) continue
    out.push(s + whole.slice(k))
  }
  if (overlapOnly || !tail) return out
  // a y before a consonant is a vowel (Moth+yn), so it joins like one
  if (!isVowel(tail[0]) && !(tail[0] === 'y' && !isVowel(tail[1]))) {
    if (!misread(last, tail[0])) out.push(s + tail)
    return out
  }
  if (r.magicE || NEEDS_CONSONANT.test(s)) return out
  if (/[^aeiou]e$/.test(s)) {
    out.push(s.slice(0, -1) + tail)
    return out
  }
  if (eAmbiguous(s, tail)) return out
  // an owl after a stop splits the wrong way: kel-powl, wan-dowl, grani-towl
  if (tail.startsWith('ow') && /[bcdgkpt]$/.test(s)) return out
  if (/[aeiou]$/.test(s) && !/(ow|ay|oy|aw)$/.test(s)) return out
  // a short ending doubles a short root (fog + o -> foggo); a long one carries the stress itself, so the short vowel
  // holds without the double (twig + iskin)
  out.push((r.double && tail.length < 4 ? s + last : s) + tail)
  return out
}

/**
 * The spellings a stem and an ending may join as (lowercase), empty when no junction is natural: junctions('cat',
 * 'efoil') is empty (cate-foil or cat-e-foil?), junctions('moor', 'aven', 'raven') overlaps to mooraven.
 */
export function junctions(stem: string, ending: string, word = ending, overlapOnly = false): string[] {
  const [r] = roots(stem)
  return attach(r!, ending, word, overlapOnly)
}

const title = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

function fits(name: string, shape: Shape): boolean {
  const syl = syllables(name)
  return name.length >= shape.letters[0] && name.length <= shape.letters[1] &&
    syl >= shape.syllables[0] && syl <= shape.syllables[1]
}

// ---------------------------------------------------------------------------------------------------------------
// Season bookkeeping: names already taken, the roots behind them, and the source words their endings came from.

// every ending a word can leave on a name, to the word: iskin -> siskin, finch -> finch (leaf + finch overlaps, so
// the whole word still ends the name)
const TAIL_INDEX = new Map<string, string>()
const VOCAB_WORDS = new Set<string>()
const ALL_SOURCES = FAMILY_ORDER.flatMap(f => [...VOICES[f].mid, ...VOICES[f].grand, ...VOICES[f].smalls])
for (const s of ALL_SOURCES) {
  VOCAB_WORDS.add(s.word)
  for (const t of [s.word, s.tail]) if (t.length >= 3 && !TAIL_INDEX.has(t)) TAIL_INDEX.set(t, s.word)
}

/**
 * What a name's ending came from: its source or small word (Mossiskin: siskin, Leafinch: finch), or the ending built
 * for it (Coalobar: obar). Null for a name no root opens.
 */
export function endingSource(name: string): string | null {
  return rootAt(name) || wordOf(name) ? endingKey(name) : null
}

/** The vocabulary word behind a name's ending, or null when the ending was built from the family's sounds. */
function wordOf(name: string): string | null {
  const key = endingKey(name)
  return VOCAB_WORDS.has(key) ? key : null
}

/**
 * What a name's ending is made of: its source word or small word, or the ending built for it (Mossiskin: siskin,
 * Leafinch: finch, Coalobar: obar, Foggo: o).
 */
export function endingKey(name: string): string {
  const w = name.toLowerCase()
  const at = rootAt(w)
  if (!at) return sourceOf(w) ?? w
  let rest = w.slice(at.length)
  // a doubled consonant belongs to the root (fogg-o)
  if (rest[0] === w[at.length - 1] && !isVowel(rest[0])) rest = rest.slice(1)
  const isBuilt = (x: string): boolean => FAMILY_ORDER.some(f => builtSet(f, 1).has(x) || builtSet(f, 2).has(x))
  // what follows the root is the ending (crow + asp, not cro + wasp); an overlap shares the root's last letter with
  // it (leaf + finch, barl + lam)
  const shared = w[at.length - 1] + rest
  for (const x of [rest, shared]) {
    if (TAIL_INDEX.has(x)) return TAIL_INDEX.get(x)!
    if (isBuilt(x)) return x
  }
  return sourceOf(w) ?? rest
}

const BUILT_SETS = new Map<string, Set<string>>()
function builtSet(family: Family, syl: 1 | 2): Set<string> {
  const key = `${family}/${syl}`
  let set = BUILT_SETS.get(key)
  if (!set) BUILT_SETS.set(key, (set = new Set(built(family, syl).map(s => s.word))))
  return set
}

function sourceOf(name: string): string | null {
  const n = name.toLowerCase()
  for (let k = Math.min(10, n.length - 2); k >= 3; k--) {
    const w = TAIL_INDEX.get(n.slice(-k))
    if (w) return w
  }
  return null
}

class Taken {
  names: string[]
  stems: Set<string>
  words = new Set<string>()
  constructor(taken: Iterable<string>) {
    this.names = [...taken].map(t => t.toLowerCase())
    const parts = this.names.flatMap(n => n.split(' '))
    this.stems = new Set(parts.map(n => normalStem(rootOf(n)?.root.stem ?? nameStem(n))))
    for (const n of parts) {
      const w = wordOf(n)
      if (w) this.words.add(w)
    }
  }
  clashes(name: string): boolean {
    return isNearDuplicate(name, this.names)
  }
  rootTaken(stem: string): boolean {
    const s = normalStem(stem)
    for (const t of this.stems) {
      if (t === s || (t.length >= 3 && s.length >= 3 && (t.startsWith(s) || s.startsWith(t)))) return true
    }
    return false
  }
}

const WORDY_END = /(ing|able|ible|ness|ful|less|ment|tion|sion|ily|ish|ous|ed)$/i

/** The score of a single generated name, or -1 when it fails any check. */
function usable(name: string, shape: Shape, taken: Taken): number {
  if (!fits(name, shape)) return -1
  const p = pronounceability(name)
  if (p < MIN_SCORE) return -1
  // everyday suffixes read as an adjective or a verb (Mossing, Moorable, Brinily), never as a creature
  if (WORDY_END.test(name)) return -1
  if (isBlockedName(name) || taken.clashes(name)) return -1
  return p
}

// ---------------------------------------------------------------------------------------------------------------
// Candidates. A root's candidates for a stage come in its own seeded order: the family's words for the stage (small
// words at stage 1), then, for stages 1 and 2, endings built from the family's sounds. The first well-formed ones of
// each kind are weighed: never fewer than CANDIDATES, and half as many again of the stage-2 and stage-3 words.

type EndKind = 'small' | 'built' | 'word'
type Cand = { name: string; word: string; kind: EndKind; key: string }
type Scored = Cand & { p: number }

const WEIGHED: Record<EndKind, number> = { word: 1.5 * CANDIDATES, small: CANDIDATES, built: CANDIDATES }

/** A root's candidates for a stage; with `all`, every one the vocabulary can make rather than the weighed few. */
function stageCands(r: Root, family: Family, stage: Stage, all = false): Cand[] {
  const v = VOICES[family]
  const rng = rngFromSeed(`spinlings/names/ends/${r.full}/${stage}`)
  // the root's own word is not an ending (Hornornbill, Whispisper)
  const own = (s: Source): boolean => s.word === r.full || r.full.startsWith(s.word) || s.word.startsWith(r.stem)
  const make = (list: readonly Source[], kind: EndKind): Cand[] => {
    const out: Cand[] = []
    let fitting = 0
    for (const src of shuffle(rng, list)) {
      if (!all && fitting >= 4 * WEIGHED[kind]) break
      if (own(src)) continue
      // a small word that opens with a vowel would double a short root before it (Figgeft, Foggimp)
      if (kind === 'small' && r.double && isVowel(src.word[0])) continue
      const key = kind === 'small' ? `s:${src.word}` : kind === 'built' ? `b${stage}:${src.word}` : src.word
      for (const n of attach(r, src.tail, src.word, src.overlapOnly)) {
        const name = title(n)
        if (fits(name, STAGE_SHAPE[stage])) fitting++
        out.push({ name, word: src.word, kind, key })
      }
    }
    return out
  }
  // stage 3 is always a grand word: built three-syllable endings read as gibberish
  if (stage === 3) return make(v.grand, 'word')
  const words = stage === 1 ? make(v.smalls, 'small') : make(v.mid, 'word')
  return [...words, ...make(built(family, stage), 'built')]
}

/** The usable names among the first well-formed candidates of each kind, only the good ones when there are enough. */
function good(cands: Cand[], stage: Stage, taken: Taken): Scored[] {
  const out: Scored[] = []
  for (const kind of ['small', 'word', 'built'] as const) {
    const ok: Scored[] = []
    let weighed = 0
    for (const c of cands) {
      // a candidate is a well-formed name of the stage's length that no blocklist rejects; the best of those weighed
      // survive
      if (c.kind !== kind || !fits(c.name, STAGE_SHAPE[stage]) || isBlockedName(c.name)) continue
      if (weighed++ >= WEIGHED[kind]) break
      if (stage > 1 && taken.words.has(c.word)) continue
      const p = usable(c.name, STAGE_SHAPE[stage], taken)
      if (p >= 0) ok.push({ ...c, p })
    }
    // only good names when there are enough of them to keep a root's returns varied
    const best = ok.filter(c => c.p >= GOOD_SCORE)
    out.push(...(best.length >= Math.min(8, Math.ceil(WEIGHED[kind] / 3)) ? best : ok))
  }
  return out
}

/**
 * Each stage more than the last: more letters, as many or more syllables, and clearly different. Stage 1 has two
 * syllables and stage 3 at least three, so by stage 3 a line has grown a syllable and at least two letters.
 */
function grows(a: string, b: string): boolean {
  if (b.length < a.length + 1 || syllables(b) < syllables(a)) return false
  return editDistance(a.toLowerCase(), b.toLowerCase(), 3) >= 3
}

const quality = (p: number): number => Math.min(p, GOOD_SCORE)

type Prepared = {
  ones: Scored[]; twos: Scored[]; threes: Scored[]
  /** ones[i] grows into twos[j] */ g12: Uint8Array
  /** twos[j] grows into threes[k] from another word */ g23: Uint8Array
  /** ones[i] and threes[k] are clearly different */ f13: Uint8Array
}

function prepare(r: Root, family: Family, taken: Taken): Prepared {
  const ones = good(stageCands(r, family, 1), 1, taken)
  const twos = good(stageCands(r, family, 2), 2, taken)
  const threes = good(stageCands(r, family, 3), 3, taken)
  const g12 = new Uint8Array(ones.length * twos.length)
  const g23 = new Uint8Array(twos.length * threes.length)
  const f13 = new Uint8Array(ones.length * threes.length)
  ones.forEach((o, i) => twos.forEach((t, j) => { g12[i * twos.length + j] = grows(o.name, t.name) ? 1 : 0 }))
  twos.forEach((t, j) => threes.forEach((h, k) => {
    g23[j * threes.length + k] = t.word !== h.word && grows(t.name, h.name) ? 1 : 0
  }))
  ones.forEach((o, i) => threes.forEach((h, k) => {
    f13[i * threes.length + k] = h.name.length >= o.name.length + 2 && editDistance(o.name.toLowerCase(), h.name.toLowerCase(), 3) >= 3 ? 1 : 0
  }))
  return { ones, twos, threes, g12, g23, f13 }
}

// What an ending costs the rotation, by how often its key came up in the family's last year: a stage-2 or stage-3
// word is held to three lines, a small word to five and a built ending to one, unless a root has nothing else left.
// Words come before built endings until they reach their cap, and the least-used word comes first. Better-sounding
// names win ties.
function endingCost(x: Scored, n: number): number {
  const q = quality(x.p) / 4
  if (x.kind === 'small') return n * n + (n >= 5 ? 80 : 0) - q
  if (x.kind === 'word') return 4 * n * n + (n >= 3 ? 40 : 0) - q
  return (x.key.startsWith('b1:') ? 17 : 18) + 8 * n * n + (n >= 1 ? 20 : 0) - q
}

type Pick = { one: Scored; two: Scored; three: Scored }

/**
 * The cheapest growing line for a root: names `avoid` rejects (this root's earlier names, a season's near
 * duplicates) and keys in `blocked` (endings already used this season) are skipped.
 */
function nextLine(p: Prepared, avoid: (name: string) => number, counts: Map<string, number>, blocked: ReadonlySet<string>): Pick | null {
  const cost = (x: Scored): number => blocked.has(x.key) ? Infinity : avoid(x.name) + endingCost(x, counts.get(x.key) ?? 0)
  const c1 = p.ones.map(cost)
  const c2 = p.twos.map(cost)
  const c3 = p.threes.map(cost)
  const order = (c: number[]): number[] => c.map((_, i) => i).filter(i => c[i]! < Infinity).sort((a, b) => c[a]! - c[b]!)
  const o1 = order(c1)
  const o2 = order(c2)
  const o3 = order(c3)
  if (!o1.length || !o2.length || !o3.length) return null
  const min1 = c1[o1[0]!]!
  const min3 = c3[o3[0]!]!
  const T = p.threes.length
  const W = p.twos.length
  let best: Pick | null = null
  let bestCost = Infinity
  for (const j of o2) {
    if (c2[j]! + min3 + min1 >= bestCost) break
    for (const k of o3) {
      const ck = c2[j]! + c3[k]!
      if (ck + min1 >= bestCost) break
      if (!p.g23[j * T + k]) continue
      for (const i of o1) {
        const c = ck + c1[i]!
        if (c >= bestCost) break
        if (!p.g12[i * W + j] || !p.f13[i * T + k]) continue
        best = { one: p.ones[i]!, two: p.twos[j]!, three: p.threes[k]! }
        bestCost = c
        break
      }
    }
  }
  return best
}

// ---------------------------------------------------------------------------------------------------------------
// Rotation. A season seed (spinlings/season/{s}/{family}/{i}) takes slot (s - 1) * 8 + i of its family. Each slot
// goes to a root by smooth weighted round robin: a root comes back in proportion to how many different lines it can
// grow, evenly spaced, so a root with few lines comes back seldom and none runs out of new lines within three years.
// Each return grows a new line: the cheapest by the year's ending counts that repeats none of the season's endings
// and none of the root's names from the last two years (an older one comes back only at a cost). Lines are built in
// slot order, on demand and without end, so nothing wraps round to an earlier season. Other seeds use their trailing
// number, or a hash, as the slot within the first three years.

const SPECIES_PER_SEASON = 8
/** A year of a family's slots: the window the ending caps count over. */
const WINDOW = 13 * SPECIES_PER_SEASON
/** Seeds that are not season seeds take a slot within the first three years. */
const SPAN = 39 * SPECIES_PER_SEASON
/** A root joins the rotation only when it can grow at least this many different lines on its own... */
const MIN_LINES = 4
/** ...and it is weighed by how many it can grow, up to this many. */
const MAX_LINES = 30
/** What bringing back a name the root had more than two years ago costs the rotation. */
const STALE = 60

type Slot = { pos: number; legend: number }

function slotOf(seed: string): Slot {
  const season = /season\/(\d+)\/[a-z]+\/(\d+)$/.exec(seed)
  if (season) {
    const s = Number(season[1])
    return { pos: (s - 1) * SPECIES_PER_SEASON + Math.min(Number(season[2]), SPECIES_PER_SEASON - 1), legend: s - 1 }
  }
  const n = /(\d{1,6})$/.exec(seed)
  const base = hashString(`spinlings/names/slot/${n ? seed.slice(0, -n[1]!.length) : seed}`) % 7919
  const k = n ? Number(n[1]) : 0
  return { pos: (base + k) % SPAN, legend: base + k }
}

type Line = { names: NameLine; keys: [string, string, string]; pos: number }
type Table = {
  deck: Root[]
  /** how many different lines each deck root can grow, its weight in the rotation */
  weights: number[]
  /** the round robin's running credit per deck root, and the deck index each slot went to */
  credit: number[]
  order: number[]
  prepared: Map<string, Prepared>
  lines: (Line | null)[]
  byRoot: Map<string, Line[]>
  /** ending keys of the last WINDOW - 1 lines, counted */
  window: Map<string, number>
}
const TABLES = new Map<Family, Table>()
/** The furthest slot a season seed has asked for. */
let furthest = 0

const bump = (m: Map<string, number>, k: string, d: number): void => {
  const v = (m.get(k) ?? 0) + d
  if (v) m.set(k, v)
  else m.delete(k)
}

function table(family: Family): Table {
  let tab = TABLES.get(family)
  if (tab) return tab
  const none = new Taken([])
  const all = shuffle(rngFromSeed(`spinlings/names/deck/${family}`), VOICES[family].roots)
  const prepared = new Map(all.map(r => [r.full, prepare(r, family, none)]))
  // capacity: how many distinct lines a root can grow with nothing else in the way
  const capacity = (r: Root): number => {
    const used = new Set<string>()
    const counts = new Map<string, number>()
    let k = 0
    for (; k < MAX_LINES; k++) {
      const pick = nextLine(prepared.get(r.full)!, n => (used.has(n) ? Infinity : 0), counts, new Set())
      if (!pick) break
      for (const x of [pick.one, pick.two, pick.three]) { used.add(x.name); bump(counts, x.key, 1) }
    }
    return k
  }
  const sized = all.map(r => ({ r, k: capacity(r) })).filter(x => x.k >= MIN_LINES)
  tab = {
    deck: sized.map(x => x.r), weights: sized.map(x => x.k), credit: sized.map(() => 0), order: [], prepared,
    lines: [], byRoot: new Map(sized.map(x => [x.r.full, []])), window: new Map(),
  }
  TABLES.set(family, tab)
  return tab
}

/** The deck root a slot goes to. */
function rootFor(tab: Table, pos: number): Root {
  const total = tab.weights.reduce((a, b) => a + b, 0)
  while (tab.order.length <= pos) {
    let best = 0
    for (let i = 0; i < tab.credit.length; i++) {
      tab.credit[i]! += tab.weights[i]!
      if (tab.credit[i]! > tab.credit[best]!) best = i
    }
    tab.credit[best]! -= total
    tab.order.push(best)
  }
  return tab.deck[tab.order[pos]!]!
}

const lineOf = (pick: Pick, pos: number): Line => ({
  names: [pick.one.name, pick.two.name, pick.three.name], keys: [pick.one.key, pick.two.key, pick.three.key], pos,
})

/** Builds the family's lines up to slot `upto`. */
function extend(tab: Table, upto: number): void {
  while (tab.lines.length <= upto) {
    const pos = tab.lines.length
    const old = pos - WINDOW
    if (old >= 0) for (const k of tab.lines[old]?.keys ?? []) bump(tab.window, k, -1)
    const root = rootFor(tab, pos)
    const p = tab.prepared.get(root.full)!
    const history = tab.byRoot.get(root.full)!
    const season = new Set<string>()
    for (let q = pos - (pos % SPECIES_PER_SEASON); q < pos; q++) for (const k of tab.lines[q]?.keys ?? []) season.add(k)
    // a name the root had in the last two years never comes back; an older one only when it beats a fresh one by a
    // margin, so a root with few small words can bring one back rather than build an ending
    const recent = new Set(history.filter(l => l.pos > pos - 2 * WINDOW).flatMap(l => l.names))
    const ever = new Set(history.flatMap(l => l.names))
    const avoid = (n: string): number => (recent.has(n) ? Infinity : ever.has(n) ? STALE : 0)
    const pick = nextLine(p, avoid, tab.window, season) ?? nextLine(p, avoid, tab.window, new Set())
    const line = pick ? lineOf(pick, pos) : null
    tab.lines.push(line)
    if (line) {
      history.push(line)
      for (const k of line.keys) bump(tab.window, k, 1)
    }
  }
}

/** The ending keys of the year before a slot, counted. */
function windowAt(tab: Table, pos: number): Map<string, number> {
  const m = new Map<string, number>()
  for (let q = Math.max(0, pos - WINDOW + 1); q < pos; q++) for (const k of tab.lines[q]?.keys ?? []) bump(m, k, 1)
  return m
}

/** A line still free in a season: no near-duplicate of a taken name and no source word used this season. */
function freeIn(line: NameLine, taken: Taken): boolean {
  if (line.some(n => taken.clashes(n))) return false
  for (const n of line.slice(1)) {
    if (taken.words.has(wordOf(n) ?? '')) return false
  }
  return true
}

/**
 * The three stage names of a species. Legendaries never evolve: their single stately name fills all three entries.
 * `taken` holds names already used this season; a candidate within edit distance 1 of one, built on the same root, or
 * ending in a source word already used, is rejected.
 */
export function speciesNames(seed: string, family: Family, legendary = false, taken: Iterable<string> = []): NameLine {
  const t = new Taken(taken)
  const slot = slotOf(seed)
  if (legendary) {
    const pool = legendPool(family)
    // on a clash, one from the far side of the order, so a later season's does not come early
    for (let i = 0; i < pool.length; i++) {
      const name = pool[(slot.legend + (i ? Math.floor(pool.length / 2) + i : 0)) % pool.length]!
      if (!t.clashes(name) && !t.rootTaken(nameStem(name))) return [name, name, name]
    }
    throw new Error(`no free ${family} legendary for seed ${seed}`)
  }
  const tab = table(family)
  const seasonStart = slot.pos - (slot.pos % SPECIES_PER_SEASON)
  const seasonEnd = seasonStart + SPECIES_PER_SEASON
  extend(tab, seasonEnd - 1)
  furthest = Math.max(furthest, seasonEnd)
  const own = rootFor(tab, slot.pos)
  const mine = tab.lines[slot.pos]
  if (mine && !t.rootTaken(own.stem) && freeIn(mine.names, t)) return mine.names
  // A clash with the season: a fresh line, from the slot's own root and then from the other roots in deck order. It
  // keeps clear of the endings the rest of this season is scheduled to use, and of every name the root has within
  // three years either side.
  extend(tab, slot.pos + 3 * WINDOW)
  const blocked = new Set<string>(t.words)
  for (let q = slot.pos + 1; q < seasonEnd; q++) for (const k of tab.lines[q]?.keys ?? []) blocked.add(k)
  const counts = windowAt(tab, slot.pos)
  const at = tab.deck.indexOf(own)
  const order = [...tab.deck.slice(at), ...tab.deck.slice(0, at)]
  // the widest berth first; nearer names only when nothing else is free
  for (const span of [3 * WINDOW, WINDOW, SPECIES_PER_SEASON]) {
    for (const pass of ['free', 'any'] as const) {
      for (const root of order) {
        if (pass === 'free' && t.rootTaken(root.stem)) continue
        const near = new Set((tab.byRoot.get(root.full) ?? [])
          .filter(l => Math.abs(l.pos - slot.pos) <= span).flatMap(l => l.names))
        const fresh = nextLine(tab.prepared.get(root.full)!, n => (near.has(n) || t.clashes(n) ? Infinity : 0), counts, blocked)
        if (fresh) return [fresh.one.name, fresh.two.name, fresh.three.name]
      }
    }
  }
  throw new Error(`no usable ${family} name for seed ${seed}`)
}

// ---------------------------------------------------------------------------------------------------------------
// Legendaries: a stately compound of two whole words (Rivertide, Anvilmaw). The seasons take them in a fixed order in
// which no first word and no second word comes back within a year, and no pairing comes back until every pairing has
// been used.

const LEGENDS = new Map<Family, string[]>()

function legendPool(family: Family): string[] {
  let pool = LEGENDS.get(family)
  if (pool) return pool
  const { firsts, crowns } = VOICES[family]
  const none = new Taken([])
  const pairs: { a: string; b: string; name: string }[] = []
  for (const a of firsts) {
    for (const b of crowns) {
      if (misread(a[a.length - 1]!, b[0])) continue
      const name = title(a + b)
      if (usable(name, LEGENDARY_SHAPE, none) >= 0) pairs.push({ a, b, name })
    }
  }
  const order = shuffle(rngFromSeed(`spinlings/names/legends/${family}`), pairs)
  const lastA = new Map<string, number>()
  const lastB = new Map<string, number>()
  const used = new Set<string>()
  pool = []
  for (let j = 0; j < order.length; j++) {
    let pick: (typeof order)[number] | undefined
    // a year apart if the lists allow it, closer only at the very end of the cycle
    for (const gap of [12, 8, 4, 0]) {
      pick = order.find(x => !used.has(x.name) && j - (lastA.get(x.a) ?? -99) > gap && j - (lastB.get(x.b) ?? -99) > gap)
      if (pick) break
    }
    if (!pick) break
    used.add(pick.name)
    lastA.set(pick.a, j)
    lastB.set(pick.b, j)
    pool.push(pick.name)
  }
  LEGENDS.set(family, pool)
  return pool
}

/** Every legendary a family can have, in the order the seasons take them. */
export function legendaryNames(family: Family): readonly string[] {
  return legendPool(family)
}

let legendNames: Set<string> | null = null
const LEGEND_NAMES = (): Set<string> => (legendNames ??= new Set(FAMILY_ORDER.flatMap(f => legendPool(f))))

// ---------------------------------------------------------------------------------------------------------------
// Mythics: two words, a place and a creature (Briarmoor Rainsinger), each a compound of whole words. A fresh seed
// every time, so each is one of a kind. The place never repeats its root's idea (Bogmarsh is a marsh twice).

const MYTHIC_ROOTS: readonly string[] = [...new Set([...FAMILY_ORDER.flatMap(f => VOICES[f].roots.map(r => r.full)), ...MYTHIC_FRONTS])]

function compound(a: string, b: string): string {
  if (misread(a[a.length - 1]!, b[0]) || a[a.length - 1] === b[0]) return ''
  // an owl after a stop splits wrong (kel-powl, wan-dowl), so it only follows l, r, n or a vowel
  if (b === 'owl' && !/[lrnaeiouw]$/.test(a)) return ''
  return title(a + b)
}

export function mythicName(seed: string): string {
  const rng = rngFromSeed(`spinlings/mythic/${seed}`)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]!
  const first = bestWord(() => {
    const root = pick(MYTHIC_ROOTS)
    const [place, kind] = pick(PLACES)
    const w = ROOT_KINDS[root] === kind || root === place ? '' : compound(root, place)
    return LEGEND_NAMES().has(w) ? '' : w
  }, [])
  const second = bestWord(() => {
    const root = pick(MYTHIC_ROOTS)
    const beast = pick(BEASTS)
    const w = first.toLowerCase().startsWith(root) || root === beast ? '' : compound(root, beast)
    return LEGEND_NAMES().has(w) ? '' : w
  }, [first])
  return `${first} ${second}`
}

function bestWord(make: () => string, taken: string[]): string {
  const t = new Taken(taken)
  let best = ''
  let bestQ = -1
  for (let tries = 0, made = 0; made < CANDIDATES && tries < CANDIDATES * 20; tries++) {
    const w = make()
    if (!w) continue
    made++
    if ((/ing$/i.test(w) && !/wing$/i.test(w)) || t.rootTaken(nameStem(w))) continue
    const p = usable(w, MYTHIC_WORD_SHAPE, t)
    if (p < 0) continue
    const q = quality(p)
    if (q > bestQ) { best = w; bestQ = q }
    if (q >= GOOD_SCORE) break
  }
  if (!best) throw new Error('no usable mythic word')
  return best
}

// ---------------------------------------------------------------------------------------------------------------
// Fusions keep both parents audible: A's root up front, then B's sound. Stage 1 runs the two roots together (Moth +
// jasper -> Mothasp), stage 2 takes B's whole root word or a word of any family that carries B's sound (Mothasper),
// and stage 3 a grand word that carries it (Mothastodon). A fusion is never a species name of any season the rotation
// has built, never a legendary and never near one of the season's names; a name a species could still be given one
// day is a last resort.

/** The root at the front of a name: its first syllable, closed by the next consonant (Mossalorn -> moss). */
export function nameStem(name: string): string {
  const w = name.toLowerCase().replace(/[^a-z]/g, '')
  const us = tokenize(w)
  let i = 0
  while (i < us.length && !us[i]!.v) i++
  if (i >= us.length) return w
  let out = us.slice(0, i + 1).map(u => u.s).join('')
  const c1 = us[i + 1]
  const c2 = us[i + 2]
  if (c1 && !c1.v && !c1.silent) {
    out += c1.s
    if (c2 && !c2.v && CODA2.has(`${c1.s}|${c2.s}`)) out += c2.s
  }
  return out
}

function normalStem(stem: string): string {
  // fogg -> fog, twigg -> twig (moss, dill and puff keep their doubles)
  return /([^aeiouylsf])\1$/.test(stem) ? stem.slice(0, -1) : stem
}

/** The family a name was most likely drawn from: by its root, else by its sound. */
function familyOfName(name: string): Family {
  const byRoot = rootOf(name)
  if (byRoot) return byRoot.family
  return [...FAMILY_ORDER].sort((f, g) => familyFit(name, g) - familyFit(name, f))[0]!
}

const plain = (name: string): string => name.trim().replace(/ [IVXLCDM]+$/, '')

// a word without its opening consonants: jasp -> asp, jasper -> asper, gloam -> oam
const rimeOf = (w: string): string => w.replace(/^[^aeiouy]+/, '')
// a vowel spelt as a pair loses its sound without the consonant before it (soot + eaf, flow + oad)
const PAIR_VOWEL = /^(?:ea|ee|oa|oo|ou|ai|ay|ow|aw|au|oi|oy|ew|ie|ue)/

function parentRoot(word: string): Root {
  const known = rootOf(word)?.root
  if (known && !known.legend) return known
  const stem = normalStem(nameStem(word))
  return { stem, full: known?.full ?? stem, double: SHORT_CVC.test(stem), magicE: false }
}

// Every name a species built on a root could ever have, at any stage and in any season (its lines and fresh lines all
// come from the root's weighed candidates): a fusion must never be one of them.
const SPECIES_CANDS = new Map<string, Set<string>>()
function speciesCandidates(r: Root, family: Family): Set<string> {
  const key = `${family}/${r.full}`
  let set = SPECIES_CANDS.get(key)
  if (!set) {
    const p = table(family).prepared.get(r.full) ?? prepare(r, family, new Taken([]))
    set = new Set([...p.ones, ...p.twos, ...p.threes].map(c => c.name))
    SPECIES_CANDS.set(key, set)
  }
  return set
}

/** True when a species of some season could one day carry this name: it is among its root's candidates. */
function couldBeSpecies(name: string): boolean {
  const n = title(name.trim())
  const w = n.toLowerCase()
  for (let len = 2; len < w.length; len++) {
    const hit = ROOT_FORMS.get(w.slice(0, len))
    if (hit && !hit.root.legend && speciesCandidates(hit.root, hit.family).has(n)) return true
  }
  return false
}

// The names the seasons give: every regular name of the first three years (and a year past the furthest season the
// rotation has reached), and every legendary.
let seasonNames: { upto: number; names: Set<string> } | null = null
function SEASON_NAMES(): Set<string> {
  const upto = Math.max(SPAN, furthest) + WINDOW
  if (!seasonNames || seasonNames.upto < upto) {
    const names = new Set(LEGEND_NAMES())
    for (const f of FAMILY_ORDER) {
      const tab = table(f)
      extend(tab, upto - 1)
      for (const l of tab.lines) for (const n of l?.names ?? []) names.add(n)
    }
    seasonNames = { upto, names }
  }
  return seasonNames.names
}

/** True when a species of any season carries this name, or a legendary does. */
export function isSpeciesName(name: string): boolean {
  return SEASON_NAMES().has(title(name.trim()))
}

const ALL_MID: readonly (Source & { family: Family })[] = FAMILY_ORDER.flatMap(f => VOICES[f].mid.map(s => ({ ...s, family: f })))
const ALL_GRAND: readonly (Source & { family: Family })[] = FAMILY_ORDER.flatMap(f => VOICES[f].grand.map(s => ({ ...s, family: f })))

/** The three names of a fusion of A (front) and B (back). Same parents, same names. */
export function fusionLine(nameA: string, nameB: string, taken: Iterable<string> = []): NameLine {
  // the same parents in the same season always fuse to the same names, so a fusion is worked out once
  const list = [...taken]
  const key = `${nameA}/${nameB}/${list.length}/${hash128(list.join('/')).join('.')}`
  const known = FUSIONS.get(key)
  if (known) return [...known]
  const line = fuse(nameA, nameB, list)
  if (FUSIONS.size >= 4096) FUSIONS.clear()
  FUSIONS.set(key, line)
  return [...line]
}
const FUSIONS = new Map<string, NameLine>()

function fuse(nameA: string, nameB: string, taken: readonly string[]): NameLine {
  const a = plain(nameA).split(/\s+/)[0]!.toLowerCase()
  const bWords = plain(nameB).split(/\s+/)
  const b = bWords[bWords.length - 1]!.toLowerCase()
  const t = new Taken([...taken, nameA, nameB, ...nameA.split(/\s+/), ...nameB.split(/\s+/)])
  const A = parentRoot(a)
  const B = parentRoot(b)
  const fam = familyOfName(b)
  const rng = rngFromSeed(`spinlings/fusion/${a}/${b}`)
  // B's stressed syllable, its doubled close made single at the end of a name (cobb -> cob)
  const bCore = normalStem(B.stem)
  const bRime = rimeOf(bCore)
  const bWord = B.full !== B.stem ? rimeOf(B.full) : ''
  // the sound that says B: its first vowel and the letter after it (jasper -> as, rill -> il, fog -> og)
  const echo = rimeOf(B.full.slice(0, 4)).slice(0, 2)
  const hears = (n: string): boolean => echo.length === 2 && n.toLowerCase().slice(2).includes(echo)
  const uniq = (xs: string[]): string[] => [...new Set(xs.map(title))]
  const own = (s: { word: string }): boolean => s.word === A.full || A.full.startsWith(s.word) || s.word.startsWith(A.stem)
  // Words that carry B's sound right at the join come first (B's own family's before the others), then endings built
  // from B's family's sounds that open with it, then words that carry it a little later, and last B's family's other
  // words and built endings.
  const carrying = (list: readonly (Source & { family: Family })[], syl: 2 | 3): (Source & { built?: boolean })[] => {
    const at = (x: Source, n: number): boolean => echo.length === 2 && x.tail.slice(0, n).includes(echo)
    const w = shuffle(rng, list.filter(x => !own(x)))
    const b = syl === 3 ? [] : shuffle(rng, built(fam, syl)).map(x => ({ ...x, built: true }))
    return [
      ...w.filter(x => at(x, 2) && x.family === fam), ...w.filter(x => at(x, 2) && x.family !== fam),
      ...b.filter(x => at(x, 2)).slice(0, CANDIDATES), ...w.filter(x => !at(x, 2) && at(x, 9)),
      ...w.filter(x => !at(x, 9) && x.family === fam), ...b.filter(x => !at(x, 2)).slice(0, CANDIDATES),
    ]
  }
  // built endings close a fusion only when no word will
  const builtNames = new Set<string>()
  const joined = (list: (Source & { built?: boolean })[]): string[] => list.flatMap(s => attach(A, s.tail, s.word, s.overlapOnly)
    .map(n => { if (s.built) builtNames.add(title(n)); return n }))
  // stage 1: the two roots run together (Moth + jasp -> Mothasp, Moss + fog -> Mossfog)
  // B's stressed vowel and the consonant after it, when its whole rhyme will not join (Ebb + amber -> Ebbam)
  const bShort = /^[aeiouy][^aeiouy]/.test(bRime) && bRime.length > 2 ? bRime.slice(0, 2) : ''
  const ones = uniq([
    ...(PAIR_VOWEL.test(bRime) && bRime !== bCore ? [] : attach(A, bRime, bCore)),
    ...(isVowel(bCore[0]) ? [] : attach(A, bCore, bCore)),
    ...(bShort ? attach(A, bShort, bCore) : []),
  ])
  // stage 2: A's root and B's whole root word (Moth + jasper -> Mothasper), else a word that carries B's sound
  const twos = uniq([
    ...(bWord && !PAIR_VOWEL.test(bWord) ? attach(A, bWord, B.full) : []),
    ...joined(carrying(ALL_MID, 2)),
  ])
  // stage 3: a grand word that carries B's sound
  const threes = uniq(joined(carrying(ALL_GRAND, 3)))
  const ok = (n: string, stage: Stage): number => (isSpeciesName(n) ? -1 : usable(n, STAGE_SHAPE[stage], t))
  // a name a species could still be given one day is a last resort, and so is a built ending
  const spare = (n: string): number => (couldBeSpecies(n) ? 0.6 : 0) + (builtNames.has(n) ? 1.2 : 0)
  // the first usable names of each stage, in order, are weighed: their sound, and hearing B outweighs a slightly
  // better sound
  type Weighed = { n: string; v: number; word: string | null }
  const weigh = (list: string[], stage: Stage, count: number): Weighed[] => {
    const out: Weighed[] = []
    for (const n of list) {
      if (out.length >= count) break
      const p = ok(n, stage)
      if (p >= 0) out.push({ n, v: quality(p) + (stage > 1 && hears(n) ? 1 : 0) - spare(n), word: stage > 1 ? wordOf(n) : null })
    }
    return out.sort((x, y) => y.v - x.v)
  }
  const two2 = weigh(twos, 2, 2 * CANDIDATES)
  const three3 = weigh(threes, 3, 2 * CANDIDATES)
  if (!two2.length || !three3.length) throw new Error(`no fusion of ${nameA} and ${nameB}`)
  // when no blend of the two roots is free, stage 1 takes a small word or a built syllable on A's root, B's family's
  // first (the other families' when A's own species have them), and B is heard from stage 2
  const voiced = (): string[] => uniq([fam, ...FAMILY_ORDER.filter(f => f !== fam)].flatMap(f => stageCands(A, f, 1))
    .filter(c => !own(c) && fits(c.name, STAGE_SHAPE[1])).map(c => c.name))
  let best: NameLine | null = null
  let bestQ = -Infinity
  for (const needB of [true, false]) {
    const firsts = needB ? weigh(ones.filter(hears), 1, CANDIDATES) : [...weigh(ones, 1, CANDIDATES), ...weigh(voiced(), 1, CANDIDATES)]
    for (const one of firsts) {
      for (const two of two2) {
        if (one.v + two.v + three3[0]!.v <= bestQ) break
        if (!grows(one.n, two.n)) continue
        for (const three of three3) {
          const q = one.v + two.v + three.v
          if (q <= bestQ) break
          if (!grows(two.n, three.n) || (two.word !== null && two.word === three.word)) continue
          if (three.n.length < one.n.length + 2 || editDistance(one.n.toLowerCase(), three.n.toLowerCase(), 3) < 3) continue
          best = [one.n, two.n, three.n]
          bestQ = q
          break
        }
      }
    }
    if (best) return best
  }
  throw new Error(`no fusion of ${nameA} and ${nameB}`)
}

/** The fusion of A and B at a stage (1, 2 or 3). */
export function fusionName(nameA: string, nameB: string, stage: Stage, taken: Iterable<string> = []): string {
  return fusionLine(nameA, nameB, taken)[stage - 1]!
}

// ---------------------------------------------------------------------------------------------------------------
// The dictionary scan (scripts/names.ts --scan) checks every name the vocabulary can make against a full English
// word list; it needs the candidates without the checks.

/** How a word sounds to the blocklists: its sound key (rubbar = rubber) and its shape by ear (plummit = plummet). */
export function soundShape(word: string): { sound: string; skeleton: string } {
  const w = word.toLowerCase()
  return { sound: soundKey(w), skeleton: skeletonKey(w) }
}

/** Every spelling the vocabulary can make, by where it is used: species stages, legendaries, Mythic words, fusions. */
export function* scanCandidates(): Generator<{ name: string; use: string; root: string; word: string }> {
  for (const f of FAMILY_ORDER) {
    for (const r of VOICES[f].roots) {
      for (const stage of [1, 2, 3] as const) {
        for (const c of stageCands(r, f, stage, true)) yield { name: c.name.toLowerCase(), use: `${f}${stage}`, root: r.full, word: c.word }
      }
    }
    for (const a of VOICES[f].firsts) for (const b of VOICES[f].crowns) yield { name: a + b, use: `${f}-legend`, root: a, word: b }
  }
  for (const r of MYTHIC_ROOTS) {
    for (const [p] of PLACES) yield { name: r + p, use: 'mythic', root: r, word: p }
    for (const b of BEASTS) yield { name: r + b, use: 'mythic', root: r, word: b }
  }
  const allRoots = FAMILY_ORDER.flatMap(f => VOICES[f].roots)
  for (const A of allRoots) {
    for (const B of allRoots) {
      if (A === B) continue
      const bCore = normalStem(B.stem)
      const bRime = rimeOf(bCore)
      const bWord = B.full !== B.stem ? rimeOf(B.full) : ''
      const bShort = /^[aeiouy][^aeiouy]/.test(bRime) && bRime.length > 2 ? bRime.slice(0, 2) : ''
      const forms = [...attach(A, bRime, bCore), ...(isVowel(bCore[0]) ? [] : attach(A, bCore, bCore))]
      if (bShort) forms.push(...attach(A, bShort, bCore))
      if (bWord) forms.push(...attach(A, bWord, B.full))
      for (const n of forms) yield { name: n, use: 'fusion', root: A.full, word: B.full }
    }
    for (const s of [...ALL_MID, ...ALL_GRAND]) {
      for (const n of attach(A, s.tail, s.word, s.overlapOnly)) yield { name: n, use: 'fusion', root: A.full, word: s.word }
    }
    // a fusion that cannot blend its parents' roots takes a stage-1 ending of any family
    for (const f of FAMILY_ORDER) for (const c of stageCands(A, f, 1, true)) yield { name: c.name.toLowerCase(), use: 'fusion', root: A.full, word: c.word }
  }
}
