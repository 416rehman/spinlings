import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { leadingZeroBits, proofBits, sha256, sha256Hex, solveProofOfWork } from '../../plugin/hooks/core/sha256.ts'

test('NIST vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'), '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  assert.equal(sha256Hex('a'.repeat(1_000_000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
})

test('agrees with node:crypto across block boundaries and UTF-8', () => {
  for (let n = 0; n < 200; n++) {
    const s = 'x'.repeat(n) + (n % 7 === 0 ? 'é🟩' : '')
    assert.equal(sha256Hex(s), createHash('sha256').update(s).digest('hex'), `length ${n}`)
  }
})

test('proof of work counts leading zero bits exactly, and the solver meets any difficulty', () => {
  assert.deepEqual([[0x80], [0x40], [0x01], [0, 0xff], [0, 0, 0x10], [0, 0]].map(b => leadingZeroBits(new Uint8Array(b))), [0, 1, 7, 8, 19, 16])
  for (const bits of [1, 5, 9, 13]) {
    const nonce = solveProofOfWork('challenge-abc', bits)!
    assert.match(nonce, /^[0-9a-z]+$/)
    assert.ok(proofBits('challenge-abc', nonce) >= bits, `${bits} bits`)
    assert.equal(proofBits('challenge-abc', nonce), leadingZeroBits(sha256(`challenge-abc:${nonce}`)))
  }
  assert.equal(solveProofOfWork('c', 64, 10), null)
})
