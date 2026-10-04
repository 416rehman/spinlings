# Privacy

Spinlings is a game that runs inside Claude Code, which is where your work happens. Privacy is its highest-priority rule and overrides every other rule in the game (SPEC.md section 20). This page says exactly what the mod reads, what it sends, what the server keeps and for how long, and who can see what. If the code ever disagrees with this page, that is a bug. Please report it through [SECURITY.md](SECURITY.md).

## The short version

- **Generated identity by default.** You start with a random token and a random handle. You may choose a public username; reusing a name from elsewhere can identify you. Nothing about your Claude account, email, organization or machine is ever sent by the mod.
- **Nothing about your work leaves your machine.** The mod never reads your prompts, Claude's answers, tool calls, files, paths, repository names or cost.
- **Nothing about your usage is shown to anyone.** The only usage-related value the server receives is a model family (haiku, sonnet, opus or fable), only when you join, a pack charges or a battle starts. Nobody else sees it, and it is deleted with that pack or battle.
- **Other players see a small, fixed set of things:** your handle, team, for-trade cards, album count and league, your market listings, and, unless you hide from the leaderboards, your game stats and places on the boards (counts such as duel wins and players beaten, as they stood at the last midnight, never with a time). They never see timestamps, activity, battle counts or which model you use. One caveat is under [What someone could still guess](#what-someone-could-still-guess).
- **The server keeps the minimum and deletes on a schedule.** It stores no IP addresses and keeps no request logs. No telemetry, no analytics and no third-party requests, in the mod or on the server.
- **You can see and delete everything.** `/spin privacy` shows every recent request the mod sent, and deletes your account.
- **Or play offline.** In the offline world the mod sends nothing at all.

## Who you are to the game

- **A random token and a random handle.** The server creates both when you join. The handle looks like `soft-otter-42` (an adjective, a noun and two digits). Both are chosen at random by the server and have no relation to your Claude account, email, organization, machine, OS user, session id, model or anything else.
- **The mod never sends any of those.** It never calls `$.session.authorize`, `$.session.id` or `$.session.repo`.
- **An optional public username.** The signed-in browser page lets you choose a unique name of 1–40 ASCII letters, numbers, `_` or `-`, saved in lowercase. It passes the game's name filter; names such as `admin` and `support` are reserved. This name is sent to the server, stored as your handle and shown wherever your handle appears. A reused name can connect your game profile to another identity.
- **You can change your handle** once a week, either by choosing a username or drawing another generated handle. Previous names stay unavailable for 30 days. The account id, collection, sessions and saved passkeys remain the same.
- **There is no chat or bio.** Your optional public username is the only user-written public text.
- **A passkey is optional.** It lets another computer sign in to your account. It is made with a random 16-byte user id, never your handle or a name, and it needs no email and no password.

## What the mod reads on your machine

The mod reads only the shape of your Claude Code session:

| Signal | Where it comes from | Used for |
|---|---|---|
| Which model | `$.session.model()`, `turn.step` `model` | The family of your packs and the battle arena |
| Effort setting | `turn.step` `effort`, on the main thread only | Local battle-band ink and your creature-frame glow; never saved or sent |
| Whether Claude is working | `turn.start`, `turn.complete` on the main thread | Wild encounters while Claude works |
| How a turn ended | `turn.complete` `reason` | A one-line reaction |
| Spinner phase | the spinner's `mode` in `ui.render` | A spinner suffix during a battle |
| Subagents | `agent.spawn` (a count only) | A cheering line in the band |
| Rate limits | `session.measure` (the rate-limit percentages only) | One status note when you hit a limit |
| Compaction | `session.compact` `trigger` | A one-line reaction |
| Session open | `session.start`, `session.end`, a once-a-minute clock tick | Presence minutes for packs |
| A session started over | `classic.SessionStart`, for `clear`, `resume` and `fork` only | Picking the game back up |
| The band and the pane | `ui.render` and `ui.close` (their size, focus, and that you pressed esc) | Drawing them, and going back one view |
| A Desktop card click | `ui.message` from the Spinlings pane's own card regions: an element key and a null payload | Selecting that currently displayed card; pointer coordinates remain local to the renderer |
| The `/spin` command | `command.run` (the command's arguments) | The game's one command |

It never hooks `tool.call`, `prompt.submit` or `classic.PermissionRequest`.

Some of the events above carry content the mod does not need, and it never reads those fields:
- the prompt `text` on `turn.start`;
- the `answer`, `toolUses` and `usage` of `turn.step`;
- the `answer` and `usage` on `turn.complete`;
- `cost` and context fill from `session.measure`;
- `cwd` on `session.start`;
- the `prompt`, `description` and `cwd` on `agent.spawn`;
- the `messages` and `instructions` on `session.compact`.

From `$.session` the mod calls only `model()`. It never uses `$.fs`, `$.process`, `$.model`, `$.prompt`, `$.tool`, `$.agent`, `$.mcp` or `$.env`. So it cannot read files, run programs, call a model, submit prompts, call tools, start agents, reach MCP servers or read environment variables. Run `claude plugin validate plugin` on a checkout to see every hook and every call it makes.

Effort is held only in local view state. It changes the band's ink and your creature-frame glow, and nothing in a battle's rules or timing. Every round keeps the same pace, so low and max effort send the same request bytes at the same moments.

## What the mod keeps on your machine

Claude Code's plugin storage on your machine holds your token, a copy of your online game for drawing it quickly, your offline save if you play offline, the last 20 requests the mod sent (for `/spin privacy`, with the token removed) and the mod's own bookkeeping (presence minutes, whether the game is quiet, sound and motion settings). Each server you use, and the offline world, keeps its own keys, and neither world ever reads the other's. The token never appears in logs, shares or the privacy view.

## What the mod sends

In the offline world, nothing: not one request. Online, every request goes to the one server URL in the mod's settings, over https. The default is `https://spinlings.dev`. Plain http is allowed only for `localhost` and `127.0.0.1`. Your token is sent only in the `Authorization` header, and only to that host.

These are all the kinds of request body the mod can send:

| Request | Body |
|---|---|
| Join | the proof-of-work answer and the model family you are using |
| Charge a pack | the model family you used most in that stretch |
| Start a battle | wild or duel, the model family you are using, and for a revenge or a challenge the handle of the player you are taking on |
| List a card on the market | the card's id, a price in sparks and/or the kind of card you want in return (a species, a family, a rarity, shiny or foil) |
| Buy from the market | the listing's id and, when it asks for a card, the id of the card of yours you give |
| Finish a battle | the round numbers on which you pressed 1 |
| Redeem a drop | the code you typed |
| Everything else (catching, packs, team, fusion, recycling, crafting, trading, the Wandering Trader, wishlist, gifts, claims, the leaderboard switch, a new generated handle, passkeys, resetting access, settings) | the ids of the cards, packs, species, offers, listings, players or gift codes involved, and simple choices such as which catch you picked or a for-trade switch |
| Reading your game, profiles, the trade board, the market, the leaderboards and the world | nothing but the market filters and the board you choose (a family, rarity, species, shiny, foil, kind, price range, sort; a board and all time or this season); a big collection or a long market comes a page at a time, and each next page is asked for by the marker the server sent with the last one |

A model family is one of `haiku`, `sonnet`, `opus` or `fable`, never a model id. Every request also carries the mod's version in an `X-Spinlings-Client` header, which is the same for everyone on that version and is never stored. Claude Code's own HTTP layer may add standard headers such as a user agent; the server never stores them.

**Passkeys.** Saving or using a passkey happens on a page of the server that you open in your browser. That page sends the server what the browser's passkey prompt returns: a new public key when you save one, or a signature when you sign in. Nothing else about you or your device is sent.

**Your browser collection.** `/account` signs in with a saved passkey and reads your own online cards, team, packs, listings and current stats, plus your leaderboard places. It can also send the public username you choose to `POST /v1/me/handle`; other game actions remain in Claude Code. Its first-party script talks only to the same server. The session token stays in this tab's `sessionStorage`, never in a URL, page HTML, cookie or persistent browser storage. Sign out revokes only that browser session; your mod stays signed in. Closing the tab clears the local token. Browser access creates an ordinary session with the same 180-day expiry and new-device notice as a mod sign-in. Chosen usernames use the existing handle and retired-name fields. Passkeys belong to the stable account id, so changing your username does not change sign-in.

**Collection browsing.** The browser can send a card-name or species search term, family, rarity, trait, finish, availability and sort choices to the authenticated `/account/cards` endpoint. It searches only your own collection. These choices are used to answer the request, never stored or logged, and are not visible to other players. Stat and trait explanations use the game's own rules; they add no tracking or third-party requests.

The timing of requests says a little on its own. A pack charge means Claude Code was open on your machine, and a wild encounter means Claude was busy at that moment. It never says on what. Other players never see this timing (see below).

`/spin privacy` shows the last 20 request paths and bodies the mod sent, with the token redacted.

## What the server keeps, and for how long

| Data | How long |
|---|---|
| A player id and your generated or chosen public handle | Until you delete your account, or until it can no longer be reached (below) |
| A session for each device you play on: a SHA-256 hash of its token (never the token), the day it was made and the day it was last used | Deleted after 180 days unused |
| Passkeys you saved: the credential id, the public key, the random user id, a sign-in counter and the day you saved it | Until you delete your account |
| A passkey page in progress | Deleted after 10 minutes, or when used |
| Your game: cards, team, packs, sparks, rating, league, streak, wishlist, album, Fusion Log, your last 5 duel opponents (so matchmaking skips them), the drops you redeemed and the leaderboard switch | Until you delete your account |
| Your stats: counts of duel wins and losses, players beaten, wild wins, catches, species collected, First Discovered stamps, Mythics found and market sales (to different buyers), all time and for this season | Until you delete your account. Counts only, with no dates or times |
| The same numbers, and your rating, as they stood at the last midnight: what other players see today | Replaced each day, until you delete your account |
| Which players you have beaten in a duel, and which players have bought from you on the market, kept only so each counts once, and never shown to anyone | Until you or they delete the account |
| Your market listings: the card, its kind, the price, what you want, your handle as you listed it, the day you listed it and the day it lapses | While open, then deleted 30 days after they end |
| Market sale prices (only sales for sparks alone, and a buyer's first from that seller each season): species, rarity, shiny, foil, price and day, never who sold or bought | Deleted after 90 days |
| For each card, how many battles it fought in each arena, hidden from everyone, to pick its raised form | Kept with the card while you own it; cleared when it changes hands |
| When you joined | A date, never a time, until you delete your account |
| When you were last seen and last finished a battle, and on how many days you have finished one | Dates, never times |
| The model family of a pack charge or a battle | Only as long as that pack or battle |
| Battles (teams, seed, your presses, result) | Deleted 7 days after the battle is settled. Only aggregate counters remain. |
| Notices (defense results, trade and gift news) | Deleted after 30 days |
| Finished offers and gifts (accepted, declined, cancelled, expired or claimed) | Deleted 30 days after they end |
| Your previous handle, after any name change or after deletion | Kept for 30 days, so nobody else takes it straight away |
| Join challenges | Deleted when used, or when they expire after 5 minutes |
| Join counters (see below) | Deleted after 24 hours |

The server keeps a date instead of a time wherever a game rule allows. It keeps exact times only where a rule needs them, such as the 10-minute battle window, the spacing between battles and between pack charges, and offer expiry times, and it clears the spacing marks on your account after 24 hours.

**Accounts nobody can reach.** When an account has no session left (each expires after 180 days unused) and no passkey, nobody can ever sign in to it again, so the server deletes it, exactly as if you had deleted it yourself.

**Never kept:** your IP address, user agent, timezone, email, Claude account, organization, or anything about your work. There are no request logs.

**IP addresses.** To limit joins, the server computes `HMAC(SECRET, utcDate + ip)`, cut to 16 bytes, where `SECRET` is a server secret. Only that value is stored, in a join counter that is deleted after 24 hours. Because the date is part of the input, yesterday's values cannot be matched to today's. Short burst limits are counted in memory and never written down.

**No request logging.** Cloudflare Workers observability and Logpush stay off. The server logs only error codes, never URLs, request bodies, tokens, handles or IP addresses.

**The hosting provider.** The default server runs on Cloudflare Workers with a D1 database, so Cloudflare carries its traffic and stores its database as the hosting provider, under Cloudflare's own privacy policy. Cloudflare also adds Network Error Logging headers to the website, so a visitor's browser may report failed page loads to Cloudflare. If you would rather not rely on that, the server is open source and you can run your own (see [docs/self-hosting.md](docs/self-hosting.md)).

## What other players can see

| Where | What is visible |
|---|---|
| Your profile, in the game and at `{server}/u/{handle}` | Your handle, team, cards marked for trade, album count and league, and your stats unless you hide from the leaderboards |
| The leaderboards | Every player is on them unless they hide with `/spin leaderboard off`: your handle, league, rank and the board's number (rating, players beaten, duel wins, species, Mythics found or market sales), all time or this season. Every number is as it stood at the last midnight, so nobody can watch it move while you play. Hiding takes you off every board and your stats off your profile at once. If you joined while the leaderboard was opt-in, you got one notice when the boards opened to everyone; a new player gets one when they join. |
| The market | Your open listings: your handle as it was when you listed, the card, the price, what you want in return and the day you listed it. Recent sale prices show species, rarity, shiny, foil, price and day, never who sold or bought. |
| Defense notices | When someone duels your team, you get a notice with their handle and the result. When you duel someone, they get the same about you. The time is rounded to "today" or "yesterday". |

**Never visible to anyone else:** your battle count, who you beat or who beat you (apart from the two players in a duel), when you joined, when you were last seen, your activity, the arena or model you used, and any timestamps. Duel wins and losses appear only as counts in your stats, and you can hide those.

Cards other players see show the creature, its level, stats and traits, and nothing about its owner: no dates, no locks, no tiredness and no raised form. When you do something with another player, they see your handle alongside it, and nothing beyond the list above:
- **Duels:** your opponent sees your handle, your league and your saved team, as on your profile.
- **Trades:** the other player sees your handle and the cards in the offer. The trade board shows your handle next to the cards you marked for trade.
- **The market:** anyone can see your open listings, with your handle. When someone buys one, you get a notice with their handle, like any trade, and they get your card. A sale's price is kept for the species' recent prices without either handle.
- **Challenges:** anyone can challenge your saved team by your handle, as in an ordinary duel; you get the usual defense notice.
- **Gifts:** whoever claims your gift sees your handle and the card. The gift page at `{server}/g/{code}` shows the card to anyone who has the code.
- **Cards that change hands** arrive as if made that day: their earlier dates, arena counts and raised form are cleared, so nothing on them tells the new owner when or how you had them.
- **First discoveries:** the first card of a species anyone in the world obtains in a season carries a `First Discovered` stamp wherever that card is shown. The game never says who found it.
- **Mythics:** if you catch a Mythic, its card says "Discovered by" your handle, and the public "Mythics found" list shows your handle and the Mythic's name, nothing else. If you change your handle or delete your account, your handle comes off the card and the list.

**Public pages** (profiles, card pages at `{server}/c/{id}` and gift pages) show only what a profile shows, plus Mythic discoveries as handle and name. They load nothing from other sites. Their only scripts are the server's own files under `/static/`, and the page policy (`connect-src 'none'`) stops those scripts from sending anything. Passkey pages and the browser collection use `connect-src 'self'` to talk only to the same server; the collection shell contains no player data until you sign in.

`/spin share` only copies text to your clipboard. Nothing is posted anywhere unless you paste it yourself.

### What someone could still guess

Cards belong to families, and a pack charges in the family of the model you used most while it charged. So the families of the cards you show, on your team and marked for trade, can hint at which model family you tend to use. Catches, trades, gifts and crafting mix families up, and you choose which cards are on your team and marked for trade.

Your starter team says nothing about the model you joined with. The server builds it around a family it picks at random (that family, the one it beats and the one that beats it, in a shuffled order), so it looks the same whichever model you used.

Other players never see times. A listing shows only the day it was listed, and a defense notice only "today" or "yesterday". Your stats, album count, league and board places show as they stood at the last midnight, so they never change while you play.

The cards on your team show their level. Someone who checks your profile often could see a level go up soon after you battle.

## Deleting your account

`/spin privacy` has a delete button behind a 2-second hold. It calls `DELETE /v1/me`, which removes your player record, your sessions and passkeys, and all of your cards, packs, battles, offers, gifts, market listings, notices, wishlist, stats, board places, first-discovery credit and the record of who you beat or who beat you, and of who you sold to or bought from. Cards you already traded, sold or gave away stay with their new owners, and old sale prices stay, naming nobody. The server remembers only that your handle was taken, so nobody else gets it straight away, and frees it after 30 days.

Anything the server deletes, whether your account or old battles and notices, can stay in the database's point-in-time recovery history (Cloudflare D1 Time Travel) for up to 30 days, after which it is gone for good. That history is only ever used to recover from data loss.

Uninstalling the mod does not delete your account, so delete it first. Otherwise the server keeps it until it can no longer be reached: 180 days after its last use, if you never saved a passkey. An account with a passkey is kept until you delete it.

## How this is checked

- CI fails if any response visible to another player contains a field outside the lists on this page, or if the mod sends anything outside the documented request shapes.
- CI checks the mod's hooks, the event fields it reads and its `$` calls against fixed lists, both in the source and in `claude plugin validate --json`, on every pull request.
- The mod and server are open source, so you can read both.

## Community servers

The promises on this page describe this code. Whoever runs a server controls it, and a modified server could keep more. The default server is run by the maintainer of this repository. You can point the mod at any server with `/spin server <url>`, including one you run yourself. The mod shows a one-time notice before it connects to any server other than `https://spinlings.dev`.

## Changes

Changes to this page are tracked in this repository's history. Questions go in a GitHub issue; security and privacy problems go through [SECURITY.md](SECURITY.md).
