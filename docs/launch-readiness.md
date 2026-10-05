# Launch readiness

Complete this checklist against the exact release being announced. Follow [releasing.md](releasing.md) and run every check in [CONTRIBUTING.md](../CONTRIBUTING.md) before each commit. Marketing posts and outreach require a separate instruction from the maintainer.

Status on 2026-10-04: **v0.2.6 is published and both official installations are verified; native interaction checks remain pending.** The immutable release is exact checked source `63dbf882db1bba098b9f40f98452d587562fe350`. Source CI, server-first deployment, final production verification/smoke, tag/release, marketplace pin/CI and fresh/user file verification are complete. Final readiness commit Check/CI proof belongs in the private handoff after completion. The maintainer's earlier report was footer v0.2.5 with no card part responding to a mouse click, including its name; v0.2.5 remains immutable. No historical result is substituted for v0.2.6 evidence.

Actual native v0.2.6 interaction proof is unavailable. The current computer-use selection for Claude returned captures of Chrome/Codex instead of the intended Claude window; those captures cannot establish Claude behavior. The maintainer has been asked to restart Claude, observe footer v0.2.6 and test the artwork and name; the answer is pending. That answer alone cannot verify metadata/body, Back, Close, Share or Manage account. No native card click is claimed verified. The QA world remains offline.

## Product and compatibility

- [ ] Observe footer v0.2.6 in the actual Claude Desktop pane after restarting the verified installation.
- [ ] Verify artwork and name clicks in that loaded pane: each selects the same creature. The maintainer's answer is pending.
- [ ] Verify card metadata and surrounding body clicks separately; artwork/name confirmation does not complete this check.
- [ ] Verify Back returns to the originating view and root Close closes the pane.
- [ ] Verify navigation in the loaded release: Team, Collection, Discoveries and Community, with Profile, Market, Rankings and Trading in the shared Community section bar.
- [ ] Recheck Share profile and Manage account in the loaded release, including the current public link and account destination. Source review or SDK tests do not establish native clicks.
- [x] Replay supported released mod traffic in the required HTTP checks. The new v0.2.6 recording contains 188 exchanges and all earlier released recordings remain unchanged.
- [x] Verify API v1, minimum supported mod 0.1.0, rules 1, generator 2 and offline save format 1. The 960 passing Node tests cover historical engines, frozen rules, season transitions, isolation, one-time rewards, old cards, unavailable servers and capability/version behavior; production version verification agrees.
- [x] Recheck passkey registration, rename/recovery and browser-only sign-out in the disposable v0.2.6 production smoke.

Claude Code requires 2.1.287 or later. Desktop needs a compatible bundled engine; updating the CLI does not update Desktop's engine. Version 0.2.3 is the complete frozen-catalog loader baseline. Server deployment cannot repair previously installed rendering or hydration code. Recorded compatibility does not promise arbitrary future families, artwork primitives or mechanics in historical mods. See [compatibility.md](compatibility.md) and [SPEC.md, section 32](../SPEC.md#32-versioning-and-backward-compatibility).

Welcome-pack farming restrictions (Backlog 3) and server-delivered content packs (Backlog 5) await the maintainer's decisions and remain untouched. Existing rewards, seasons and creatures retain their rules. The private launch promotion is a proposal only; no new reward is active.

## Browser experience and sharing

The established public website appearance remains preserved. The card-click report concerns Claude's pane; no website click repair is requested. The existing account companion keeps its compact profile and Collection/Team/Stats tabs, rankings inside Stats, whole-collection browsing and contextual card help.

- [x] Verify production health/version, public routes and previews, robots, sitemap and the private browser collection: final v0.2.6 verification passed 158/158.
- [x] Verify the disposable production smoke: passkey registration, rename/recovery, the same account/cards/team/stats, filters and Attack sort, browser-only sign-out, deletion and revoked access. It passed 19 mod/client requests over 10.5 seconds plus direct browser flows.
- [x] Match smoke-created orphan rows to the run's recorded IDs before cleanup: exactly two verified smoke-owned discovery records were removed.
- [x] Recheck private-page indexing restrictions and shared-link privacy through the production verification and smoke; shared URLs expose no session token or passkey ticket.

Established v0.2.5 browser evidence is historical: `.dev/account-share-desktop-0.2.5.png`, `.dev/account-share-mobile-0.2.5.png` and `.dev/profile-share-public-0.2.5.png` contain local test data. Its production route verification and smoke are recorded below. These are not actual v0.2.6 Desktop interaction, release or marketing proofs. No new website appearance change is claimed.

## Repository and media

The README, requirements, install links, security/contribution/self-hosting guidance, repository description/homepage/topics and security settings were reviewed for earlier releases. Custom GitHub social-preview artwork has private uploaded-setting proof at `.dev/github-social-preview-verified.jpg`. Main history and immutable tags are protected; required PRs and main CI remain a recommendation in the direct-push workflow.

- [x] Review requirements, install links, public preview metadata and the staged source/pin diff. Documentation/release tests and the staged credential/private-artifact audit passed. Review any later handoff diff again before its checked commit.
- [ ] Capture fresh Team, Collection, Community Profile, Market, Rankings and Pack screenshots from the exact loaded v0.2.6 release, including an observed release footer and independent timestamp/hash provenance.
- [ ] Review each new crop for unrelated work, sidebars, session titles, notifications, usage banners, personal data and credentials. Preserve native UI pixels and provide descriptive alt text and working links.
- [ ] Approve the actual final marketing assets in the later marketing task.

The README battle [GIF](media/desktop-duel.gif), [video](media/desktop-duel.mp4) and [still](media/desktop-duel.png) are reviewed real **v0.2.3** Desktop exports: 15 seconds of rounds 5–10, a timed Twist and a win/first-pack reward. They do not show a completed evolution or prove a later release's card clicks. Their private provenance includes source/crop hashes and decoded frames; `.dev/desktop-v0.2.3/public-duel-export.json` verifies the exports. Generated creature artwork, SVG scenes and preview art remain illustrations.

The private v0.2.6 still helper `.dev/desktop-v0.2.6/prepare-stills.py` and `README.txt` are prepared for exact source `63dbf882db1bba098b9f40f98452d587562fe350`; earlier helpers remain unchanged. This is preparation only: no actual v0.2.6 capture, capture manifest, image processing or export exists. Neither helpers nor the wrong-window captures satisfy the native media gates.

## Release gate — v0.2.6

- [x] Exact checked, committed and pushed source: `63dbf882db1bba098b9f40f98452d587562fe350`; the repair was audited across eight source files.
- [x] All required checks before source commit: 960 Node tests with zero failures/skips, 169 isolated SDK tests with zero failures, both strict validators, 24 HTTP steps/321 requests, a 208,607-byte build and Worker dry-run. Private logs: `.dev/codex-card-final-0.2.6-*.log`.
- [x] Four version constants agree at v0.2.6; the changelog and new 188-exchange recording accompany the checked source, and earlier released fixtures remain unchanged.
- [x] [Source CI 37246942498](https://github.com/416rehman/spinlings/actions/runs/37246942498) passed on that exact source.
- [x] Manual server-first deployment and final read-only production verification passed 158/158. The initial transient v0.2.5 response passed 157/158 and remains recorded at `.dev/codex-live-card-first-0.2.6.log`; subsequent ordinary and fresh-key reads returned v0.2.6 at `.dev/codex-live-card-final-0.2.6.log`.
- [x] Disposable production smoke and restricted cleanup passed: 19 mod/client requests/10.5 seconds plus browser flows, and exactly two verified smoke-owned discovery records cleaned. Logs: `.dev/codex-prod-smoke-card-final-0.2.6.log` and `.dev/codex-smoke-cleanup-card-final-0.2.6.log`.
- [x] Immutable [v0.2.6 tag/release](https://github.com/416rehman/spinlings/releases/tag/v0.2.6) published at the exact source SHA with sanitized notes.
- [x] Marketplace commit `5137dc56db96dc7bff97fafa0a99c6f6d878923c` pins that exact tag/SHA. Every pre-pin Check passed: 960 Node/zero failures or skips, 169 isolated SDK/zero failures, both strict validators, 24 HTTP steps/320 requests, a 208,607-byte build and Worker dry-run. Logs: `.dev/codex-card-pin-0.2.6-*.log`.
- [x] [Marketplace CI 37247410081](https://github.com/416rehman/spinlings/actions/runs/37247410081) passed on exact pin commit `5137dc56db96dc7bff97fafa0a99c6f6d878923c`.
- [x] Fresh official marketplace and actual user installs both match all 92 tagged plugin files and pass strict validation. Logs: `.dev/codex-install-0.2.6-{fresh,user}-{marketplace,install,validate}.log`.
- [x] Only the redundant v0.2.6 tag deploy `37247221231` is confirmed completed/cancelled after manual deployment.
- [ ] Actual loaded v0.2.6 Desktop footer: pending after restart.
- [ ] Native artwork and name clicks: pending maintainer reply.
- [ ] Native metadata/body clicks: pending independent verification.
- [ ] Native Back and root Close: pending independent verification.
- [ ] Native Share profile and Manage account: pending independent verification.
- [ ] Return the Desktop QA world to online after final native checks with `/spin world online`: pending.
- [ ] Private kit finalized against all remaining proofs: `.dev/launch-kit-v0.2.6.md` records the completed release evidence and explicit pending gates; no marketing or campaign action is authorized.

The final readiness commit's SHA, full pre-commit Check results and CI proof are recorded in the private handoff after completion. This tracked document does not claim evidence for its own future commit.

Before any later docs/media/handoff commit, run every required check again after edits stop and verify that commit's CI. Earlier passing results do not cover future edits. Recheck destination rules and maker access immediately before the separate marketing task. Reddit destinations remain candidates, Product Hunt access/date require maker selection, and Hacker News submission text must be written personally under its stated rules.

## Historical v0.2.5 release evidence

[v0.2.5](https://github.com/416rehman/spinlings/releases/tag/v0.2.5) remains immutable at `49dacb3ddc1c6dedb7d5ba700ce47b9911aec97f`. [Source CI 37244791846](https://github.com/416rehman/spinlings/actions/runs/37244791846) passed; marketplace commit `a20310fe5a3467f2ac39af882446117d4fff26ef` pins it and [marketplace CI 37245239156](https://github.com/416rehman/spinlings/actions/runs/37245239156) passed. Both official installs matched 92 tagged files and strictly validated. Only its redundant deploy `37245055884` was cancelled.

Pre-source and pre-pin checks passed 944 Node tests with zero failures/skips, 165 isolated plugin tests with zero failures, both strict validators, 24 HTTP steps (319/320 requests), a 208,607-byte build and Worker dry-run. Its 188-exchange recording remains unchanged. Production verification passed 158 checks; its smoke used 19 mod/client requests over 14.2 seconds plus direct browser/passkey/profile checks, followed by cleanup of exactly three verified smoke-owned records. Private evidence: `.dev/codex-share-{final,pin}-0.2.5-*.log`, `.dev/codex-live-share-final-0.2.5.log`, `.dev/codex-prod-smoke-share-final-0.2.5.log`, `.dev/codex-smoke-cleanup-share-final-0.2.5.log` and `.dev/codex-install-0.2.5-{fresh,user}-*.log`.

Final v0.2.5 readiness commit `69d3ea4d6020eb4793ec4621712ca8c6eab0cafa` and CI `37245747095` passed their full checks (944 Node/165 SDK, both strict validators, 24 HTTP steps/322 requests, fresh build and dry-run). The later user report establishes a native click failure despite those harness and installation results. None of this historical evidence verifies the v0.2.6 repair.
