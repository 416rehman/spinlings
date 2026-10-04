# Changelog

One entry per release (SPEC 32), newest first. Each says what changed in plain words, any compatibility impact, and any change to what the mod sends, what the server stores or what other players can see. The mod and the server share one version; the server is deployed first.

## 0.2.3 (2026-10-04)

- **Keep your creatures across worlds and seasons.** Frozen species now belong to their own server or offline save. Online collections, opponents and fusion parents load every needed season, including collections spanning more than eight seasons. Matching today's generator no longer skips an older season's frozen forms. The local season cache stays bounded and late responses cannot replace the active world's catalog.
- **Retain the rules you started with.** The server keeps an immutable rules-1 replay engine, independent of future balance changes. Future special labels use a generic display in every supported released mod while retaining the exact damage, HP and result. Below the minimum supported mod, collection reads and account deletion remain available; game writes still require an upgrade. The minimum stays 0.1.0.
- **Offline history.** Generator 2 and its naming rules are retained separately, and saves resolve past seasons using their recorded generator version. Updating a future generator must preserve existing offline creatures.
- **Ready to share.** Public pages have canonical URLs, complete social previews and a stable meadow image. A sitemap lists generic public pages, and crawler rules keep private and temporary paths out. Existing website styling is preserved. The README adds requirements, badges, update guidance and a compatibility guide; issue templates separate ordinary feedback from private security reports.
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
