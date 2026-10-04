// First-party browser account access. The session stays in this tab, never in a URL, page,
// cookie or localStorage. Every request stays on this origin and uses the mod's existing API.
import { sha256Hex } from '../../plugin/hooks/core/sha256.ts'
import { CARD_HELP } from '../src/card-guide.ts'

export const ACCOUNT_JS = String.raw`(function () {
'use strict'
var $ = function(id) { return document.getElementById(id) }
if (!$('account')) return
var key = 'spinlings-session', token = '', me = null, cards = [], team = [], next = null, version = null, generation = 0, rankGeneration = 0, usernameGeneration = 0, browseGeneration = 0, renaming = false, browsing = false, total = 0, matched = 0, currentQuery = '', hintId = 0, activeHint = null, section = 'collection'
var seasons = {}, colors = {common:'#9aa3ad',rare:'#4f8ff0',epic:'#b06ef3',legendary:'#f2b33d'}, familyColors = {haiku:'#4da86f',sonnet:'#5b8def',opus:'#df714c',fable:'#a874e8'}, marks = {haiku:'✿',sonnet:'≈',opus:'☀',fable:'☾'}
var help = ${JSON.stringify(CARD_HELP)}
try { token = sessionStorage.getItem(key) || '' } catch (_) {}
function say(message) { $('account-status').textContent = message }
function store(value) { token = value; try { value ? sessionStorage.setItem(key,value) : sessionStorage.removeItem(key) } catch (_) {} }
function clear(message) {
  generation++; rankGeneration++; usernameGeneration++; browseGeneration++; renaming = false; browsing = false; store(''); me = null; cards = []; team = []; next = null; version = null; total = matched = 0
  if (activeHint) activeHint.hide()
  resetFilters(); $('collection').setAttribute('aria-busy','false'); $('more').hidden = true; $('more').disabled = false
  closeUsername(); $('username-status').textContent = ''; $('username-note').textContent = ''
  $('dashboard').hidden = true; $('signout').hidden = true; $('signedout').hidden = false
  ;['teamcards','stats','mybalance','collection','myhandle','rank','inventory','collection-status','profile-art'].forEach(function(id) { $(id).replaceChildren() })
  showSection('collection')
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
    var error = new Error(res.status === 401 ? 'Sign in again to see your collection.' : (data.error && data.error.message || 'Could not load this. Try again.')); error.status = res.status; throw error
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
  $('username-note').textContent = locked ? 'Next change: '+day+' UTC.' : 'Next change: 7 days after saving.'
  $('username-change').title = locked ? 'Change username on '+day+' UTC' : 'Change username'
  if (locked) closeUsername()
}
function name(c) { var form = c.form || (seasons[c.species.split('-')[0].slice(1)] || []).find(function(s) {return s.id === c.species}); return form ? form.names[c.stage-1] : 'Spinling' }
function stat(label,value,tip) { var node = element('div'); node.className = 'accountstat'; if(tip){node.title = tip; node.setAttribute('role','group'); node.setAttribute('aria-label',label+' '+value+'. '+tip)} node.append(element('b',value),element('span',label)); return node }
async function loadSeasons(batch) {
  var needed = Array.from(new Set(batch.filter(function(c) {return !c.form && /^s\d+-/.test(c.species)}).map(function(c) {return c.species.split('-')[0].slice(1)})))
  await Promise.all(needed.map(async function(n) {if (!seasons[n]) seasons[n] = (await request('/v1/season/'+n)).species}))
}
function showSection(value) {
  section = value; if (activeHint) activeHint.hide()
  ;['collection','team','stats'].forEach(function(id){var on = id === value; $('panel-'+id).hidden = !on; $('tab-'+id).setAttribute('aria-selected',String(on)); $('tab-'+id).setAttribute('tabindex',on?'0':'-1')})
}
function hint(label, text, value) {
  var wrap = element('div'); wrap.className = 'cardhint'
  var button = element('button',label); button.type = 'button'; button.className = 'cardhint-label'
  if (value !== undefined) {button.textContent = ''; button.append(element('span',label),element('b',value))}
  var tip = element('p',text), id = 'card-help-'+(++hintId), pinned = false, focused = false
  tip.id = id; tip.className = 'cardhint-tip'; tip.hidden = true; tip.setAttribute('role','tooltip')
  button.setAttribute('aria-controls',id); button.setAttribute('aria-describedby',id); button.setAttribute('aria-expanded','false')
  function hide() {pinned = false; tip.hidden = true; button.setAttribute('aria-expanded','false'); if (activeHint && activeHint.hide === hide) activeHint = null}
  function show() {if (activeHint && activeHint.hide !== hide) activeHint.hide(); activeHint = {hide:hide,wrap:wrap}; tip.hidden = false; button.setAttribute('aria-expanded','true')}
  button.addEventListener('pointerenter',function(e){if (e.pointerType === 'mouse') show()})
  wrap.addEventListener('pointerleave',function(){if (!pinned && !focused) hide()})
  button.addEventListener('focus',function(){focused = true; show()})
  button.addEventListener('blur',function(){focused = false; hide()})
  button.addEventListener('click',function(){if (pinned) hide(); else {pinned = true; show()}})
  wrap.addEventListener('keydown',function(e){if (e.key === 'Escape') {e.preventDefault(); hide()}})
  wrap.append(button,tip); return wrap
}
document.addEventListener('keydown',function(e){if (e.key === 'Escape' && activeHint) {e.preventDefault(); activeHint.hide()}})
document.addEventListener('pointerdown',function(e){if (activeHint && !activeHint.wrap.contains(e.target)) activeHint.hide()},true)
function card(c) {
  var node = element('article'); node.className = 'accountcard'; node.setAttribute('data-card-id',c.id)
  node.style.setProperty('--rar',colors[c.rarity] || colors.common); node.style.setProperty('--fam',familyColors[c.family]); node.style.setProperty('--psky','#eef2ea')
  var face = element('div'); face.className = 'cf'+(c.foil?' foil':'')+(c.shiny?' shiny':'')+(c.species==='mythic'?' mythic':'')
  var art = element('a'); art.className = 'cf-art'; art.href = '/c/'+encodeURIComponent(c.id); art.setAttribute('aria-label','View '+name(c))
  var img = element('img'); img.src = '/c/'+encodeURIComponent(c.id)+'/art.svg'; img.alt = ''; img.width = img.height = 96; img.loading = 'lazy'; art.append(img)
  var link = element('a',name(c)); link.className = 'cf-name'; link.href = art.href
  var finishes = [c.shiny?'Shiny':'',c.foil?'Foil':''].filter(Boolean).join(' ')
  face.append(art,link,element('p',(c.species==='mythic'?'Mythic · 1 of 1':capital(c.rarity))+(finishes?' · '+finishes:'')))
  face.children[2].className = 'cf-rar'
  var family = element('p',marks[c.family]+' '+capital(c.family)+' · Level '+c.level); family.className = 'cf-kind'; face.append(family)
  node.append(face)
  var plaque = element('div'); plaque.className = 'accountplaque'
  var stats = element('div'); stats.className = 'cardstats'
  var icons = {hp:'♥',atk:'⚔',def:'◇',spd:'➜'}
  ;['hp','atk','def','spd'].forEach(function(k){if (c.stats) {var h = hint(icons[k]+' '+help.stats[k].short,help.stats[k].text,c.stats[k]); h.children[0].setAttribute('aria-label',help.stats[k].label+' '+c.stats[k]); stats.append(h)}})
  plaque.append(stats)
  var traits = element('div'); traits.className = 'cardtraits'
  ;(c.traits || []).forEach(function(t){if (help.traits[t]) traits.append(hint(help.traits[t].name,help.traits[t].text))})
  if (traits.children.length) plaque.append(traits)
  var more = element('details'); more.className = 'carddetails'; more.append(element('summary','More about this card'))
  var values = c.genes || [], quality = Math.round(values.reduce(function(a,b){return a+b},0)/60*100)
  more.append(hint('Genes '+quality+'%',help.genes),hint(marks[c.family]+' '+capital(c.family)+' matchups',help.families[c.family].text))
  var genes = element('dl'); genes.className = 'inspect-genes'
  ;['hp','atk','def','spd'].forEach(function(k,i){var gene = element('div'); gene.append(element('dt',help.stats[k].label+' gene'),element('dd',values[i]+'/15')); genes.append(gene)})
  more.append(genes)
  var move = help.families[c.family].special, mimic = (c.traits || []).includes('mimic'), quick = (c.traits || []).includes('quickCharge'), charge = quick ? help.charge.quick : help.charge.normal
  more.append(hint('✦ '+(mimic?'Mimic special':move.name),(mimic?'Copies the special of the opposing active creature’s family. ':move.text+' ')+'Fires automatically after '+charge+' normal attack'+(charge===1?'':'s')+'. A Perfect press in Claude adds '+help.charge.perfect+'% power.'))
  more.append(hint('How damage works',help.damage))
  more.append(element('p','Stage '+c.stage+' of 3 · Season '+c.season))
  if (c.foil || c.shiny) more.append(hint('✧ '+[c.foil?'Foil':'',c.shiny?'Shiny':''].filter(Boolean).join(' · '),help.finishes))
  var state = [c.bound?(c.origin==='starter'?'Starter · stays with you':'Stays with you'):'',c.state==='escrow'?'Held for a trade, gift or sale':'',c.forTrade?'For trade':'',c.firstFind?'First discovery':''].filter(Boolean).join(' · ')
  if (state) more.append(element('p',state))
  plaque.append(more); node.append(plaque); return node
}
function resetFilters() {;['q','family','rarity','trait','finish','scope'].forEach(function(id){$(id).value = ''}); $('sort').value = 'newest'}
function query() {
  return ['q','family','rarity','sort','trait','finish','scope'].map(function(id){var value = $(id).value.trim(); return value ? id+'='+encodeURIComponent(value) : ''}).filter(Boolean).join('&')
}
function renderCards() {
  if (activeHint) activeHint.hide()
  $('collection').replaceChildren.apply($('collection'),cards.map(card)); $('more').hidden = !next
  $('collection-status').textContent = matched ? 'Showing '+cards.length+' of '+matched+' matching card'+(matched===1?'':'s')+'.' : 'No matching cards. Try another filter or reset them.'
  $('inventory').textContent = me.player.seen.length+' species discovered · '+me.packs.length+' unopened packs'+((me.listings || []).length?' · '+me.listings.length+' market listings':'')
  $('tab-collection').textContent = '▦ Collection · '+total
  var avatar = element('img'); if (team.length) {avatar.src = '/c/'+encodeURIComponent(team[0].id)+'/art.svg'; avatar.alt = ''; $('profile-art').replaceChildren(avatar)}
  $('teamcards').replaceChildren.apply($('teamcards'),team.map(card))
}
async function browse(more) {
  if (!token || !me || (more && (browsing || !next))) return
  var params = query(); if (params !== currentQuery) more = false
  var revision = ++browseGeneration, held = token, screen = generation, after = more ? next : null
  if (activeHint) activeHint.hide()
  browsing = true; $('more').disabled = true; $('collection').setAttribute('aria-busy','true')
  $('collection-status').textContent = more ? 'Loading more cards…' : 'Finding your cards…'
  if (!more) {$('collection').replaceChildren(); $('more').hidden = true}
  try {
    var page = await request('/account/cards'+(params || after ? '?'+params+(after?(params?'&':'')+'after='+encodeURIComponent(after):'') : ''),'GET',undefined,true)
    if (revision !== browseGeneration || held !== token || screen !== generation) return
    if (more && page.version !== version) {await browse(false); return}
    await loadSeasons(page.cards.concat(page.team))
    if (revision !== browseGeneration || held !== token || screen !== generation) return
    var seen = new Set(more ? cards.map(function(c){return c.id}) : [])
    var added = page.cards.filter(function(c){if (seen.has(c.id)) return false; seen.add(c.id); return true})
    cards = more ? cards.concat(added) : added; team = page.team; next = page.next || null; version = page.version; total = page.total; matched = page.matched; currentQuery = params
    renderCards()
  } catch(e) {
    if (revision !== browseGeneration || held !== token || screen !== generation) return
    if (more && e.status === 409) {await browse(false); return}
    $('collection-status').textContent = e.message
  } finally {
    if (revision === browseGeneration && held === token && screen === generation) {browsing = false; $('more').disabled = false; $('collection').setAttribute('aria-busy','false')}
  }
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
  var revision = ++generation, held = token; browseGeneration++; browsing = false; $('more').disabled = false; $('collection').setAttribute('aria-busy','false')
  $('refresh').disabled = true; renderUsername(); say('Loading your collection…')
  try {
    var result = await request('/v1/me','GET',undefined,true)
    if (revision !== generation || held !== token) return
    me = result
    $('mybalance').replaceChildren(stat('✦ Sparks',me.player.sparks,'Crafts cards and buys packs.'),stat('★ Rating',me.player.rating,'Your duel rating.'),stat('League',me.player.league,'Pebble → Brook → Grove → Peak → Star, based on rating.'),stat('Win streak',me.player.streak,'Consecutive wins; each third earns a pack.'))
    var labels = {duelWins:'⚔ Duel wins',duelLosses:'Duel losses',playersBeaten:'Players beaten',wildWins:'Wild wins',catches:'Catches',speciesCollected:'Species collected',firstFinds:'First discoveries',mythicsFound:'Mythics found',marketSales:'Market sales'}
    $('stats').replaceChildren.apply($('stats'),Object.keys(labels).map(function(k){return stat(labels[k],(me.player.stats || {})[k] || 0)}))
    await browse(false)
    if (revision !== generation || held !== token) return
    $('dashboard').hidden = false; $('signout').hidden = false; $('signedout').hidden = true; say('')
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
$('more').addEventListener('click',function(){return browse(true)})
$('card-search').addEventListener('submit',function(e){e.preventDefault(); return browse(false)})
$('filters-reset').addEventListener('click',function(){resetFilters(); return browse(false)})
;['family','rarity','sort','trait','finish','scope'].forEach(function(id){$(id).addEventListener('change',function(){return browse(false)})})
;['board','period'].forEach(function(id){$(id).addEventListener('change',rankings)})
$('refresh').addEventListener('click',refresh)
;['collection','team','stats'].forEach(function(id,i){$('tab-'+id).addEventListener('click',function(){showSection(id)}); $('tab-'+id).addEventListener('keydown',function(e){var list = ['collection','team','stats'], index = e.key==='ArrowRight'?(i+1)%3:e.key==='ArrowLeft'?(i+2)%3:e.key==='Home'?0:e.key==='End'?2:-1; if (index>=0) {e.preventDefault(); showSection(list[index]); $('tab-'+list[index]).focus()}})})
showSection(section)
if (token) refresh()
})()`

export const ACCOUNT_HASH = sha256Hex(ACCOUNT_JS).slice(0, 12)
