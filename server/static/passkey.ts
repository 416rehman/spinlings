// The only script the site ever serves, as /static/passkey.js under script-src 'self' (SPEC 30): it
// runs on /passkey/add and /passkey/signin, hands the page's options to navigator.credentials, and
// posts the result back to this origin. It reads its options from the page's data attributes, never
// from the URL, keeps nothing, and talks to nobody else. Kept as a string so the Worker and Node
// serve the same bytes without reading files.
export const PASSKEY_JS = String.raw`(function () {
  'use strict'
  var root = document.getElementById('passkey')
  if (!root) return
  var button = document.getElementById('go')
  var status = document.getElementById('status')
  var kind = root.getAttribute('data-kind')
  var ticket = root.getAttribute('data-ticket')
  var options
  try { options = JSON.parse(root.getAttribute('data-options')) } catch (e) { options = null }

  function say(message, state) {
    status.textContent = message
    root.setAttribute('data-state', state)
  }
  function bytes(s) {
    var b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4))
    var out = new Uint8Array(b.length)
    for (var i = 0; i < b.length; i++) out[i] = b.charCodeAt(i)
    return out
  }
  function text(buf) {
    var b = new Uint8Array(buf), s = ''
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  if (!options || !ticket || (kind !== 'add' && kind !== 'signin')) return say('This page is missing its details. Start again in Claude Code.', 'error')
  if (!window.PublicKeyCredential || !navigator.credentials) {
    button.disabled = true
    return say('This browser cannot use passkeys. Try a current version of Chrome, Edge, Firefox or Safari.', 'error')
  }

  async function ceremony() {
    if (kind === 'add') {
      var made = await navigator.credentials.create({ publicKey: Object.assign({}, options, {
        challenge: bytes(options.challenge),
        user: Object.assign({}, options.user, { id: bytes(options.user.id) }),
        excludeCredentials: options.excludeCredentials.map(function (c) { return { type: c.type, id: bytes(c.id) } }),
      }) })
      return { ticket: ticket, id: text(made.rawId), clientData: text(made.response.clientDataJSON), attestation: text(made.response.attestationObject) }
    }
    var got = await navigator.credentials.get({ publicKey: Object.assign({}, options, { challenge: bytes(options.challenge) }) })
    var body = {
      ticket: ticket, id: text(got.rawId), clientData: text(got.response.clientDataJSON),
      authenticator: text(got.response.authenticatorData), signature: text(got.response.signature),
    }
    if (got.response.userHandle && got.response.userHandle.byteLength) body.userHandle = text(got.response.userHandle)
    return body
  }

  button.addEventListener('click', async function () {
    button.disabled = true
    say(kind === 'add' ? 'Follow your browser to save the passkey.' : 'Choose your Spinlings passkey.', 'busy')
    var body
    try {
      body = await ceremony()
    } catch (e) {
      button.disabled = false
      return say(e && e.name === 'NotAllowedError'
        ? 'Nothing was saved. Press the button to try again.'
        : e && e.name === 'InvalidStateError'
          ? 'This device already has a passkey for your collection. You are all set.'
          : 'Your browser could not finish. Press the button to try again.', 'error')
    }
    say('Checking with Spinlings.', 'busy')
    try {
      var res = await fetch(kind === 'add' ? '/passkey/add/finish' : '/passkey/signin/finish', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store',
      })
      var out = await res.json().catch(function () { return {} })
      if (res.ok && out.ok) {
        return say(kind === 'add'
          ? 'Passkey saved. Go back to Claude Code: your collection now travels with it.'
          : 'Signed in. Go back to Claude Code to keep playing.', 'done')
      }
      button.disabled = res.status === 410
      say((out.error && out.error.message) || 'That did not work. Start again in Claude Code.', 'error')
    } catch (e) {
      button.disabled = false
      say('Could not reach Spinlings. Check your connection and press the button again.', 'error')
    }
  })
})()
`
