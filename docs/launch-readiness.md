# Launch readiness

Complete this checklist against the exact candidate. Follow [releasing.md](releasing.md) and every Check in [CONTRIBUTING.md](../CONTRIBUTING.md) before each commit. Marketing posts and outreach are a separate task.

Status on 2026-10-04: **v0.2.9 has checked source and server delivery; marketplace delivery is pending.**

## Product and compatibility

- [x] Every pack gives one card at ordinary 70/22/7/1 odds, with no guaranteed rarity. Existing cards stay owned; price, pacing, welcome-pack count and binding/trading stay unchanged. Older supported online mods receive one card; older offline mods retain their bundled rules.
- [x] Explicit three-slot replacement/swap chooser preserves removed teammates and Back origin, confirms authoritative results, and rejects stale/held/missing choices. Empty-slot artwork matches occupied slots.
- [x] Inline pack preview/Open/Close/Sidebar preserve unopened packs, awarded cards and reveal progress. Closing during a request cannot revive it; battle/catch controls retain priority; world changes and stale callbacks are guarded.
- [x] Sellers set exact whole-spark prices. Recent matching sales show the last price, and an average with a sample count when at least two match. A plain crafting cost is also available as a reference.
- [x] Dario, Marshmallow Menace, Noodle Knight and Soggy Emperor each use one normal worldwide Mythic encounter. Atomic owner-free reservations persist after flee/deletion; ordinary generated Mythics continue, with unchanged odds/stats/forms.
- [x] Every immutable released reader/flow passes; current-version fixtures are recorded. Replay top-ups use paid API acquisition, observed cards and frozen-reader validation, without aliases, fabricated cards or edited historical recordings.
- [x] API v1, minimum client 0.1.0, rules 1, generator 2 and offline format 1 stay unchanged. No new runtime dependencies, request fields or public player fields. Migration 0004 adds only anonymous world-content reservation ids; PRIVACY describes it.
- [x] Candidate native v0.2.9 footer, artwork selection, slot chooser, inline Close/Sidebar and exact-price entry: v0.2.9 artwork selection, three-slot chooser, inline Close preserving unopened packs, Sidebar/Open awarding one card, and exact-price Apply confirmed in Claude Desktop. Later lifecycle guards, busy-team confirmation, community-server connection and static preview changes have SDK proof; the final official installation still needs a fresh native reload/check.

Seasons, ordinary species and these embedded Mythics work without reinstalling supported mods. New families, artwork primitives or incompatible battle mechanics still need a defined compatibility contract; see [compatibility.md](compatibility.md). Claude Code needs 2.1.287 or later; Desktop also needs a compatible bundled engine.

Backlog 3 welcome-pack farming and Backlog 5 generic server content packs remain unanswered and untouched. FOUNDERS is inactive. No marketing posts, outreach or submissions are authorized by this release.

## Website, repository and media

- [x] Existing website header, layout, palette and scenery preserved. Pack demo follows one card/no guarantee; private collection, stats, filters, trait help, username/passkeys and profile sharing remain covered.
- [x] Fresh cropped native screenshots appear in README and the optional first-party website gallery. Four fresh native PNGs in README and the first-party website gallery; crop/source/hash provenance retained privately
- [x] Requirements, badges/install links, social preview metadata, image budgets, same-origin media, staged secrets/private artifacts and released-history integrity reviewed.
- [x] Production health/version, public pages/previews, account, robots/sitemap and screenshot routes: Production read-only verification: v0.2.9, 230/230 checks passed..
- [x] Disposable production smoke covers one-card pack, passkey registration, chosen rename/fresh recovery to same account/team/stats, filters/Attack sort, sharing, browser-only signout, account deletion/revocation: Passed 19 mod/client requests in 10.2 seconds plus browser passkey, chosen rename/recovery, filters/sharing/signout and deletion/revocation flows..
- [x] Cleanup removes only precisely verified smoke-owned discovery rows: Exactly two verified smoke-owned records removed; zero remained; other players untouched..

The README battle GIF/video/still remain real v0.2.3 Desktop footage. Pack/evolution/season SVGs and PNG posters are illustrations. New captures must retain version/source/hash provenance privately and exclude unrelated sessions, private notices and credentials. Marketing campaign copy/assets receive their own review in the next task.

## Release gate

- [x] All pre-source Checks: 1043 Node tests, zero failures/skips; 199 isolated SDK tests, zero failures; strict plugin/marketplace validation; 364 HTTP requests across 24 steps; fresh site 208672 bytes; Worker dry-run passed.
- [x] Source `358b50412cab00e423c9b3d70d738b0f6d506d51`; [CI 37267537474](https://github.com/416rehman/spinlings/actions/runs/37267537474); server-first migration/deploy and smoke verified.
- [ ] Immutable [v0.2.9 release](https://github.com/416rehman/spinlings/releases/tag/v0.2.9) is on the exact checked source with sanitized strict-validator notes.
- [ ] Marketplace exact tag/SHA pin, full pre-pin Checks and CI pending.
- [ ] Fresh/user official installs pending; temporary preview restored before installing.
- [ ] Only this release's redundant tag deployment will be cancelled after manual deploy.

Final handoff SHA/Checks/CI are recorded privately after completion; this document never claims future proof for its own commit. Logs use `.dev/codex-launch-{final,pin,handoff}-0.2.9-*.log`.

## Historical v0.2.8

Source/tag f4a6cbd90a4633b5c0bf5b7788d96a103551d10e, CI 37258775792; pin 9af18f09dc868dc7b39c9fe527266b1459a7ab3a, CI 37259289513; final 703ae5c3c22c79237f2acb1866f68c0f8db7b13f, CI 37260212812. Before each commit: 1006 Node tests, zero failures or skips; 171 isolated SDK tests, zero failures; both strict validators; 24 HTTP steps; fresh 208686-byte site build and Worker dry-run. Production 158/158, disposable smoke and verified owned cleanup, fresh/user installs matching 92 tagged blobs; only redundant deploy 37259080067 cancelled. That release repaired Desktop's empty SVG accessibility label; its results do not certify v0.2.9.
