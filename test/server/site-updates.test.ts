// The install sign's third step and the privacy page's table of what the mod touches on your computer (SPEC 32, 34):
// every install sign ends with /spin updates, apart from the two commands that install and copyable like them, and
// /privacy says which file is read, which is written and when, and that settings.json is never opened.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { INSTALL_STEPS, UPDATES_BY_HAND, UPDATES_STEP } from '../../server/src/pages-html.ts'
import { UPDATE_ENV } from '../../server/src/pages-info.ts'
import { server } from './scaffold-helpers.ts'
import type { Server } from './scaffold-helpers.ts'

let visits = 0
async function page(s: Server, path: string): Promise<string> {
  const response = await s.request('GET', path, { client: null, ip: `198.18.${visits >> 8 & 255}.${++visits & 255}` })
  assert.equal(response.status, 200, path)
  return response.text()
}
/** What a reader gets: no styles, no tags, and a name split for wrapping read whole again. */
const words = (markup: string) => markup.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<wbr>/g, '').replace(/<[^>]+>/g, ' ')
  .replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').replace(/ ([.,])/g, '$1')
/** Each install sign on the page, from its opening tag to the end of its last line. */
const signs = (markup: string) => [...markup.matchAll(/<div class="install" data-install>([\s\S]*?)\n<\/div>/g)].map(m => m[1]!)

describe('the install sign', () => {
  it('ends every sign with the optional third line, after the two commands that install', async () => {
    const s = server()
    const a = await s.join('haiku')
    const pages = ['/', '/boards', `/u/${a.me.player.handle}`, `/c/${a.me.player.team[0]}`]
    let seen = 0
    for (const path of pages) {
      for (const sign of signs(await page(s, path))) {
        seen++
        const text = words(sign)
        const at = INSTALL_STEPS.map(step => text.indexOf(step))
        assert.ok(at.every(i => i >= 0), `${path}: both install commands, as they are`)
        const third = text.indexOf(`> ${UPDATES_STEP}`)
        assert.ok(third > Math.max(...at), `${path}: /spin updates comes third`)
        assert.ok(text.includes('Updates by themselves optional'), `${path}: named, and marked optional`)
        assert.ok(text.includes('Run it in your new session and press Turn it on.'), `${path}: what to press`)
        assert.ok(text.includes(`Or, in a terminal: ${UPDATES_BY_HAND[0]} → then ${UPDATES_BY_HAND.slice(1).join(' → then ')}.`), `${path}: the /plugin way`)
        // the /plugin way starts a line of its own, so the command never ends one line with its path on the next
        // and it says where that menu is: Claude Desktop's own /plugin page has no auto-update toggle
        assert.match(sign, /press <b>Turn it on<\/b>\.<br>Or, in a terminal: <code>/, `${path}: the /plugin way on its own line`)
        // the same prompt box as the others: the caret line, then Copy; the blinking caret stays on the install line
        assert.match(sign, /<div class="prompt"><pre aria-labelledby="[\w-]+-then"><span class="gt" aria-hidden="true">&gt;<\/span><code><span class="w">\/spin<\/span> <span class="w">updates<\/span><\/code><\/pre>\n<button class="pbtn copy js-only" type="button" data-copy>/)
        assert.equal((sign.match(/class="caret"/g) ?? []).length, 1, `${path}: one caret`)
        assert.ok(sign.indexOf('class="caret"') < sign.indexOf('class="then"'), `${path}: the caret stays on the install line`)
        assert.doesNotMatch(text, /never|no sign-up|telemetry|tokens/i, `${path}: nothing defensive`)
      }
    }
    assert.ok(seen >= 5, 'the landing has two signs, and every other page one')
  })

  it('reads the menu path as words to a screen reader and wraps only before an arrow', async () => {
    const markup = await page(server(), '/')
    const hand = markup.slice(markup.indexOf('Run it in your new session'), markup.indexOf('</p>', markup.indexOf('Run it in your new session')))
    assert.equal((hand.match(/<span class="mstep"><span aria-hidden="true">→ <\/span><span class="sr">then <\/span>/g) ?? []).length, UPDATES_BY_HAND.length - 1)
    assert.match(markup, /\.install \.mstep\{white-space:nowrap\}/)
  })
})

describe('the privacy page', () => {
  it('has a table of what the mod reads and writes on your computer', async () => {
    const markup = await page(server(), '/privacy')
    const table = markup.slice(markup.indexOf('<table class="table touch">'), markup.indexOf('</table>', markup.indexOf('<table class="table touch">')))
    assert.ok(table.length > 0, 'the table is there')
    const text = words(table)
    assert.match(text, /What Read Written/)
    assert.match(text, /Claude Code's plugin list known_marketplaces\.json When a session starts, while \/spin updates is open, before the band offers updates, when you run \/spin version, and around your press Only when you press Turn it on or Turn it off, and only the spinlings entry's autoUpdate switch/)
    assert.match(text, /settings\.json Never opened Never/)
    for (const name of UPDATE_ENV) assert.ok(text.includes(name), `names ${name}`)
    assert.match(text, /CLAUDE_CODE_AUTOUPDATER_DISABLED_BY_HOST Only whether each is switched on Never/)
    assert.match(text, /Any other file Never Never/)
    // phones get one row per thing, with its own Read and Written labels
    for (const h of ['Read', 'Written']) assert.equal((table.match(new RegExp(`data-h="${h}"`, 'g')) ?? []).length, 4)
    const prose = words(markup)
    assert.ok(prose.includes('Only the spinlings entry\'s on or off switch is kept from the plugin list, and only whether each of those switches is on; nothing from them is sent'))
    assert.ok(prose.includes('Claude Code itself fetches the spinlings repository from GitHub when it starts'))
    assert.doesNotMatch(prose, /how many helpers|context fill|never uses files|environment variables\./, 'no claim the mod no longer makes, or never made')
  })
})
