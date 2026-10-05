# Launch readiness

Follow [releasing.md](releasing.md) and every Check in [CONTRIBUTING.md](../CONTRIBUTING.md) before each commit. Marketing remains a separate task.

Status: **v0.2.10 has checked source and server delivery; marketplace delivery is pending.**

## Product and compatibility

- [x] One world chooser from the interactive header or /spin world: offline, Spinlings online/default, or a reviewed community address. /spin world online returns to spinlings.dev. Existing server aliases remain supported. Community Connect is explicit; Cancel/Back send nothing to the proposed server. Saved sessions, caches and offline collection remain separate; stale and delayed choices cannot switch worlds.
- [x] Team groups waiting packs, Open, artwork and countdown in one section. The header contains tabs, the daily rule and the world control. Full community addresses wrap at narrow sizes; no duplicate global pack action.
- [x] Optional Alt colour and Foil labels stay separate from rarity. Looks explains palette/frame, no battle stat bonus, and existing recycling multipliers. Old shiny/foil wire fields, odds, artwork/hit controls and card records stay unchanged.
- [x] One card per pack with ordinary 70/22/7/1 rarity odds and no guarantee. Existing team-slot choices, inline Close/Sidebar, exact market prices, passkeys/username recovery, profile sharing, filters and leaderboard places remain covered.
- [x] Current release requests are recorded; every released reader/flow, historical rules engine and generator remains immutable and passes compatibility replay. API v1, minimum client 0.1.0, rules 1, generator 2 and offline format 1 remain. No new migration, runtime dependency, transmitted game fields, public player fields or persisted game fields.
- [ ] Direct native v0.2.10 reload/control verification remains pending. SDK mounting and pointer injection are not native click proof. Existing artwork/slot/pack/price confirmations and four native screenshots are v0.2.9; they do not certify the new chooser or grouping.

Seasons and ordinary generated species continue without a mod update; new families or battle mechanics still need the contract in [compatibility.md](compatibility.md). Backlog 3 welcome farming and 5 generic content packs remain unanswered and untouched. FOUNDERS remains inactive.

## Website, repository and directory

- [x] Existing website appearance preserved. README images, install links, requirements, badges, preview metadata, media budgets, content blindness, privacy and staged artifacts reviewed. Plugin-folder README and unchanged MIT license meet directory source requirements.
- [x] Four existing native v0.2.9 PNGs remain honestly versioned. Duel GIF/video/still remain real v0.2.3 footage; code-rendered pack/evolution/season art remains illustration. No new native screenshots are claimed.
- [ ] Claude directory review submission explicitly requested by the maintainer. Prepared source/listing/data-handling draft; the portal currently requires human sign-in. No form submitted, no listing published and no automatic publishing configured. Bundled audio/mod support must be checked against the actual scanner result.
- [x] Production read-only health/version, pages, account, previews, robots/sitemap and gallery routes: Production read-only verification: v0.2.10, 230/230 checks passed.
- [x] Disposable production smoke verifies one-card packs and browser passkey, chosen username, fresh same-account sign-in/team/stats, filters/Attack, sharing, signout and deletion/revocation: 19 mod/client requests in 10.1 seconds plus browser passkey, chosen rename and fresh same-account sign-in; disposable account deleted and revoked.
- [x] Strictly smoke-owned cleanup: Exactly one verified smoke-owned record removed; zero remained; other players untouched.

Existing main rules block deletion/force pushes; required PR/CI rules are not configured. This task keeps the established direct-main release workflow and does not claim that stricter setup is complete. No social posts, outreach or new platform accounts.

## Release gate

- [x] All pre-source Checks: 1059 Node tests, zero failures/skips; 214 isolated SDK tests, zero failures/skips; both strict validators; 24 HTTP steps/358 requests; fresh 208672-byte site build; Worker dry-run.
- [x] Source `4571118eb07af5f28f263885702e76abb0f5ebe8`; [CI 37272931841](https://github.com/416rehman/spinlings/actions/runs/37272931841); server-first deployment and production verification passed.
- [ ] Immutable [v0.2.10 release](https://github.com/416rehman/spinlings/releases/tag/v0.2.10) on the checked source, with sanitized strict-validator notes.
- [ ] Marketplace exact tag/SHA pin, all pre-pin Checks and CI pending.
- [ ] Fresh and actual user official installs pending. No candidate preview or saved-game files were edited for this task.
- [ ] Only this release's redundant tag deployment will be cancelled after manual delivery.

Final handoff commit/Checks/CI are recorded privately after completion. Evidence: .dev/codex-world-{final,pin,handoff}-0.2.10-*.log.
