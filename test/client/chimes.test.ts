import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { CHIME_NAMES, chimeClip, chimeWav } from '../../plugin/hooks/client/chimes.ts'

// SHA-256 and sizes of the four original WAV assets shipped in v0.2.10.
const originals = {
  rare: [20772, '5ab32de5bf8069bd298b3b6b0ab69cdfbb6bd68a3a43c207e42415d780de1f6b'],
  legendary: [50980, '3b403c4d87eea20765e7f9e3514d293e584cd5318ee92678e55cb2755556095d'],
  evolve: [39294, 'e03daf301863fe651d5e41f3282786ac4dca0d47dc0aac01f4efbb753777df62'],
  first: [55170, 'e8ae44acf664dc687be6c0e7086755018c472650e2557758f6069bbcc56ca702'],
} as const

for (const cue of CHIME_NAMES) test(`inspectable ${cue} synthesis preserves the released PCM bytes`, () => {
  const wav = Buffer.from(chimeWav(cue))
  assert.equal(wav.length, originals[cue][0])
  assert.equal(createHash('sha256').update(wav).digest('hex'), originals[cue][1])
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.equal(wav.readUInt16LE(20), 1, 'uncompressed PCM')
  assert.equal(wav.readUInt16LE(22), 1, 'mono')
  assert.equal(wav.readUInt32LE(24), 22050)
  assert.equal(wav.readUInt16LE(34), 16)
  const clip = chimeClip(cue)
  assert.equal(clip.mime, 'audio/wav')
  assert.deepEqual(Buffer.from(clip.base64, 'base64'), wav)
  assert.deepEqual(chimeClip(cue), clip, 'repeated playback uses the same local clip')
  wav.fill(0)
  assert.deepEqual(Buffer.from(chimeClip(cue).base64, 'base64'), Buffer.from(chimeWav(cue)), 'a caller cannot mutate cached clips')
})

test('runtime synthesis contains semantic notes, with no embedded recording or external asset source', () => {
  const source = readFileSync(new URL('../../plugin/hooks/client/chimes.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /[A-Za-z0-9+/]{100,}={0,2}/, 'large encoded recordings must not replace the inspectable synthesis')
  assert.doesNotMatch(source, /https?:|\$\.|\b(?:fetch|atob|btoa)\s*\(/, 'synthesis uses local data and has no external effects')
})
