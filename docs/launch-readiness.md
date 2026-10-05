# Launch readiness

Complete this checklist against the exact release being announced. Follow [releasing.md](releasing.md) and run every check in [CONTRIBUTING.md](../CONTRIBUTING.md) before each commit. Marketing posts and outreach require a separate maintainer instruction.

Status on 2026-10-04: **v0.2.8 is released, deployed and officially installed. Native artwork/rarity interaction verification remains pending.** The maintainer confirmed footer v0.2.7: rarity, names and passive text open cards, but artwork fails and shows a Client error. The invisible artwork SVG had an empty accessibility label, which Desktop rejects. This supersedes the earlier pending native check. Earlier versions remain immutable.

## Product and compatibility

- [x] Packs open into exactly two cards; the second is rare or better. Price, pacing, welcome-pack count, binding and trading rules stay unchanged. Existing cards stay owned, and unopened packs use two cards when opened. Supported older online mods read the new server result; installed older offline worlds retain their bundled rules.
- [x] Artwork regions include the nonempty accessibility label required by Desktop and retain their full pixel size, with a clipped cell of padding for Desktop's rounded bounds; family/level and rarity/finish use separate passive text regions. Native names, controls, keyboard actions and stale-click guards remain exposed. SDK results establish source behavior, not physical Desktop clicks.
- [ ] Restart the verified installation and observe footer v0.2.8 in Claude Desktop.
- [ ] Confirm creature artwork and rarity/finish clicks open the same creature as its name in the loaded pane, with no Client error. Pending maintainer confirmation.
- [ ] Recheck family/level, Leads/slot, wrapped names, Back and root Close in the loaded pane.
- [ ] Recheck Share profile and Manage account in that loaded release.
- [x] Replay every supported immutable released reader/flow and record the new version. Variable collection lengths are resolved from observed eligible cards without manufacturing cards, changing outcomes or editing historical fixtures.
- [x] API v1, minimum mod 0.1.0, rules 1, generator 2 and offline save format 1 remain unchanged; no new migrations, dependencies, request fields, stored fields or public fields.

Claude Code requires 2.1.287 or later. Desktop needs a compatible bundled engine. Seasons and current generation rules continue without updates; arbitrary future families, artwork primitives or mechanics still require a defined compatibility contract. See [compatibility.md](compatibility.md).

Welcome-pack farming restrictions (Backlog 3) and server-delivered content packs (Backlog 5) await the maintainer's decisions and remain untouched. The proposed FOUNDERS campaign is inactive. The QA world was last known offline; restore it after native checks with `/spin world online`.

## Browser, repository and media

The established public website appearance is preserved. Its pack demo and summary follow the two-card count. Account Collection/Team/Stats, passkey identity across username changes, canonical profile sharing and privacy controls remain supported.

- [x] Production health/version, public pages/previews, private account, robots and sitemap: 158/158 passed in `.dev/codex-live-pack-final-0.2.8.log`.
- [x] Disposable production smoke: pack count and rare-or-better final card, passkey registration, rename/recovery to the same collection, team/stats/filter/Attack sort, canonical sharing, browser-only signout, deletion and revocation. Passed: 19 mod/client requests over 10.2 seconds plus direct browser flows; disposable account deleted and revoked.
- [x] Restricted cleanup matches each smoke-owned discovery ID before removing it. Verified and removed exactly two smoke-owned discovery records; no orphan records remained. Other players were untouched.
- [x] Review requirements, install links, public preview metadata, generated two-card illustrations and staged secrets/private-artifact audit.
- [ ] Capture fresh exact-release Team, Collection, Community Profile, Market, Rankings and Pack panes with observed footer and timestamp/hash provenance. Review crops for unrelated sessions, personal data and credentials.
- [ ] Approve final marketing assets in the separate marketing task.

README battle [GIF](media/desktop-duel.gif), [video](media/desktop-duel.mp4) and [still](media/desktop-duel.png) remain real v0.2.3 Desktop footage: 15 seconds, rounds 5–10, a timed Twist and win/first-pack reward. They do not establish v0.2.8 interactions. Two-card SVG/PNG scenes are illustrations rendered from the game's views. GitHub custom-preview upload proof remains private at `.dev/github-social-preview-verified.jpg`. Main/tag protections and prior security/repository review remain recorded; required PRs and main CI are a recommendation in the current direct-push workflow.

## Release gate — v0.2.8

- [x] Checked source `f4a6cbd90a4633b5c0bf5b7788d96a103551d10e`; [CI 37258775792](https://github.com/416rehman/spinlings/actions/runs/37258775792); all pre-source Checks: 1006 Node tests/zero failures or skips, 171 isolated SDK tests/zero failures, both strict validators, 24 HTTP steps/323 requests, fresh site build 208686 bytes and Worker dry-run.
- [x] Four version constants, changelog and new compatibility recording agree; earlier fixtures, engines and generators unchanged.
- [x] Server-first deploy, final production verification, disposable smoke and exact owned cleanup pass. Logs: `.dev/codex-{live,prod-smoke,smoke-cleanup}-pack-final-0.2.8.log`.
- [x] Immutable [v0.2.8 tag/release](https://github.com/416rehman/spinlings/releases/tag/v0.2.8) points to the exact checked source with sanitized notes.
- [x] Marketplace `9af18f09dc868dc7b39c9fe527266b1459a7ab3a`; [CI 37259289513](https://github.com/416rehman/spinlings/actions/runs/37259289513); exact tag/SHA pin; 1006 Node tests/zero failures or skips, 171 isolated SDK tests/zero failures, both strict validators, 24 HTTP steps/320 requests, fresh site build 208686 bytes and Worker dry-run.
- [x] Fresh and actual user official installs match all 92 tagged plugin files and pass strict validation.
- [x] Only the redundant new tag deployment `37259080067` is confirmed completed/cancelled.
- [ ] Native artwork/rarity clicks and loaded footer: pending.
- [ ] Remaining navigation and actual fresh Desktop media are independently pending.

The final readiness commit's SHA, all pre-commit Checks and CI proof belong in the private handoff after completion; this document does not claim future evidence for its own commit. Source/pin/final Check logs use `.dev/codex-pack-{final,pin,handoff}-0.2.8-*.log`.

## Historical v0.2.7 evidence

Source/tag e4456c69b1c0f47b9f7d0845f138874797beb6ac; marketplace dfb814a797059cef1d0154acf1f91b05d4e044d3; source CI37256751359 and pin CI37257349290 passed. Before both commits: 993 Node/zero failures or skips, 170 isolated SDK/zero failures, strict validators, 24 HTTP steps/323 and 322 requests, fresh 208686-byte build and Worker dry-run. Production158/158; smoke19requests/8.6s; zero verified owned orphan records remained; fresh/user92blob installs strictly validated. Redundant tag deploy37257046994 completed/cancelled. The maintainer confirmed loaded footer7 and rarity clicks, but artwork failed with a visible Client error. A later local handoff suite passed but was not committed; native failure requires v0.2.8. No earlier release evidence establishes v0.2.8.

## Historical v0.2.6 evidence

Release source `63dbf882db1bba098b9f40f98452d587562fe350`; marketplace `5137dc56db96dc7bff97fafa0a99c6f6d878923c`. Source CI37246942498, pin CI37247410081 and final readiness CI37247876854 passed. Before each of the three commits: 960 Node/zero failures or skips, 169 isolated SDK/zero failures, both strict validators, 24 HTTP steps (321/320/319 requests), fresh 208607-byte build and Worker dry-run. Production final158/158, smoke19requests/10.5s plus browser flows, exact2owned cleanup; fresh/user installs matched92files. Only redundant tag deploy37247221231 was cancelled. Initial transient version5 response157/158 remains retained. This evidence is historical and does not verify v0.2.8. The later native report confirms partial click coverage and requires this new repair.
