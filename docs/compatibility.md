# Keep installed mods playing

Players should be able to install once and keep playing. The server already receives `X-Spinlings-Client` on every mod request. That release version is enough to choose a supported response; do not add device identity, usage history or session fingerprints. Headers are untrusted, are not logged, and never decide rewards or permissions.

The server returns API, rules and generator versions, its minimum supported mod, the latest release and feature flags. The mod checks this handshake daily and after an update. Missing features stay hidden. `/spin version` shows the installed mod and server status, and updates remain optional while that release is supported.

## What can arrive without an update

| Change | What an installed mod does | Release requirement |
|---|---|---|
| New 28-day season | Fetches its 36 frozen species; keeps old cards and receives the previous season's reward once | Test rollover, old collections and old released readers |
| New creature using existing families and artwork shapes | Renders the server's frozen form with the card's DNA | Preserve the immutable season; test names, art and fusion parents |
| Card numbers or battle balance | Uses server-supplied stats; if rules differ, watches the authoritative log without Perfect timing | Increment rules for changed logs; register the engine and keep historical replay |
| New trait ID | Shows the ID with a generic explanation in an older mod; server log supplies its battle effect | Keep the response within the old trait and log bounds; new descriptive help may need an update |
| New league label | An older reader uses its existing safe league fallback; rating and ranking values still work | Do not assume old artwork or labels know the new tier |
| New screen or client interaction | Keeps its existing screens; unsupported feature controls stay hidden | Optional mod update for the new UI |
| Entirely new family, body shape or protocol | Needs a supported fallback or a parallel versioned protocol | Explicit design first; content packs remain a separate decision |

This is a bounded compatibility contract, not a promise that old code can draw arbitrary future content. The v1 log retains three creature slots per team, 30 rounds, two actions per round and four hits/charge per slot. Future special IDs are omitted from the v1 display label while preserving damage, HP, healing, rewards and the outcome. A mechanic that cannot be represented inside these bounds needs a compatible v1 path or `/v2` alongside `/v1` for at least six months.

## Seasons and worlds

Every server freezes a season once in its own database. A later generator change applies to future seasons. Starting with v0.2.3, the client reads every referenced season, including the opposing team and fusion parents, even when today's generator matches its own. Two servers can have different frozen forms for the same species ID, so their catalogs and artwork caches must remain separate. Offline generation never reads an online catalog.

Older releases retain their shipped catalog loader: it fetches only on a generator mismatch, loads at most eight seasons per response and does not isolate every server's artwork. A server deployment cannot repair that installed code. Retained generator 2 and rules 1 preserve their existing game, and frozen-reader tests verify their v1 responses, but those tests do not prove the old hydration loop handles arbitrary future catalogs. v0.2.3 is the baseline for the complete loader; test any future generator change against older clients' rendering behavior before serving it to them.

League tiers such as Pebble are rating bands, not separate seasons. When a season turns, the server keeps cards and passkeys, softens the rating as documented in SPEC 6, resets seasonal counters and pays the previous season's eligible league reward on the first visit. Repeated visits must never pay it twice. All-time stats stay intact.

Battle rows carry their own rules version and snapshot stats. Retained server engines freeze their constants and random stream; changing current balance must not change an already-started battle. Add an engine instead of retuning an old one. Retain offline generator implementations for the versions recorded in saves too.

## The release gate

Keep every supported release's recorded traffic and reader immutable. Run those readers against the new server, plus checks for future labels, rules mismatches, multiple frozen seasons, server switching, offline isolation and a season rollover. Register a new engine before changing `RULES_VERSION`, retain old generators before changing `GENERATOR_VERSION`, and check the v1 shape before introducing a new mechanic. Unknown response fields being ignored is not sufficient proof of compatibility.

Below `minClient`, game writes return `upgrade_required`. Reads and authenticated account deletion remain available, and offline play remains usable. Never raise that minimum simply to promote an update.

Players can enable Spinlings marketplace auto-update in `/plugin` → Marketplaces → spinlings → Enable auto-update. Third-party marketplaces default to manual updates, and a marketplace cannot enable this for the player. See [Anthropic's update guide](https://code.claude.com/docs/en/discover-plugins#turn-auto-update-on-or-off-for-a-marketplace).
