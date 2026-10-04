import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import * as names from '../../plugin/hooks/core/names.ts'
import { utcDay } from '../../plugin/hooks/core/world.ts'
import { viaEdgeCache } from '../../server/src/worker.ts'
import { DAY, server } from './scaffold-helpers.ts'

const ORIGIN = 'https://spinlings.dev'
const generic = ['/', '/boards', '/market', '/odds', '/privacy']
const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  return [view.getUint32(16), view.getUint32(20)]
}

/** Exercise the real browser world with the same unloaded-name boundary as the website bundle. */
async function meadowScript(): Promise<string> {
  const require = createRequire(import.meta.url)
  const esbuild = createRequire(require.resolve('wrangler/package.json'))('esbuild') as typeof import('esbuild')
  const built = await esbuild.build({
    stdin: { contents: `
      export * from './server/static/client/world.ts';
      export { fuseSite } from './server/src/pages-meet.ts';
      export { bindNames } from './server/static/client/names-stub.ts';
    `, resolveDir: fileURLToPath(new URL('../../', import.meta.url)) },
    bundle: true, write: false, format: 'iife', globalName: 'Meadow', platform: 'browser', target: 'es2022',
    plugins: [{ name: 'browser-frozen-world', setup(b) {
      b.onResolve({ filter: /[\\/]names\.ts$/ }, () => ({ path: fileURLToPath(new URL('../../server/static/client/names-stub.ts', import.meta.url)) }))
      b.onResolve({ filter: /[\\/]generators[\\/]index\.ts$/ }, () => ({ path: fileURLToPath(new URL('../../server/static/client/generators-stub.ts', import.meta.url)) }))
    } }],
  })
  return built.outputFiles[0]!.text
}

function meadow(script: string, world: Record<string, unknown>, saved: Record<string, unknown>) {
  const storage = new Map([['spinlings.site.v1', JSON.stringify(saved)]])
  const sandbox = {
    document: {
      documentElement: { dataset: { hour: 'morning' } },
      querySelector: (s: string) => s === 'main' ? { getAttribute: () => JSON.stringify(world) } : null,
    },
    matchMedia: () => ({ matches: false }), crypto,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  }
  vm.runInNewContext(script, sandbox)
  return (sandbox as typeof sandbox & { Meadow: {
    W: Record<string, unknown> | null; T: { lead: { appearance: { names: string[] }; stats: { hp: number }; stage: number } };
    restore(): boolean; regulars(): unknown[]; growth(xp: number): { card: { appearance: { names: string[] }; stats: { hp: number }; stage: number } };
    bindNames(m: Record<string, unknown>): void;
    fuseSite(world: Record<string, unknown>, a: unknown, b: unknown, rng: () => number): { form: { kind: string }; parentForms: [{ names: string[] }, unknown]; stats: { hp: number } };
  } }).Meadow
}

describe('launch links and search previews', () => {
  it('boots, restores, evolves and fuses from inline frozen forms without browser species generation, independently per page', async () => {
    const s = server({ origin: ORIGIN })
    const html = await (await s.request('GET', '/', { client: null })).text()
    const raw = html.match(/data-world="([^"]*)"/)![1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    const world = JSON.parse(raw)
    const selected = world.species.find((form: { id: string }) => form.id === world.featured)
    selected.names = ['Willow', 'Willowen', 'Willowhollow']
    selected.base.hp = 700
    world.found = [selected.id]
    world.foundToday = []
    // An earlier kept meeting exercises historical featuredSpecies lookup as well as card minting.
    const earlier = utcDay(s.now() - DAY).replace(/-/g, '')
    const saved = { seed: `${earlier}-morning-aaaaaaaa`, entry: selected.id, level: 3, xp: 100, t: Date.now() }
    const script = await meadowScript()
    const first = meadow(script, world, saved)
    assert.ok(first.W, 'valid inline species enable the interactive meadow')
    assert.equal(first.restore(), true)
    assert.equal(first.T.lead.appearance.names[0], 'Willow')
    assert.ok(first.T.lead.stats.hp > 700, 'stats use the provided base')
    assert.equal(first.regulars().length, 2)
    const growth = first.growth(120).card
    assert.equal(growth.stage, 2)
    assert.equal(growth.appearance.names[1], 'Willowen')
    assert.ok(growth.stats.hp > first.T.lead.stats.hp)
    // Fusion loads its own real names; even then browser species generation remains unavailable.
    first.bindNames({ ...names, speciesNames: () => { throw new Error('browser attempted species naming') } })
    const hybrid = first.fuseSite(first.W!, first.T.lead, first.regulars()[0], () => 0.5)
    assert.equal(hybrid.form.kind, 'fusion')
    assert.equal(hybrid.parentForms[0].names[0], 'Willow')
    assert.ok(hybrid.stats.hp > 300, 'fusion uses the frozen parent stats')
    const secondWorld = structuredClone(world)
    secondWorld.species.find((form: { id: string }) => form.id === selected.id).names = ['Cinder', 'Cinderon', 'Cinderhollow']
    const second = meadow(script, secondWorld, saved)
    assert.equal(second.restore(), true)
    assert.equal(second.T.lead.appearance.names[0], 'Cinder')
    assert.equal(first.T.lead.appearance.names[0], 'Willow', 'a second page never replaces the first page catalog')
    assert.equal(meadow(script, { ...world, species: [] }, saved).W, null, 'malformed inline data does not guess fresh species')
  })

  it('uses the configured canonical origin and stable first-party previews on every generic page', async () => {
    const s = server({ origin: ORIGIN })
    for (const path of generic) {
      const res = await s.request('GET', path + '?utm_source=launch&untrusted=private-value', { client: null })
      assert.equal(res.status, 200, path)
      const page = await res.text()
      assert.ok(page.includes(`<link rel="canonical" href="${ORIGIN}${path}">`), path)
      assert.ok(page.includes(`<meta property="og:url" content="${ORIGIN}${path}">`), path)
      assert.ok(page.includes(`<meta property="og:image" content="${ORIGIN}/og/meadow.png">`), path)
      assert.ok(page.includes(`<meta name="twitter:image" content="${ORIGIN}/og/meadow.png">`), path)
      assert.match(page, /<meta name="twitter:card" content="summary_large_image">/)
      assert.match(page, /<meta name="twitter:image:alt" content="[^"]+">/)
      assert.match(page, /<meta property="og:image:type" content="image\/png">/)
      assert.doesNotMatch(page, /utm_source|untrusted|private-value/)
      assert.equal(res.headers.get('set-cookie'), null)
    }
    const boards = await (await s.request('GET', '/boards?board=species&period=season', { client: null })).text()
    assert.ok(boards.includes(`<link rel="canonical" href="${ORIGIN}/boards">`))
  })

  it('publishes only generic sitemap paths, with robots leaving art and scripts available', async () => {
    const s = server({ origin: ORIGIN })
    const player = await s.join()
    const sitemap = await s.request('GET', '/sitemap.xml?secret=private-value', { client: null })
    assert.equal(sitemap.status, 200)
    assert.equal(sitemap.headers.get('content-type'), 'application/xml; charset=utf-8')
    assert.equal(sitemap.headers.get('cache-control'), 'public, max-age=3600')
    const xml = await sitemap.text()
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/)
    assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]), generic.map(path => ORIGIN + path))
    for (const privateValue of [player.token, player.id, player.me.player.handle, 'private-value', '/account', '/passkey', '/u/', '/c/', '/g/', '/w/', '/v1/']) assert.ok(!xml.includes(privateValue), 'private values stay outside the sitemap')
    const robots = await s.request('GET', '/robots.txt', { client: null })
    assert.equal(robots.status, 200)
    assert.equal(robots.headers.get('content-type'), 'text/plain; charset=utf-8')
    const lines = await robots.text()
    assert.ok(lines.includes(`Sitemap: ${ORIGIN}/sitemap.xml\n`))
    for (const path of ['/v1/', '/account', '/passkey/', '/g/']) assert.ok(lines.includes(`Disallow: ${path}\n`))
    assert.doesNotMatch(lines, /Disallow: \/(?:static|og|c|w)\//, 'public render assets and noindex pages remain readable')
  })

  it('keeps private and missing pages out of social previews and never turns tickets into canonical links', async () => {
    const s = server({ origin: ORIGIN })
    for (const [path, status] of [['/account?t=private-value', 200], ['/passkey/signin?t=private-value', 410], ['/not-here?secret=private-value', 404]] as const) {
      const res = await s.request('GET', path, { client: null, headers: { accept: 'text/html' } })
      assert.equal(res.status, status, path)
      const page = await res.text()
      assert.match(page, /<meta name="robots" content="noindex">/)
      assert.doesNotMatch(page, /rel="canonical"|property="og:|name="twitter:|private-value/)
    }
  })

  it('keeps the stable meadow valid across days and seasons while preserving the dated image contract', async () => {
    const s = server({ origin: ORIGIN })
    const originalDay = utcDay(s.now()).replace(/-/g, '')
    for (const jump of [0, DAY, 30 * DAY]) {
      s.tick(jump)
      const stable = await s.request('GET', '/og/meadow.png?untrusted=private-value', { client: null })
      assert.equal(stable.status, 200)
      assert.equal(stable.headers.get('content-type'), 'image/png')
      assert.equal(stable.headers.get('cache-control'), 'public, max-age=3600')
      const bytes = new Uint8Array(await stable.arrayBuffer())
      assert.deepEqual(pngSize(bytes), [1200, 630])
      assert.ok(bytes.length < 150 * 1024)
      const day = utcDay(s.now()).replace(/-/g, '')
      const dated = await s.request('GET', `/og/meadow-${day}.png`, { client: null })
      assert.equal(dated.status, 200)
      assert.equal(dated.headers.get('cache-control'), 'public, max-age=86400')
      assert.deepEqual(new Uint8Array(await dated.arrayBuffer()), bytes, 'both names reuse the same daily drawing')
      if (jump === 30 * DAY) assert.equal((await s.request('GET', `/og/meadow-${originalDay}.png`, { client: null })).status, 404)
    }
  })

  it('caches only successful share PNGs at the edge, including the stable alias without query parameters', async () => {
    const stored = new Map<string, Response>()
    const cache = {
      match: async (req: Request) => stored.get(req.url)?.clone(),
      put: async (req: Request, res: Response) => { stored.set(req.url, res) },
    }
    const waits: Promise<unknown>[] = []
    let answers = 0
    const get = async (path: string, status = 200, type = 'image/png') => {
      const res = await viaEdgeCache(new Request(ORIGIN + path), cache, { waitUntil: p => waits.push(p) }, async () => {
        answers++
        return new Response('png', { status, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600' } })
      })
      await Promise.all(waits)
      return res
    }
    await get('/og/meadow.png')
    await get('/og/meadow.png?utm_source=x&e=haiku/1')
    assert.equal(answers, 1)
    assert.deepEqual([...stored.keys()], [ORIGIN + '/og/meadow.png'])
    assert.equal((await get('/og/meadow.png')).headers.get('cache-control'), 'public, max-age=3600')
    for (const path of ['/account', '/c/private.png', '/og/not-meadow.png', '/sitemap.xml']) await get(path)
    await get('/og/meadow-19990101.png', 404, 'text/html; charset=utf-8')
    assert.equal(answers, 6)
    assert.equal(stored.size, 1)
  })

  it('restores each public share TTL on cache hits without drawing again or touching private routes', async () => {
    const pixels = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 11, 43])
    const cached = new Response(pixels, { status: 200, statusText: 'OK', headers: {
      'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=14400',
      'CF-Cache-Status': 'HIT', Age: '40', ETag: '"drawing"', 'X-Content-Type-Options': 'nosniff',
    } })
    const matched: string[] = []
    let answers = 0, stores = 0, waits = 0
    const cache = {
      match: async (req: Request) => { matched.push(req.url); return cached.clone() },
      put: async () => { stores++ },
    }
    const context = { waitUntil: () => { waits++ } }
    for (const [path, policy] of [
      ['/og/meadow.png?utm_source=release&e=ignored', 'public, max-age=3600'],
      ['/og/meadow-20261004.png', 'public, max-age=86400'],
      ['/w/20261004-night-abcdefgh.png?e=haiku%2F1&ignored=value', 'public, max-age=86400'],
    ]) {
      const res = await viaEdgeCache(new Request(ORIGIN + path), cache, context, async () => {
        answers++
        throw new Error('A cached public image never runs the app')
      })
      assert.equal(res.status, 200)
      assert.equal(res.statusText, 'OK')
      assert.equal(res.headers.get('cache-control'), policy)
      for (const name of ['content-type', 'cf-cache-status', 'age', 'etag', 'x-content-type-options']) assert.equal(res.headers.get(name), cached.headers.get(name), name)
      assert.deepEqual(new Uint8Array(await res.arrayBuffer()), pixels)
    }
    assert.deepEqual(matched, [ORIGIN + '/og/meadow.png', ORIGIN + '/og/meadow-20261004.png', ORIGIN + '/w/20261004-night-abcdefgh.png?e=haiku/1'])
    assert.equal(cached.headers.get('cache-control'), 'public, max-age=14400', 'the cached response itself is unchanged')
    assert.equal(answers, 0)
    assert.equal(stores, 0)
    assert.equal(waits, 0)
    for (const path of ['/account', '/account/cards', '/passkey/signin', '/v1/me', '/c/public-card.png']) {
      const res = await viaEdgeCache(new Request(ORIGIN + path), cache, context, async () => {
        answers++
        return new Response('private', { headers: { 'Cache-Control': 'no-store' } })
      })
      assert.equal(res.headers.get('cache-control'), 'no-store')
      assert.equal(await res.text(), 'private')
    }
    assert.equal(answers, 5)
    assert.equal(matched.length, 3, 'private and excluded public-card routes never look in the share image cache')
    assert.equal(stores, 0)
  })
})
