# Launch readiness

Follow [releasing.md](releasing.md) and every Check in [CONTRIBUTING.md](../CONTRIBUTING.md) before each commit. Marketing remains a separate task.

Status: **v0.2.14 has passed local Checks; release delivery is pending.**

## Product and compatibility

- [x] When the host provides at least 40 columns and 12 rows, the v0.2.14 candidate uses a crisp chunky pixel world: four local backgrounds reduced to a 32-colour palette on a 160 x 30 logical grid, exported with nearest-neighbour 3x scaling as 480 x 90 PNGs. The SVG image-mode scene remains 144px with a native header/footer and responsive camera. Contact shadows ground the creatures and feathered world edges blend into the host; the target avoids painterly Gaussian blur. Names, HP, damage/healing, critical/effectiveness/trait/knockout cues and native Day/Now! controls retain the existing authoritative round and timing. Motion off is still; quiet keeps a player-started battle still and hides other moments. Smaller width/height budgets use compact action-first words; the terminal keeps four rows. API v1, minimum client 0.1.0, rules 1, generator 2 and offline format 1 remain unchanged. The user approved the chunky pixel direction; exact native v0.2.14 appearance, animation and physical controls require independent verification. v0.2.13 was installed but has no native confirmation; only the v0.2.12 footer and single composer control opening the pane have that prior confirmation. Existing stills remain v0.2.9 and duel footage v0.2.3.
- [x] The installed plugin contains only player runtime files. Internal QA scenes, preview navigation and SDK suites stay in the repository; /spin demo is unsupported. The staging runner checks unchanged runtime bytes and every SDK suite, and a release regression guards this packaging boundary.
- [x] The compact composer button shows one contextual cue: Spinlings ▪ takes priority for a held ready pack; otherwise Spinlings #N shows the player's rank only from an already-loaded rating/all board matching the current handle and rating, while opted in, online and ready, with no active battle. All other states read Spinlings. No ranking request is added, cues are never combined and there is no adjacent status text. Desktop uses actionable SessionMode and the terminal uses PromptHint; both compose the host's next value unread, take no focus or hotkey, and hide in quiet mode. Cached-account guards remain. Hosts without a rendered launcher show only a ready dot when applicable, otherwise nothing. World, update and pack-count details stay inside the pane. Installed native appearance and clicks require separate confirmation.
- [x] Optional chimes are synthesized locally from readable notes, with byte-for-byte preservation of all four original PCM recordings. No binary audio asset, network, filesystem or new runtime dependency is needed; sound remains off by default, quiet silences it, and synthesis is cached only on enabled playback.
- [x] Directory static-scan-compatible capability registration and a repository-owned square listing icon. The runtime capability/event allowlist and content-blind privacy contract remain unchanged; conservative scanner holds are presented for human review rather than hidden.
- [x] One world chooser from the interactive header or /spin world: offline, Spinlings online/default, or a reviewed community address. /spin world online returns to spinlings.dev. Existing server aliases remain supported. Community Connect is explicit; Cancel/Back send nothing to the proposed server. Saved sessions, caches and offline collection remain separate; stale and delayed choices cannot switch worlds.
- [x] Team groups waiting packs, Open, artwork and countdown in one section, including the existing comfortLine rate-limit note when resting. Help explains the ready dot beside Spinlings. The header contains tabs, the daily rule and the world control. Full community addresses wrap at narrow sizes; no duplicate global pack action.
- [x] Optional Alt colour and Foil labels stay separate from rarity. Looks explains palette/frame, no battle stat bonus, and existing recycling multipliers. Old shiny/foil wire fields, odds, artwork/hit controls and card records stay unchanged.
- [x] One card per pack with ordinary 70/22/7/1 rarity odds and no guarantee. Existing team-slot choices, inline Close/Sidebar, exact market prices, passkeys/username recovery, profile sharing, filters and leaderboard places remain covered.
- [x] Current release requests are recorded; every released reader/flow, historical rules engine and generator remains immutable and passes compatibility replay. API v1, minimum client 0.1.0, rules 1, generator 2 and offline format 1 remain. No new migration, runtime dependency, transmitted game fields, public player fields or persisted game fields.
- [ ] Prior native v0.2.12 confirmation covers the footer and single composer control opening the pane. v0.2.13 was officially installed but never received native appearance/control confirmation. Native v0.2.14 pixels, image-mode animation and physical controls remain pending; SDK/browser/code previews are not native proof. Four stills remain v0.2.9 and duel footage v0.2.3.

Seasons and ordinary generated species continue without a mod update; new families or battle mechanics still need the contract in [compatibility.md](compatibility.md). Backlog 3 welcome farming and 5 generic content packs remain unanswered and untouched. FOUNDERS remains inactive.

## Website, repository and directory

- [x] Existing website appearance preserved. README images, install links, requirements, badges, preview metadata, media budgets, content blindness, privacy and staged artifacts reviewed. Plugin-folder README and unchanged MIT license meet directory source requirements.
- [x] Four existing native v0.2.9 PNGs remain honestly versioned. Duel GIF/video/still remain real v0.2.3 footage; code-rendered pack/evolution/season art remains illustration. No new native screenshots are claimed.
- [ ] Claude directory review submission explicitly requested by the maintainer. The maintainer signed in and the directory draft is in progress. Source validation must be checked on the actual candidate; the maintainer requires zero warnings, policy holds and blockers before submission; prior privacy/audio/mod findings remain unresolved until an actual matching scan clears them. Nothing has been submitted or published and automatic publishing is off.
- [ ] Production read-only health/version, pages, account, previews, robots/sitemap and gallery routes: pending.
- [ ] Disposable production smoke verifies one-card packs and browser-facing HTTP/passkey protocol/HTML, chosen username, fresh same-account sign-in/team/stats, filters/Attack, sharing, signout and deletion/revocation: pending.
- [ ] Strictly smoke-owned cleanup: pending; real players remain untouched.

Existing main rules block deletion/force pushes; required PR/CI rules are not configured. This task keeps the established direct-main release workflow and does not claim that stricter setup is complete. No social posts, outreach or new platform accounts.

## Release gate

- [x] All pre-source Checks: 1124 Node tests, zero failures/skips; 243 isolated SDK tests, zero failures/skips; both strict validators; 24 HTTP steps/357 requests; fresh 208672-byte site build; Worker dry-run.
- [ ] Source commit/CI pending; server-first deployment and production verification pending.
- [ ] Immutable [v0.2.14 release](https://github.com/416rehman/spinlings/releases/tag/v0.2.14) on the checked source, with sanitized strict-validator notes.
- [ ] Marketplace exact tag/SHA pin, all pre-pin Checks and CI pending.
- [ ] Fresh and actual user official installs pending. No candidate preview or saved-game files were edited for this task.
- [ ] Only this release's redundant tag deployment will be cancelled after manual delivery.

Source and marketplace commits each require every Check and exact successful CI. Official install and directory reconciliation are recorded privately after delivery; a separate handoff commit is optional and requires its own full Checks and CI if made. Evidence: .dev/codex-directory-{final,pin,handoff}-0.2.14-*.log.
