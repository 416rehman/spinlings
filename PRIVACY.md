# Privacy

Spinlings is a game that runs inside Claude Code, which is where your work happens. Privacy is its highest-priority rule and overrides every other rule in the game (SPEC.md section 20). This page says exactly what the mod reads, what it sends, what the server keeps and for how long, and who can see what. If the code ever disagrees with this page, that is a bug. Please report it through [SECURITY.md](SECURITY.md).

## The short version

- **The game does not know who you are.** You are a random token and a random handle. Nothing about your Claude account, email, organization or machine is ever sent.
- **Nothing about your work leaves your machine.** The mod never reads your prompts, Claude's answers, tool calls, files, paths, repository names or cost.
- **Nothing about your usage is shown to anyone.** The only usage-related value the server receives is a model family (haiku, sonnet, opus or fable), only when you join, a pack charges or a battle starts. Nobody else sees it, and it is deleted with that pack or battle.
- **Other players see a small, fixed set of things:** your handle, team, for-trade cards, album count and league. They never see timestamps, activity, battle counts or which model you use. One caveat is under [What someone could still guess](#what-someone-could-still-guess).
- **The server keeps the minimum and deletes on a schedule.** It stores no IP addresses and keeps no request logs. No telemetry, no analytics and no third-party requests, in the mod or on the server.
- **You can see and delete everything.** `/spin privacy` shows every recent request the mod sent, and deletes your account.
- **Or play offline.** In the offline world the mod sends nothing at all.

## Who you are to the game

- **A random token and a random handle.** The server creates both when you join. The handle looks like `soft-otter-42` (an adjective, a noun and two digits). Both are chosen at random by the server and have no relation to your Claude account, email, organization, machine, OS user, session id, model or anything else.
- **The mod never sends any of those.** It never calls `$.session.authorize`, `$.session.id` or `$.session.repo`.
- **You can reroll your handle** once a week.
- **There is no free text anywhere.** No chat, no bios and no names you type, so nothing you write is ever shown to anyone.
- **A passkey is optional.** It lets another computer sign in to your account. It is made with a random 16-byte user id, never your handle or a name, and it needs no email and no password.

## What the mod reads on your machine

The mod reads only the shape of your Claude Code session:

| Signal | Where it comes from | Used for |
|---|---|---|
| Which model | `$.session.model()`, `turn.step` `model` | The family of your packs and the battle arena |
| Effort setting | `turn.step` `effort` | Battle pace (animation only) |
| Whether Claude is working | `turn.start`, `turn.complete` on the main thread | Wild encounters while Claude works |
| How a turn ended | `turn.complete` `reason` | A one-line reaction |
| Spinner phase | the spinner's `mode` in `ui.render` | A spinner suffix during a battle |
| Subagents | `agent.spawn` (a count only) | A cheering line in the band |
| Rate limits | `session.measure` (the rate-limit percentages only) | One status note when you hit a limit |
| Compaction | `session.compact` `trigger` | A one-line reaction |
| Session open | `session.start`, `session.end`, a once-a-minute clock tick | Presence minutes for packs |
| A session started over | `classic.SessionStart`, for `clear`, `resume` and `fork` only | Picking the game back up |
| The band and the pane | `ui.render` and `ui.close` (their size, focus, and that you pressed esc) | Drawing them, and going back one view |
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

## What the mod keeps on your machine

Claude Code's plugin storage on your machine holds your token, a copy of your online game for drawing it quickly, your offline save if you play offline, the last 20 requests the mod sent (for `/spin privacy`, with the token removed) and the mod's own bookkeeping (presence minutes, whether the game is quiet, sound and motion settings). Each server you use, and the offline world, keeps its own keys, and neither world ever reads the other's. The token never appears in logs, shares or the privacy view.

## What the mod sends

In the offline world, nothing: not one request. Online, every request goes to the one server URL in the mod's settings, over https. The default is `https://spinlings.dev`. Plain http is allowed only for `localhost` and `127.0.0.1`. Your token is sent only in the `Authorization` header, and only to that host.

These are all the kinds of request body the mod can send:

| Request | Body |
|---|---|
| Join | the proof-of-work answer and the model family you are using |
| Charge a pack | the model family you used most in that stretch |
| Start a battle | wild or duel, the model family you are using, and for a revenge the handle you are challenging |
| Finish a battle | the round numbers on which you pressed 1 |
| Redeem a drop | the code you typed |
| Everything else (catching, packs, team, fusion, recycling, crafting, trading, the Wandering Trader, wishlist, gifts, claims, the leaderboard switch, a new handle, passkeys, resetting access, settings) | the ids of the cards, packs, species, offers, players or gift codes involved, and simple choices such as which catch you picked or a for-trade switch |
| Reading your game, profiles, the trade board, the leaderboard and the world | nothing |

A model family is one of `haiku`, `sonnet`, `opus` or `fable`, never a model id. Every request also carries the mod's version in an `X-Spinlings-Client` header, which is the same for everyone on that version and is never stored. Claude Code's own HTTP layer may add standard headers such as a user agent; the server never stores them.

**Passkeys.** Saving or using a passkey happens on a page of the server that you open in your browser. That page sends the server what the browser's passkey prompt returns: a new public key when you save one, or a signature when you sign in. Nothing else about you or your device is sent.

The timing of requests says a little on its own. A pack charge means Claude Code was open on your machine, and a wild encounter means Claude was busy at that moment. It never says on what. Other players never see this timing (see below).

`/spin privacy` shows the last 20 request paths and bodies the mod sent, with the token redacted.

## What the server keeps, and for how long

| Data | How long |
|---|---|
| A player id and your handle | Until you delete your account, or until it can no longer be reached (below) |
| A session for each device you play on: a SHA-256 hash of its token (never the token), the day it was made and the day it was last used | Deleted after 180 days unused |
| Passkeys you saved: the credential id, the public key, the random user id, a sign-in counter and the day you saved it | Until you delete your account |
| A passkey page in progress | Deleted after 10 minutes, or when used |
| Your game: cards, team, packs, sparks, rating, league, streak, wishlist, album, Fusion Log, your last 5 duel opponents (so matchmaking skips them), the drops you redeemed and the leaderboard switch | Until you delete your account |
| For each card, how many battles it fought in each arena, hidden from everyone, to pick its raised form | Kept with the card while you own it; cleared when it changes hands |
| When you joined | A date, never a time, until you delete your account. The 3-day trust gate for trading and gifts and the 7-day lock on welcome cards need it. |
| When you were last seen and last finished a battle, and on how many days you have finished one | Dates, never times |
| The model family of a pack charge or a battle | Only as long as that pack or battle |
| Battles (teams, seed, your presses, result) | Deleted 7 days after the battle is settled. Only aggregate counters remain. |
| Notices (defense results, trade and gift news) | Deleted after 30 days |
| Finished offers and gifts (accepted, declined, cancelled, expired or claimed) | Deleted 30 days after they end |
| Your previous handle, after a reroll or after deletion | Kept for 30 days, so nobody else takes it straight away |
| Join challenges | Deleted when used, or when they expire after 5 minutes |
| Join counters (see below) | Deleted after 24 hours |

The server keeps a date instead of a time wherever a game rule allows. It keeps exact times only where a rule needs them, such as the 10-minute battle window, the spacing between battles and between pack charges, trade locks and expiry times, and it clears the spacing marks on your account after 24 hours.

**Accounts nobody can reach.** When an account has no session left (each expires after 180 days unused) and no passkey, nobody can ever sign in to it again, so the server deletes it, exactly as if you had deleted it yourself.

**Never kept:** your IP address, user agent, timezone, email, Claude account, organization, or anything about your work. There are no request logs.

**IP addresses.** To limit joins, the server computes `HMAC(SECRET, utcDate + ip)`, cut to 16 bytes, where `SECRET` is a server secret. Only that value is stored, in a join counter that is deleted after 24 hours. Because the date is part of the input, yesterday's values cannot be matched to today's. Short burst limits are counted in memory and never written down.

**No request logging.** Cloudflare Workers observability and Logpush stay off. The server logs only error codes, never URLs, request bodies, tokens, handles or IP addresses.

**The hosting provider.** The default server runs on Cloudflare Workers with a D1 database, so Cloudflare carries its traffic and stores its database as the hosting provider, under Cloudflare's own privacy policy. If you would rather not rely on that, the server is open source and you can run your own (see [docs/self-hosting.md](docs/self-hosting.md)).

## What other players can see

| Where | What is visible |
|---|---|
| Your profile, in the game and at `{server}/u/{handle}` | Your handle, team, cards marked for trade, album count and league |
| The leaderboard | Only if you opt in: your handle, league and rating |
| Defense notices | When someone duels your team, you get a notice with their handle and the result. When you duel someone, they get the same about you. The time is rounded to "today" or "yesterday". |

**Never visible to anyone else:** your wins, losses or battle counts, when you joined, when you were last seen, your activity, the arena or model you used, and any timestamps.

Cards other players see show the creature, its level, stats and traits, and nothing about its owner: no dates, no locks, no tiredness and no raised form. When you do something with another player, they see your handle alongside it, and nothing beyond the list above:
- **Duels:** your opponent sees your handle, your league and your saved team, as on your profile.
- **Trades:** the other player sees your handle and the cards in the offer. The trade board shows your handle next to the cards you marked for trade.
- **Gifts:** whoever claims your gift sees your handle and the card. The gift page at `{server}/g/{code}` shows the card to anyone who has the code.
- **Cards that change hands** arrive as if made that day: their earlier dates, arena counts and raised form are cleared, so nothing on them tells the new owner when or how you had them.
- **First discoveries:** the first card of a species anyone in the world obtains in a season carries a `First Discovered` stamp wherever that card is shown. The game never says who found it.
- **Mythics:** if you catch a Mythic, its card says "Discovered by" your handle, and the public "Mythics found" list shows your handle and the Mythic's name, nothing else. If you reroll your handle or delete your account, your handle comes off the card and the list.

**Public pages** (profiles, card pages at `{server}/c/{id}` and gift pages) show only what a profile shows, plus Mythic discoveries as handle and name. They run no scripts and load nothing from other sites. The only pages with a script are the two passkey pages, which load one small file from the same server and nothing else.

`/spin share` only copies text to your clipboard. Nothing is posted anywhere unless you paste it yourself.

### What someone could still guess

Cards belong to families, and a pack charges in the family of the model you used most while it charged. So the families of the cards you show, on your team and marked for trade, can hint at which model family you tend to use. Catches, trades, gifts and crafting mix families up, and you choose which cards are on your team and marked for trade.

Your starter team says more. It is one card from the family of the model you joined with, one from the family it beats and one from the family that beats it, so while all three starters are on your saved team, anyone who sees your team can work out the family you joined with. Starters cannot be traded away, but you can take them off your team.

Other players never see dates, times or amounts.

## Deleting your account

`/spin privacy` has a delete button behind a 2-second hold. It calls `DELETE /v1/me`, which removes your player record, your sessions and passkeys, and all of your cards, packs, battles, offers, gifts, notices, wishlist and first-discovery credit. Cards you already traded or gave away stay with their new owners. The server remembers only that your handle was taken, so nobody else gets it straight away, and frees it after 30 days.

Anything the server deletes, whether your account or old battles and notices, can stay in the database's point-in-time recovery history (Cloudflare D1 Time Travel) for up to 30 days, after which it is gone for good. That history is only ever used to recover from data loss.

Uninstalling the mod does not delete your account, so delete it first. Otherwise the server keeps it until it can no longer be reached: 180 days after its last use, if you never saved a passkey. An account with a passkey is kept until you delete it.

## How this is checked

- CI fails if any response visible to another player contains a field outside the lists on this page, or if the mod sends anything outside the documented request shapes.
- CI checks the mod's hooks, the event fields it reads and its `$` calls against fixed lists, both in the source and in `claude plugin validate --json`, on every pull request.
- The mod and server are open source, so you can read both.

## Self-hosted servers

The promises on this page describe this code. Whoever runs a server controls it, and a modified server could keep more. The default server is run by the maintainer of this repository. You can point the mod at any server with `/spin server <url>`, including one you run yourself. The mod shows a one-time notice before it connects to any server other than `https://spinlings.dev`.

## Changes

Changes to this page are tracked in this repository's history. Questions go in a GitHub issue; security and privacy problems go through [SECURITY.md](SECURITY.md).
