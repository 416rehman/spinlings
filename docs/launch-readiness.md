# Launch readiness

Follow [releasing.md](releasing.md) and every Check in [CONTRIBUTING.md](../CONTRIBUTING.md) before each commit. Marketing remains a separate task.

Status: **v0.2.11 has checked source and server delivery; marketplace delivery is pending.**

## Product and compatibility

- [x] The installed plugin contains only player runtime files. Internal QA scenes, preview navigation and SDK suites stay in the repository; /spin demo is unsupported. The staging runner checks unchanged runtime bytes and every SDK suite, and a release regression guards this packaging boundary.
- [x] A native Spinlings composer button opens the pane and shows waiting packs with a dot and explicit count. Claude's own hint is composed unread, no hotkey/focus is taken, quiet hides it, cached packs are guarded, and hosts that do not render PromptHint retain concise fallback status. SDK coverage includes 20/40/80/120 columns on both surfaces; native appearance remains unverified.
- [x] Optional chimes are synthesized locally from readable notes, with byte-for-byte preservation of all four original PCM recordings. No binary audio asset, network, filesystem or new runtime dependency is needed; sound remains off by default, quiet silences it, and synthesis is cached only on enabled playback.
- [x] Directory static-scan-compatible capability registration and a repository-owned square listing icon. The runtime capability/event allowlist and content-blind privacy contract remain unchanged; conservative scanner holds are presented for human review rather than hidden.
- [x] One world chooser from the interactive header or /spin world: offline, Spinlings online/default, or a reviewed community address. /spin world online returns to spinlings.dev. Existing server aliases remain supported. Community Connect is explicit; Cancel/Back send nothing to the proposed server. Saved sessions, caches and offline collection remain separate; stale and delayed choices cannot switch worlds.
- [x] Team groups waiting packs, Open, artwork and countdown in one section. The header contains tabs, the daily rule and the world control. Full community addresses wrap at narrow sizes; no duplicate global pack action.
- [x] Optional Alt colour and Foil labels stay separate from rarity. Looks explains palette/frame, no battle stat bonus, and existing recycling multipliers. Old shiny/foil wire fields, odds, artwork/hit controls and card records stay unchanged.
- [x] One card per pack with ordinary 70/22/7/1 rarity odds and no guarantee. Existing team-slot choices, inline Close/Sidebar, exact market prices, passkeys/username recovery, profile sharing, filters and leaderboard places remain covered.
- [x] Current release requests are recorded; every released reader/flow, historical rules engine and generator remains immutable and passes compatibility replay. API v1, minimum client 0.1.0, rules 1, generator 2 and offline format 1 remain. No new migration, runtime dependency, transmitted game fields, public player fields or persisted game fields.
- [ ] Direct native v0.2.11 reload/control verification remains pending. Existing game controls are retained alongside the new composer launcher; SDK mounting and pointer injection are not native click proof. Existing artwork/slot/pack/price confirmations and four native screenshots are v0.2.9; they do not certify the v0.2.10 chooser/grouping or v0.2.11 installed code.

Seasons and ordinary generated species continue without a mod update; new families or battle mechanics still need the contract in [compatibility.md](compatibility.md). Backlog 3 welcome farming and 5 generic content packs remain unanswered and untouched. FOUNDERS remains inactive.

## Website, repository and directory

- [x] Existing website appearance preserved. README images, install links, requirements, badges, preview metadata, media budgets, content blindness, privacy and staged artifacts reviewed. Plugin-folder README and unchanged MIT license meet directory source requirements.
- [x] Four existing native v0.2.9 PNGs remain honestly versioned. Duel GIF/video/still remain real v0.2.3 footage; code-rendered pack/evolution/season art remains illustration. No new native screenshots are claimed.
- [ ] Claude directory review submission explicitly requested by the maintainer. The actual source scan completed: main 20bfb0c passed with zero blockers, five warnings and seven policy holds; the permission and binary-audio holds cleared. Submission is held until the maintainer's fully green checklist is met; nothing has been submitted or published and automatic publishing is off.
- [x] Production read-only health/version, pages, account, previews, robots/sitemap and gallery routes: Production read-only verification: v0.2.11, 230/230 checks passed.
- [x] Disposable production smoke verifies one-card packs and browser passkey, chosen username, fresh same-account sign-in/team/stats, filters/Attack, sharing, signout and deletion/revocation: 19 mod/client requests in 11.7 seconds plus passkey registration, chosen rename and fresh same-account sign-in; disposable account deleted and revoked.
- [x] Strictly smoke-owned cleanup: Exactly one verified smoke-owned record removed; zero remained; other players untouched.

Existing main rules block deletion/force pushes; required PR/CI rules are not configured. This task keeps the established direct-main release workflow and does not claim that stricter setup is complete. No social posts, outreach or new platform accounts.

## Release gate

- [x] All pre-source Checks: 1080 Node tests, zero failures/skips; 217 isolated SDK tests, zero failures/skips; both strict validators; 24 HTTP steps/364 requests; fresh 208672-byte site build; Worker dry-run.
- [x] Source `20bfb0c61f52ebf686ecbebd8f218f8816311541`; [CI 37346985982](https://github.com/416rehman/spinlings/actions/runs/37346985982); server-first deployment and production verification passed.
- [ ] Immutable [v0.2.11 release](https://github.com/416rehman/spinlings/releases/tag/v0.2.11) on the checked source, with sanitized strict-validator notes.
- [ ] Marketplace exact tag/SHA pin, all pre-pin Checks and CI pending.
- [ ] Fresh and actual user official installs pending. No candidate preview or saved-game files were edited for this task.
- [ ] Only this release's redundant tag deployment will be cancelled after manual delivery.

Source and marketplace commits each require every Check and exact successful CI. Official install and directory reconciliation are recorded privately after delivery; a separate handoff commit is optional and requires its own full Checks and CI if made. Evidence: .dev/codex-directory-{final,pin,handoff}-0.2.11-*.log.
