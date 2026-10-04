import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { server } from './scaffold-helpers.ts'

const origin = 'http://localhost:8787'
// Run the actual public-page listener without booting the unrelated meadow animation.
const source = readFileSync(new URL('../../server/static/client/site.ts',import.meta.url),'utf8')
const start = source.indexOf('function profiles() {')
const listener = stripTypeScriptTypes(source.slice(start,source.indexOf('\n/**',start))+'\nprofiles()')

function page(share?: (data: {url:string}) => Promise<void>, copy = true) {
  let click: () => Promise<void> = async () => {}
  const button = { dataset: {profileShare:'/u/cozy_heron-42'}, addEventListener: (_: string, fn: () => Promise<void>) => {click = fn} }
  const status = {textContent:''}, copied: string[] = []
  let selected = false
  vm.runInNewContext(listener,{
    $: (selector: string) => selector === '[data-profile-share]' ? button : status,
    location: {origin,href:origin+'/u/cozy_heron-42?discard=private#discard'}, navigator: {share},
    copyText: async (text: string) => {copied.push(text); return copy}, selectText: () => {selected = true},
  })
  return {click: () => click(),status,copied,selected:() => selected}
}

describe('public profile sharing', () => {
  it('adds one share action to the existing camp and uses its canonical public URL', async () => {
    const s = server(); const p = await s.join()
    const html = await (await s.request('GET','/u/'+p.me.player.handle+'?private=discarded')).text()
    assert.equal((html.match(/data-profile-share=/g) ?? []).length,1)
    assert.ok(html.includes('data-profile-share="/u/'+encodeURIComponent(p.me.player.handle)+'"'))
    assert.match(html, /class="pbtn js-only" type="button" data-profile-share=/)
    assert.match(html, /id="profile-share-status" role="status" aria-live="polite"/)
    assert.ok(!html.includes(p.token))
  })

  it('uses native sharing with only the public URL and honors cancellation', async () => {
    const shares: {url:string}[] = []
    const view = page(async data => {shares.push({...data})})
    await view.click()
    assert.deepEqual(shares,[{url:origin+'/u/cozy_heron-42'}])
    assert.deepEqual(view.copied,[])
    const cancelled = page(async () => {const e = new Error('Cancelled'); e.name = 'AbortError'; throw e})
    await cancelled.click()
    assert.deepEqual(cancelled.copied,[])
    assert.equal(cancelled.status.textContent,'')
  })

  it('falls back to copying or selects the public link for manual copying when refused', async () => {
    const copied = page()
    await copied.click()
    assert.deepEqual(copied.copied,[origin+'/u/cozy_heron-42'])
    assert.equal(copied.status.textContent,'Profile link copied.')
    assert.equal(copied.selected(),false)
    const refused = page(async () => {throw new Error('Unavailable')},false)
    await refused.click()
    assert.deepEqual(refused.copied,[origin+'/u/cozy_heron-42'])
    assert.equal(refused.status.textContent,'Copy this profile link: '+origin+'/u/cozy_heron-42')
    assert.equal(refused.selected(),true)
  })
})
