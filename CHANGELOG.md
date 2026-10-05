# Changelog

One entry per release (SPEC 32), newest first. Each says what changed in plain words, any compatibility impact, and any change to what the mod sends, what the server stores or what other players can see. The mod and the server share one version; the server is deployed first.

## 0.2.13 (2026-10-05)

- **A shared duel arena.** Both active creatures battle in one Desktop scene: Moss Grove, Moonlit Water, Ember Cliffs or Floating Isles. Readable names and HP accompany clearer damage, healing and hit effects. The rival stays visible; a native Day button explains the duel's fixed rule, including across midnight. A native footer carries round, streak and the real Now! action for special timing. The scene stays within 160px of height plus a native header/footer. Desktop panes below 40 columns and hosts reporting a smaller band keep compact battle text with actions first; the terminal retains its four-row budget. Motion off uses still frames; quiet keeps a player-started battle still and hides other moments. Battle ticks, special timing, Perfect windows and authoritative outcomes are unchanged.
- **Compatibility and privacy.** API v1, rules 1, generator 2, offline format 1 and minimum client 0.1.0 remain unchanged. No new event data, requests, stored/public game fields, migrations or runtime dependencies are added. Released fixtures, engines, generators, existing cards and website layout are preserved. The new duel appearance still needs a native Desktop check; existing screenshots remain honestly versioned.

## 0.2.12 (2026-10-05)

- **Show the launcher in Claude Desktop.** Use Desktop's session-mode slot for the Spinlings button, including when no modes are active. The terminal retains its prompt-hint launcher. Each preserves Claude's own drawing unread; unsupported surface/slot combinations leave the fallback intact. The compact control opens the pane with one cue at a time: a dot when packs wait, otherwise an available online rating rank. Cached ranks are suppressed for offline, hidden, changing accounts, active battles and unrelated boards. World labels, pack counts and update text stay in the pane; resting guidance moves to Team. Older hosts show only a passive pack-ready dot. Help explains its meaning.
- **Compatibility and privacy.** API v1, rules 1, generator 2, offline format 1 and minimum client 0.1.0 remain unchanged. No new event data is read, no requests or stored/public game fields are added, and no migration or runtime dependency is introduced. Released fixtures, engines, generators, existing cards and website styling are preserved. Native appearance requires a separate Desktop check; SDK proof does not certify it.

## 0.2.11 (2026-10-05)

- **Keep QA out of the installed game.** Remove `/spin demo` and its preview screens, scene data and special controls. SDK tests and visual fixtures stay in the repository and run against an unchanged staged copy of the plugin; players install only the game and its assets.
- **A compact composer launcher.** A clickable Spinlings button replaces the duplicate passive status on hosts that render the prompt hint. Its pack indicator opens the pane without consuming a pack. Claude's own hint and keyboard controls remain; quiet hides the launcher, and older hosts retain concise status text.
- **Readable local chimes.** Optional sounds are synthesized from the same original notes when needed instead of loaded from bundled recordings. All four sounds preserve their exact released PCM bytes; sound remains off by default and quiet still silences it.
- **Directory source review.** State calls use the directory's plain capability syntax, retaining the same defaults and atomic update retries. Local height variables avoid reserved JSX names, and the card pointer component keeps its fixed bundled module path. The subagent hook clearly forwards its original event and result unchanged. A square original-creature icon, data-handling explanation and source review notes accompany the plugin.
- **Compatibility and privacy.** Game behavior, card selection geometry, website appearance, API v1, rules 1, generator 2, offline format 1 and minimum client 0.1.0 remain unchanged. No new runtime dependency, migration, request field, stored game field or public player field. Existing release fixtures, engines and generators remain immutable.

## 0.2.10 (2026-10-05)

- **Choose a world in one place.** `/spin world` opens the chooser, `/spin world offline` resumes the local collection, `/spin world online` returns to spinlings.dev, and `/spin world <server>` reviews a community address before connecting. The header's world indicator opens the same chooser. Old `/spin server` commands remain supported; each server's session and the offline save stay separate. Cancelled or outdated choices cannot switch worlds later.
- **Keep packs together.** The Team pane groups the ready count, Open pack, pack artwork and next-pack countdown below your creatures. The header has the daily rule and world control. Narrow panes wrap full community addresses without cutting them off.
- **Explain card finishes.** Alternate creature colours read `Alt colour`; rainbow frames read `Foil`. Both stay separate from rarity. An optional Looks control explains them, their existing recycling values and that they add no battle stats. Appearance odds, card records and mechanics are unchanged.
- **Directory source documentation.** The plugin folder includes its own setup/gameplay README and the unchanged MIT license for source review. Claude Code 2.1.287 or later remains required; compatible Desktop Code sessions use the same mod.
- **Compatibility and privacy.** API v1, rules 1, generator 2, offline format 1, minimum client, request fields, stored game fields and public player fields remain unchanged. No migration or runtime dependency added; released readers, fixtures, engines and generators remain immutable. Website appearance and honestly versioned screenshots are preserved.

## 0.2.9 (2026-10-04)

- **Connect in one step.** Confirming a community server joins its online world immediately, including from offline. Cancel keeps the current world, and no request goes to a new community server before Connect. `/spin server default` resumes the default online account; each server's collection and the offline save stay separate.
- **Choose your team slots.** Set in team and Change slot show every teammate, so you choose the replacement or swap. Replaced cards stay in your collection. Pack results use the same picker; empty slots match the occupied artwork size.
- **One card per pack, no rarity guarantee.** Each card uses the ordinary 70% common, 22% rare, 7% epic and 1% legendary odds. Price, charge pace, welcome-pack count and trading rules are unchanged. Existing cards stay owned. Older supported online mods receive one card without updating; older offline mods retain their bundled pack rules.
- **Open packs above the prompt.** Preview, Open, Close and Sidebar make the opening explicit. Closing a sealed preview keeps the pack; closing after opening keeps the card. Moving to the sidebar preserves the opening and never consumes another pack. An empty-pack command shows the normal next-pack countdown.
- **Set your own market price.** Enter an exact whole-spark price before confirming a listing. Recent matching sales show the last price, and an average with a sample count when at least two sales match. A plain crafting cost is also available as a reference.
- **Named Mythics.** Dario, Marshmallow Menace, Noodle Knight and Soggy Emperor each get one ordinary Mythic encounter worldwide. The usual encounter/catch odds, generated form and stats remain. A new migration stores only permanent roster ids, containing no player identity or time. Deleting an account cannot respawn a named Mythic.
- **Compatibility and privacy.** API v1, rules 1, generator 2, offline format 1, minimum client, request fields and public player fields stay unchanged. Named forms fit existing readers; historical fixtures, engines and generators remain immutable. Website styling is preserved.

## 0.2.8 (2026-10-04)

- **Repair artwork selection in Claude Desktop.** The invisible artwork selection region now includes the accessibility text Desktop requires. This prevents Desktop from rejecting the region and showing a `Client hooks` error over the creature. A clipped margin keeps the artwork's bottom and right edges clickable. Rarity, family, names and native controls keep their existing behavior.
- **Compatibility and privacy.** Packs still contain two cards, with the second rare or better. API v1, rules 1, generator 2, minimum client, request fields, stored game fields and public player fields are unchanged. Website appearance, existing cards and released compatibility recordings are preserved.

## 0.2.7 (2026-10-04)

- **Artwork and rarity clicks:** Claude's pointer regions now measure the artwork's full pixel size. Family/level and rarity/finish each have their own text region, so both rows open the same card as its name. Native buttons and keyboard controls remain exposed.
- **Two cards per pack.** Every pack opens into exactly two cards, with the second rare or better. The pack price, charge pace, welcome-pack count and trading rules remain the same. Existing cards are kept; unopened packs use the new size when opened. Online packs come from the server, so older supported mods receive the same two-card result; older offline worlds keep their installed rules.
- **Compatibility and privacy.** API v1, rules 1, generator 2, minimum client, request fields, stored game fields and public player fields are unchanged. Released compatibility recordings and historical engines remain immutable.

## 0.2.6 (2026-10-04)

- **Restore card selection in Claude.** Artwork and passive card text use separate pointer regions, leaving names and other native buttons exposed. A first click no longer depends on receiving a resize event, and a queued click survives a redraw of the same card. Changing cards, views or panes still cancels stale selections.
- **Keep existing controls.** Team slots, packs and Discoveries use the same arrangement. Keyboard shortcuts and caller-provided actions remain native controls outside the pointer regions.
- **Compatibility and privacy.** API v1, rules 1, generator 2, minimum client, request fields, stored game fields and public player fields are unchanged. Pointer coordinates remain local and the renderer sends only a null payload. Website appearance and profile sharing are preserved. Released compatibility recordings remain immutable.

## 0.2.5 (2026-10-04)

- **Share your profile.** Community's Profile copies your public profile link instead of sending you to another collection view. Browser account management moves into Privacy & settings. The browser account and public profile offer a share sheet where supported, with clipboard and manual-copy fallbacks.
- **Keep sharing simple.** Shares use only the current public username's canonical URL. Cancelling a share stays quiet; narrow layouts wrap the actions and fallback link. The established website appearance and account layout are preserved.
- **Compatibility and privacy.** API v1, rules 1, generator 2, minimum client, requests, stored game fields and public player fields are unchanged. No campaign, reward or referral rule changes. No marketing posts or automatic sharing. Released compatibility recordings remain immutable.

## 0.2.4 (2026-10-04)

- **A clearer browser collection.** Collection, Team and Stats have their own views. Rankings sit with stats, filters stay close to the cards, and card details open when you need them. Username timing appears in the edit flow instead of a permanent account notice. The site's existing palette, fonts and public pages are preserved.
- **Pick the whole card.** In Claude Desktop, a card's artwork, name and surrounding tile select the same card, with its existing keyboard shortcut. A local pointer region forwards only a current element key and a null payload to the existing action; no pointer coordinates are stored or sent to the server.
- **Close means close.** The pane footer now closes the host pane from a main tab. Back still returns from a detail view, and dismissing update instructions keeps the pane open. Actual Claude Desktop launch checks exposed the missing root close call.
- **Compatibility and privacy.** API v1, rules 1, generator 2, the minimum client, requests, stored fields and public fields are unchanged. Released compatibility recordings remain immutable.

## 0.2.3 (2026-10-04)

- **Keep your creatures across worlds and seasons.** Frozen species now belong to their own server or offline save. Online collections, opponents and fusion parents load every needed season, including collections spanning more than eight seasons. Matching today's generator no longer skips an older season's frozen forms. The local season cache stays bounded and late responses cannot replace the active world's catalog.
- **Retain the rules you started with.** The server keeps an immutable rules-1 replay engine, independent of future balance changes. Future special labels use a generic display in every supported released mod while retaining the exact damage, HP and result. Below the minimum supported mod, collection reads and account deletion remain available; game writes still require an upgrade. The minimum stays 0.1.0.
- **Offline history.** Generator 2 and its naming rules are retained separately, and saves resolve past seasons using their recorded generator version. Updating a future generator must preserve existing offline creatures.
- **Ready to share.** Public pages have canonical URLs, complete social previews and a stable meadow image. Cache hits retain each image's intended browser lifetime. A sitemap lists generic public pages, and crawler rules keep private and temporary paths out. Existing website styling is preserved. The README adds requirements, badges, update guidance and a compatibility guide; issue templates separate ordinary feedback from private security reports.
- **Compatibility and privacy.** API v1, rules 1, generator 2, stored database fields and public card fields are unchanged. No new request metadata, telemetry or runtime dependency is added. Transient frozen forms stay local to rendering and are stripped from responses and stored battle JSON. Released compatibility fixtures remain immutable; tests also cover future labels, historical replay, cross-world isolation, long-lived collections and season rewards paid once.

## 0.2.2 (2026-10-04)

- **Cards you can compare.** The browser collection shows Health, Attack, Defense and Speed without opening every card. It uses the website's pixel frames, rarity gems and finish accents. Public card pages and market cards explain stats, genes, family matchups, special moves and traits on hover, keyboard focus or tap. Attack is clearly distinguished from the damage of a particular hit.
- **Find the right creature.** Search your whole collection by name or species, filter by family, rarity, trait, finish or availability, and sort by name, rarity, level, genes or combat stats. Counts and sorting cover the entire collection, with paged results and the complete team shown separately.
- **Compatibility and privacy.** The mod's existing `/v1/cards` behavior, rules, generator, minimum client and stored game fields are unchanged. A new authenticated browser-only `/account/cards` read accepts collection search and filter choices; these are not stored or logged. Public pages expose the same card fields as before. Passkeys and username changes keep their existing behavior, and the website's overall appearance is preserved.

## 0.2.1 (2026-10-04)

- **A clearer pane.** Four tabs: Team, Collection, Discoveries and Community. Community opens on Profile, with one section bar for Profile, Market, Rankings and Trading. Sections switch in place; Back from card, listing or player details returns to the selected section. Profile holds your stats, browser access and settings. Sparks, rating, league, streak, families and rarities have clear labels, today's rule opens its effect, and a small field guide explains the symbols. Layout adapts to narrow and short panes; shortcuts stay beside their buttons.
- **Your place.** Community → Rankings shows all six leaderboard categories and both periods, with your own rank first. Market and leaderboard commands still work, and an older cached Market tab opens Community → Market. A mod update refreshes cached server capabilities once, so new screens do not stay hidden until the next day.
- **Browser access.** A saved passkey opens the same online collection, stats and rankings in a browser view. Profile offers this link only after the server confirms `browser-account` support; older servers offer the public profile. The session stays in the tab; signing out revokes only that session. Existing public website styling is preserved.
- **Your public username.** Keep the generated handle or choose a unique name in the browser: 1–40 ASCII letters, numbers, `_` or `-`, saved in lowercase, filtered and checked against reserved names. Name changes share the existing once-a-week limit; old names stay held for 30 days. Your account id, collection and saved passkeys stay the same. The browser otherwise remains a view of your game.
- **Effort is cosmetic.** Claude's effort setting changes local battle-band ink and frame glow only. Requests, send times, battle pace and saved values are identical for low and max effort. No effort value leaves the machine.
- **Pause the demo.** The landing-page battle can be paused and resumed through the catch and evolution, with motion and timers held in place.
- **Docs.** The README hero uses the real Desktop duel capture; the spec matches current trading and leaderboard rules.
- **Compatibility and privacy.** API `/v1`, rules, generator and minimum client are unchanged. `POST /v1/me/handle` accepts an optional chosen `handle`; an empty `{}` still draws a generated handle for older mods. Features `browser-account` and `custom-handles` advertise the new support. Browser sign-in uses the existing passkey verifier and ordinary sessions. The existing handle and retired-name storage holds chosen usernames too; other players can now see the public name you choose, with the same game fields as before.

## 0.2.0 (2026-10-03)

- **The market.** Sell a card for sparks, for a card you want, or both, from its card page; buy from the new Market tab. A listing waits up to 14 days. A sale or a listing that comes home shows the creature in the band. The site has a read-only market at `/market`.
- **Leaderboards and stats.** Six boards (rating, players beaten, duel wins, species, Mythics, sales), all time or this season, with your own rank pinned. Profiles show stat tiles. Every number is as it stood at the last UTC midnight. The site shows the same boards at `/boards`.
- **Challenges.** `/spin duel <handle>`, or Challenge on a board row, a profile or a listing, plays a friendly duel against that player's saved team. No rating moves.
- **Trading has no waiting.** Welcome cards and traded cards can trade again straight away.
- **Passkey offer.** When something worth keeping arrives (a legendary, a Mythic, a foil or shiny, a sale), the band offers a passkey once that day, after the cards are face up. The pane header marks a collection that is not backed up yet.
- **What others can see:** every player is now on the leaderboards, with stats on their profile, unless they hide with `/spin leaderboard off`. Players who joined while the boards were opt-in get one notice saying so. Open market listings show your handle, the card, the price, what you want and the day listed.
- **What the server stores:** stat counts (no dates or times), market listings (deleted 30 days after they end), sale prices without either handle (deleted after 90 days), and which players you beat or sold to, only so each counts once. PRIVACY.md has the full list.
- **What the mod sends:** listing, buying and taking off a listing; the market filters and the board you pick; a handle for a challenge.
- **Compatibility:** API `/v1`, additive only (features `market`, `challenge`, `stats`). Rules 1, generator 2. `minClient` stays 0.1.0, so 0.1.x keeps working. The database change is expand-only.

## 0.1.1 (2026-10-03)

- **Installing asks nothing.** The plugin no longer declares options, so Claude Code goes straight from install to play. `/spin world` and `/spin server` still switch the world and the server.
- **Install steps fixed.** Installing is two commands inside Claude Code: `/plugin marketplace add 416rehman/spinlings`, then `/plugin install spinlings@spinlings`. Needs Claude Code 2.1.287 or later.
- **Plainer descriptions** in the plugin and the marketplace listing.
- **Compatibility:** API `/v1`, rules 1, generator 2. `minClient` stays 0.1.0, so 0.1.0 keeps working.

## 0.1.0 (2026-10-03)

The first release: Spinlings season 1, the mod and the server, live at [spinlings.dev](https://spinlings.dev).

- **Install:** two commands inside Claude Code, `/plugin marketplace add 416rehman/spinlings` then `/plugin install spinlings@spinlings`, or ask Claude to install it. The game starts on its own at the next session, with no sign-up, no setting and no command to run.
- **The game:** wild encounters while Claude works, duels with other players' teams and Rivals, packs charged by presence, three evolution stages and raised forms, foil, Mythics, fusion, crafting, recycling, the Wandering Trader, trading, gifts, drops, streaks, leagues, seasons and the daily rules.
- **No daily quotas:** every finished battle pays. The server paces battle starts and pack charges and caps the bank of unopened packs, and repeat duels between the same two players stop moving rating after the first few.
- **Two worlds:** online by default (an anonymous handle and session: no email, no password, no GitHub) and an offline world that sends nothing at all. An optional passkey brings an online account to another computer.
- **Community servers:** the same server runs on Cloudflare or plain Node, and `/spin server` plays on any of them. Each server is a separate world.
- **What the mod sends, what the server keeps and what others see:** as described in PRIVACY.md at this release.
- **Compatibility:** API `/v1`, rules version 1, generator version 2. `minClient` is 0.1.0. Needs Claude Code 2.1.287 or later.
