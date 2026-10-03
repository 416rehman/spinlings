# Launch kit

Everything for launch day: the Show HN post, the X thread built around the Founder's Egg drop, the Product Hunt listing, the media in `docs/media`, and the shot list for the real recordings from the desktop app.

SPEC 35 says every piece of launch media comes from the Code tab of the Claude desktop app, running the real installed mod. The files in `docs/media` come close to that: they are drawn by the mod's own views (`band.tsx`, `pane.tsx`, `ceremony.tsx`, `card.tsx`) in their desktop form, from real game states, with only the window around them drawn by hand. Use them until the real captures exist, then swap them in.

## Media in this repo

Rebuild with `node scripts/media/build.ts` (or name some: `encounter pack evolve gallery stills`). It needs no dependencies. Every SVG loops, plays inside a GitHub README `<img>` with no script, comes in a `-dark` and a `-light` version, and stays under 300 KB.

| File | What it shows | Use |
|---|---|---|
| `encounter-{dark,light}.svg` | Claude works; something rustles with an epic's shimmer; a wild Snowelkie appears (NEW, FIRST IN THE WORLD?); four rounds, with `1 Now!` and a Perfect Crescendo; the catch wobbles three beats, then Gotcha! (21 s) | README hero |
| `pack-{dark,light}.svg` | The pane: an Opus pack tears open, five backs (one pulsing gold), each flip paced like the real driver, LEGENDARY!, the summary, then the legendary's card with its foil sheen (22 s) | README "See it", PH video stand-in |
| `evolve-{dark,light}.svg` | Sootwolf evolves into Sootaptor, then Sootinotaur, in the band; the album page shows the whole line (20 s) | README "See it" |
| `gallery-{dark,light}.svg` | Season 1's 36 species by family, growing through their stages in one slow wave; legendaries in foil frames | README "See it", PH gallery |
| `ph-1-battle.png` … `ph-4-season.png` | 1270 x 760 stills: the battle, no two cards alike, packs that glow, 36 species and what the game never reads | Product Hunt gallery |
| `x-card.png`, `x-founders.png` | 1200 x 675: the wordmark with one creature evolving; the Founder's Egg and its code | X posts |
| `github-social.png` | 1280 x 640 | Repository settings, Social preview |

To check a recording by eye, paint frames from it with a local Chrome or Edge:

```sh
node scripts/media/frames.ts docs/media/encounter-dark.svg 3 10.7 17 --out .dev/frames
```

**One thing to decide before launch:** the gallery poster and `ph-4-season.png` show all 36 season 1 species, names included. The site's season page hides species nobody has found yet, to keep first discoveries special. If that matters more than the poster, ship the poster for a later season instead, or hold it until the season has been explored.

## Show HN

**Title** (80 characters at most, no hype words):

> Show HN: Spinlings – a creature card game that lives inside Claude Code

**Link:** the GitHub repository (the README hero plays right away).

**First comment, posted by the author straight after** (outline; keep it in the first person and short):

1. **What it is.** While Claude works, wild creatures rustle into a band above the prompt and your team of three battles them. Packs charge while Claude Code is open. Every card is one of a kind, and now and then a Mythic turns up that has never existed before.
2. **Why it exists.** Waiting on a long turn is dead time. This fills it without touching the work: the game never sees a prompt, a file or a line of output.
3. **How it stays out of the way.** It hooks only session-shape events (model family, working or not), never `tool.call` or `prompt.submit`. Zero model calls, nothing in Claude's context, every hook passes straight through. `claude plugin validate` prints the full hook list.
4. **How it is built.** One stateless Cloudflare Worker on D1. D1 has no interactive transactions, so every write is one atomic batch that starts with guard statements; a failed guard rolls the whole batch back and the handler retries. The server mints every card and replays every battle from its seed and the rounds you pressed 1 on. Zero npm runtime dependencies, our own SHA-256, PNG encoder and CBOR decoder.
5. **Privacy.** No account: a random handle, an anonymous session, an optional passkey. Other players never see when you play, how much, or which model. No telemetry, no request logs, day-granularity dates.
6. **Honest limits.** A modified client can automate what an attentive heavy player does, and nothing more; the README's Cheating section lists exactly where the lines are. Self-hosting works on Cloudflare or plain Node.
7. **Playable alone.** Rivals and a Wandering Trader fill in when no one else is around, so day one works.
8. **Ask.** Feedback on the battle feel, the pacing of encounters, and whether the privacy model holds up.

**Reply bank** for the questions that will come up: does it slow Claude (no, hooks pass through, battles never wait); does it use my tokens (no model calls); can it see my code (no, list of hooks); why a server (so nobody mints cards locally, and trades work); is there money (no purchases, no currency, no crypto); is it affiliated with Anthropic (no).

## X thread: the Founder's Egg

Create the drop first (SPEC 25), with a dry run before the real one:

```sh
node scripts/admin/drop.ts create --code FOUNDERS --egg Lanternmoth --family fable --rarity epic --foil \
  --stamp "Founder · Oct 2026" --seed founders-2026 --packs 1 --days 7 --dry-run
```

Check the preview PNG it writes, then run it again without `--dry-run`. The drop page is `https://spinlings.dev/d/FOUNDERS`.

1. **Hook** (media: the real hero GIF, or `encounter-dark.svg` rendered to GIF): "I made a creature card game that lives inside Claude Code. While Claude works, wild creatures show up above your prompt and your team battles them. It never reads your code."
2. **The drop** (media: `x-founders.png`): "Launch week only: the Founder's Egg. Everyone who redeems FOUNDERS gets the same creature, but it hatches with its own DNA, so no two look alike. Install, then `/spin redeem FOUNDERS`."
3. **Show me yours** (media: a real capture of the egg hatching, shot 6): "Post yours. I want to see how different they come out." Reply to every one that comes in with your own.
4. **Every card is one of a kind** (media: `ph-2-unique.png`): colours, eyes, genes and traits rolled per card; a 1 in 40 encounter is a Mythic that exists once.
5. **It stays out of your way** (media: `ph-4-season.png`): content-blind, zero tokens, no account, no telemetry; the hook list is in the README.
6. **Playable alone** (no media): Rivals and the Wandering Trader fill in when nobody else is online.
7. **Install** (media: `x-card.png`): `/plugin install spinlings --marketplace 416rehman/spinlings`, the repository link, and the drop page link.

Pin post 2 for the week. When the week ends, close the drop early only if something goes wrong (`node scripts/admin/drop.ts end FOUNDERS`); it ends by itself after 7 days.

## Product Hunt

- **Name:** Spinlings
- **Tagline** (60 characters at most): *Pixel creatures that battle above your Claude Code prompt*
- **Description** (260 at most): *A creature card game that lives inside Claude Code. While Claude works, wild creatures rustle in above the prompt and your team battles them. Catch, evolve, fuse and trade one-of-a-kind cards. It never reads your work and costs zero tokens.*
- **Topics:** Developer Tools, Games, Artificial Intelligence, Open Source.
- **Gallery order** (1270 x 760):
  1. the real hero capture as a GIF (shot 1); `ph-1-battle.png` until it exists
  2. `ph-1-battle.png`
  3. `ph-3-pack.png`
  4. `ph-2-unique.png`
  5. `ph-4-season.png`
- **Video:** a 40 to 60 s cut of shots 1, 2, 3 and 6 back to back, no music needed.
- **First maker comment:** the Show HN first comment, trimmed to points 1, 2, 3, 5 and 7, plus the FOUNDERS code.

## Shot list for the real recordings

### Before you record

The recording contains whatever the window shows, so set the scene first.

- **A throwaway project and a fresh session.** Prompts and Claude's answers are on screen. Use an empty folder and a harmless long task, for example: *Draft a README for a fictional recipe app, then rewrite it twice in different tones.*
- **The sidebar out of frame.** It lists other sessions' titles. The default `-Crop conversation` leaves it out; if you collapse it, pass `-SidebarWidth 0`.
- **Nothing that pops up.** Turn on Do Not Disturb and close chat apps. The script keeps the Claude window on top while it records and never records outside it, but notifications from inside the app would still show.
- **The production server.** Record after the deploy, so the pane header reads `spinlings.dev`.
- **A fresh account per take** where a shot needs the first-run moments: `/spin privacy`, hold to delete the account, then start a new session. Joins are limited to 5 an hour per network, so plan takes.
- **Settings:** `/spin motion on`, `/spin sound off` (the video has no audio anyway), quiet off. Window about 1600 x 1000, display scale fixed for the whole session. Record each shot in dark mode, then the hero and the pack shot again in light mode.
- **A dry run** to check the region: `./scripts/capture/desktop.ps1 -DryRun`, or record 3 seconds with `-ShowRegion` to see the border ffmpeg draws.

### The shots

Every command runs from the repository root in PowerShell. Outputs land in `.dev/capture` (git-ignored): an MP4, a GIF and the three still sizes. Copy the keepers into `docs/media` under the names in the last column.

| # | Shot | How to make it happen | Command | Keep as |
|---|---|---|---|---|
| 1 | **Hero: the first encounter.** Rustle, reveal, battle with `1 Now!` and a Perfect press, the catch | Fresh account. Send the long task; the first encounter is guaranteed 20 s into Claude's first long turn, and the first wild win always catches. Press 1 when `Now!` shows. Start recording as you send the prompt | `./scripts/capture/desktop.ps1 -Name hero -Seconds 45 -Delay 2` | `hero.gif`, `hero-dark.mp4` |
| 2 | **First run: the hatch and the welcome pack** | Fresh account, new session. The band shows `✦ A Spinling hatched!`; press 1 and let the ceremony auto-flip | `./scripts/capture/desktop.ps1 -Name welcome -Seconds 25` | `welcome.gif` |
| 3 | **Evolution** | Right after shot 1's win the starters reach level 4 and evolve in the band; keep recording after the catch, or record this as its own take | `./scripts/capture/desktop.ps1 -Name evolve -Seconds 20` | `evolve.gif` |
| 4 | **A pack opening** | `/spin pack` with a charged pack. A legendary cannot be forced (about 1 pack in 13 has one); keep the take with the best glow and never fake one. The rendered `pack-*.svg` covers the legendary | `./scripts/capture/desktop.ps1 -Name pack -Seconds 25 -StillAt 8,14` | `pack.gif`, stills for PH |
| 5 | **Perfect timing, close up** | During any battle; crop to the band only. Find the band's rectangle in the window from a still of shot 1 (window pixels) | `./scripts/capture/desktop.ps1 -Name perfect -Crop 300,620,1280,120 -Seconds 12` | `perfect.gif` |
| 6 | **The Founder's Egg** | After the drop is live: `/spin redeem FOUNDERS`, the egg wobbles three beats, cracks and hatches; then `/spin share` | `./scripts/capture/desktop.ps1 -Name founders -Seconds 15` | `founders.gif` for X post 3 |
| 7 | **Light mode** | Shots 1 and 4 again with the app in light mode | add `-Name hero-light` / `-Name pack-light` | `hero-light.gif` |
| 8 | **The pane, tab by tab** | `/spin`, then 1 to 4 for Team, Cards, Album, Trade; pause a second on each | `./scripts/capture/desktop.ps1 -Name tour -Seconds 16 -StillAt 2,6,10,14` | PH gallery alternates |
| 9 | **What it sent** | `/spin privacy`: the last requests with the token hidden, and the hook list. This is the proof for the "never reads your work" claim | `./scripts/capture/desktop.ps1 -Name privacy -Seconds 8 -StillAt 4` | HN reply, X post 5 |

Re-cut a take without re-recording: `./scripts/capture/desktop.ps1 -FromVideo .dev/capture/hero.mp4 -Name hero-cut -StillAt 12.5 -GifWidth 800`. For the stills, `-Fit pad` (the default) letterboxes the window in `-PadColor`; `-Fit cover` fills the frame and crops the edges.

### Swapping the real captures in

1. Copy `hero.gif` to `docs/media/hero.gif`. Keep it under 10 MB for GitHub; lower `-GifWidth` or `-GifFps` if it is bigger.
2. In `README.md`, point the hero `<img>` at `docs/media/hero.gif` and drop the `<source>` lines (the GIF has one theme).
3. Replace the Product Hunt gallery's first image with the GIF, and post shot 6 in the X thread.
