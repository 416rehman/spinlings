// First-party browser account access. The session stays in this tab, never in a URL, page,
// cookie or localStorage. Every request stays on this origin and uses the mod's existing API.
export const ACCOUNT_JS = String.raw`(function () {
'use strict'
var $ = function(id) { return document.getElementById(id) }
if (!$('account')) return
var key = 'spinlings-session', token = '', me = null, cards = [], next = null, version = null, generation = 0, rankGeneration = 0, usernameGeneration = 0, renaming = false
var seasons = {}, colors = {common:'#9aa3ad',rare:'#4f8ff0',epic:'#b06ef3',legendary:'#f2b33d'}
try { token = sessionStorage.getItem(key) || '' } catch (_) {}
function say(message) { $('account-status').textContent = message }
function store(value) { token = value; try { value ? sessionStorage.setItem(key,value) : sessionStorage.removeItem(key) } catch (_) {} }
function clear(message) {
  generation++; rankGeneration++; usernameGeneration++; renaming = false; store(''); me = null; cards = []; next = null; version = null
  closeUsername(); $('username-status').textContent = ''; $('username-note').textContent = ''
  $('dashboard').hidden = true; $('signout').hidden = true; $('signedout').hidden = false
  ;['teamcards','stats','mybalance','collection','myhandle','rank','inventory'].forEach(function(id) { $(id).replaceChildren() })
  $('refresh').disabled = false; say(message || '')
}
async function request(path, method, body, authenticated) {
  var headers = {}, held = authenticated ? token : ''
  if (held) headers.Authorization = 'Bearer ' + held
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  var res = await fetch(path,{method:method || 'GET',headers:headers,body:body === undefined ? undefined : JSON.stringify(body),credentials:'omit',redirect:'error',cache:'no-store'})
  var data = await res.json()
  if (!res.ok) {
    if (res.status === 401 && authenticated && token === held) clear('Sign in again to see your collection.')
    throw new Error(res.status === 401 ? 'Sign in again to see your collection.' : (data.error && data.error.message || 'Could not load this. Try again.'))
  }
  return data
}
function element(tag, text) { var node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); return node }
function capital(text) { return text.charAt(0).toUpperCase() + text.slice(1) }
function closeUsername() {
  $('username-form').hidden = true; $('username-change').setAttribute('aria-expanded','false')
  $('username').value = ''; $('username').removeAttribute('aria-invalid')
}
function renderUsername() {
  if (!me) return
  var day = me.player.handleRerollFrom, locked = day && day > new Date().toISOString().slice(0,10), busy = renaming || $('refresh').disabled || $('signout').disabled
  $('myhandle').textContent = me.player.handle
  $('username-change').disabled = !!locked || busy
  ;['username','username-save','username-cancel'].forEach(function(id){$(id).disabled = busy})
  $('username-note').textContent = (locked ? 'Change again on '+day+' UTC. ' : 'Once a week. ')+'Your account and passkeys stay the same.'
  if (locked) closeUsername()
}
function name(c) { var form = c.form || (seasons[c.species.split('-')[0].slice(1)] || []).find(function(s) {return s.id === c.species}); return form ? form.names[c.stage-1] : 'Spinling' }
function stat(label,value) { var node = element('div'); node.className = 'accountstat'; node.append(element('b',value),element('span',label)); return node }
async function loadSeasons(batch) {
  var needed = Array.from(new Set(batch.filter(function(c) {return !c.form && /^s\d+-/.test(c.species)}).map(function(c) {return c.species.split('-')[0].slice(1)})))
  await Promise.all(needed.map(async function(n) {if (!seasons[n]) seasons[n] = (await request('/v1/season/'+n)).species}))
}
function card(c) {
  var node = element('article'); node.className = 'accountcard'; node.style.setProperty('--rar',colors[c.rarity] || colors.common)
  var link = element('a',name(c)); link.href = '/c/'+encodeURIComponent(c.id)
  var img = element('img'); img.src = '/c/'+encodeURIComponent(c.id)+'/art.svg'; img.alt = name(c); img.width = img.height = 96; img.loading = 'lazy'
  node.append(img,link,element('p',capital(c.family)+' · '+capital(c.rarity)+' · Level '+c.level),element('p',[c.shiny?'Shiny':'',c.foil?'Foil':'',c.bound?'Stays with you':'',c.state==='escrow'?'Held for a trade, gift or sale':'',c.forTrade?'For trade':''].filter(Boolean).join(' · ')))
  var details = element('details'); details.append(element('summary','Stats & traits'))
  if (c.stats) details.append(element('p','HP '+c.stats.hp+' · Attack '+c.stats.atk+' · Defense '+c.stats.def+' · Speed '+c.stats.spd))
  var genes = c.genes || {}; var values = Array.isArray(genes) ? genes : Object.values(genes)
  if (values.length === 4) details.append(element('p','Gene quality '+Math.round(values.reduce(function(a,b){return a+b},0)/60*100)+'%'))
  if (c.traits && c.traits.length) details.append(element('p','Traits: '+c.traits.map(function(t){return capital(t.replace(/([A-Z])/g,' $1'))}).join(', ')))
  node.append(details); return node
}
function renderCards() {
  var family = $('family').value, rarity = $('rarity').value
  var filtered = cards.filter(function(c){return (!family || c.family===family) && (!rarity || c.rarity===rarity)})
  $('collection').replaceChildren.apply($('collection'),filtered.map(card)); $('more').hidden = !next
  $('inventory').textContent = cards.length+' cards'+(next?' loaded · more waiting':'')+' · '+me.packs.length+' unopened packs · '+(me.listings || []).length+' market listings · '+me.player.seen.length+' species discovered'
  var team = me.player.team.map(function(id){return cards.find(function(c){return c.id===id})}).filter(Boolean)
  $('teamcards').replaceChildren.apply($('teamcards'),team.map(card))
  if (team.length < me.player.team.length && next) $('teamcards').append(element('p','Load more cards to see the rest of your team.'))
}
async function rankings() {
  if (!token || !me) return
  var revision = ++rankGeneration, held = token, board = $('board').value, period = $('period').value
  $('rank').textContent = 'Finding your place…'; $('publicboard').href = '/boards?board='+board+'&period='+period
  try {
    var data = await request('/v1/leaderboards?board='+board+'&period='+period,'GET',undefined,true)
    if (revision !== rankGeneration || held !== token) return
    $('rank').textContent = !me.player.leaderboard ? 'You are hidden from the leaderboards.' : data.me ? '#'+data.me.rank+' · '+data.me.value.toLocaleString('en-US')+' '+$('board').selectedOptions[0].textContent.toLowerCase() : 'No place yet. Qualifying results appear after midnight UTC.'
  } catch(e) {if (revision === rankGeneration) $('rank').textContent = e.message}
}
async function refresh() {
  if (!token || renaming) return
  var revision = ++generation, held = token
  $('refresh').disabled = true; renderUsername(); say('Loading your collection…')
  try {
    var results = await Promise.all([request('/v1/me','GET',undefined,true),request('/v1/cards','GET',undefined,true)])
    await loadSeasons(results[1].cards)
    if (revision !== generation || held !== token) return
    me = results[0]; cards = results[1].cards; next = results[1].next || null; version = results[1].version
    $('mybalance').replaceChildren(stat('✦ Sparks · crafting & packs',me.player.sparks),stat('★ Duel rating',me.player.rating),stat('League',me.player.league),stat('Consecutive wins',me.player.streak))
    var labels = {duelWins:'⚔ Duel wins',duelLosses:'Duel losses',playersBeaten:'Players beaten',wildWins:'Wild wins',catches:'Catches',speciesCollected:'Species collected',firstFinds:'First discoveries',mythicsFound:'Mythics found',marketSales:'Market sales'}
    $('stats').replaceChildren.apply($('stats'),Object.keys(labels).map(function(k){return stat(labels[k],(me.player.stats || {})[k] || 0)}))
    renderCards(); $('dashboard').hidden = false; $('signout').hidden = false; $('signedout').hidden = true; say('')
    await rankings()
  } catch(e) {if (revision === generation) say(e.message)}
  finally {if (revision === generation) {$('refresh').disabled = false; renderUsername()}}
}
function bytes(s) {var b = atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)); return Uint8Array.from(b,function(c){return c.charCodeAt(0)})}
function encoded(buf) {return btoa(Array.from(new Uint8Array(buf),function(b){return String.fromCharCode(b)}).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
$('signin').addEventListener('click',async function() {
  $('signin').disabled = true; say('Choose your saved Spinlings passkey…')
  var revision = ++generation
  try {
    if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('This browser cannot use passkeys.')
    var start = await request('/account/signin/start','POST',{})
    var options = start.options; options.challenge = bytes(options.challenge)
    var credential = await navigator.credentials.get({publicKey:options})
    if (!credential) throw new Error('Sign-in was cancelled.')
    var response = credential.response
    var body = {ticket:start.ticket,id:credential.id,clientData:encoded(response.clientDataJSON),authenticator:encoded(response.authenticatorData),signature:encoded(response.signature)}
    if (response.userHandle) body.userHandle = encoded(response.userHandle)
    await request('/passkey/signin/finish','POST',body)
    var done = await request('/v1/auth/poll/'+start.pollId)
    if (done.status !== 'done' || revision !== generation) throw new Error('Sign-in did not complete. Try again.')
    store(done.token); await refresh()
  } catch(e) {say(e.name==='NotAllowedError'?'Sign-in was cancelled. You can try again.':e.message)}
  finally {$('signin').disabled = false}
})
$('signout').addEventListener('click',async function() {
  $('signout').disabled = true; usernameGeneration++; renaming = false; closeUsername(); renderUsername()
  try {await request('/account/signout','DELETE',undefined,true); clear(); say('Signed out of this browser tab.')}
  catch(e) {say(token ? 'Could not sign out. Try again to close this session.' : 'This browser session has expired. Sign in again to see your collection.')}
  finally {$('signout').disabled = false; if (!renaming) $('refresh').disabled = false; renderUsername()}
})
$('username-change').addEventListener('click',function() {
  if (!me || $('username-change').disabled) return
  $('username').value = me.player.handle; $('username-status').textContent = ''; $('username-form').hidden = false
  $('username-change').setAttribute('aria-expanded','true'); $('username').focus(); $('username').select()
})
$('username-cancel').addEventListener('click',function() {if (!renaming) {closeUsername(); $('username-status').textContent = ''; $('username-change').focus()}})
$('username').addEventListener('input',function() {$('username').removeAttribute('aria-invalid'); $('username-status').textContent = ''})
$('username-form').addEventListener('submit',async function(event) {
  event.preventDefault()
  if (!token || !me || renaming || $('refresh').disabled || $('signout').disabled) return
  var value = $('username').value.trim()
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(value)) {$('username-status').textContent = 'Use 1–40 letters, numbers, _ or -.'; $('username').setAttribute('aria-invalid','true'); $('username').focus(); return}
  var revision = ++usernameGeneration, held = token
  renaming = true; $('refresh').disabled = true; renderUsername(); $('username-status').textContent = 'Saving username…'
  try {
    var result = await request('/v1/me/handle','POST',{handle:value},true)
    if (revision !== usernameGeneration || held !== token || !me) return
    me.player.handle = result.handle; me.player.handleRerollFrom = result.handleRerollFrom
    closeUsername(); $('username-status').textContent = 'Username saved.'
  } catch(e) {
    if (revision === usernameGeneration && held === token) {$('username-status').textContent = e.message; $('username').setAttribute('aria-invalid','true')}
  } finally {
    if (revision === usernameGeneration && held === token) {renaming = false; $('refresh').disabled = false; renderUsername(); if (!$('username-form').hidden) $('username').focus()}
  }
})
$('more').addEventListener('click',async function() {
  if (!next) return
  var revision = generation, held = token; $('more').disabled = true
  try {
    var page = await request('/v1/cards?after='+encodeURIComponent(next),'GET',undefined,true)
    if (revision !== generation || held !== token) return
    if (page.version !== version) {await refresh(); return}
    await loadSeasons(page.cards)
    if (revision !== generation || held !== token) return
    cards = cards.concat(page.cards); next = page.next || null; renderCards()
  } catch(e) {say(e.message)} finally {$('more').disabled = false}
})
;['family','rarity'].forEach(function(id){$(id).addEventListener('change',renderCards)})
;['board','period'].forEach(function(id){$(id).addEventListener('change',rankings)})
$('refresh').addEventListener('click',refresh)
if (token) refresh()
})()`
