// Runs first, in <head>: lights the page for the visitor's own hour (or #hour=, or a postcard's fixed
// hour), sets the real moon phase and marks the page as scripted. Nothing else, and nothing sent.
const d = document.documentElement
const m = /hour=(morning|afternoon|dusk|night)/.exec(location.hash)
if (!d.hasAttribute('data-hour-fixed')) {
  const h = new Date().getHours()
  d.setAttribute('data-hour', m ? m[1]! : h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'dusk' : 'night')
}
// days since the new moon of 2000-01-06 18:14 UTC, in synodic months, as one of 8 phases
const p = (((Date.now() - 947182440000) / 864e5) % 29.530588 + 29.530588) % 29.530588
d.setAttribute('data-moon', String(Math.floor((p / 29.530588) * 8 + 0.5) % 8))
d.classList.add('js')
