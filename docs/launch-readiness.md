# Launch readiness

Complete this checklist against the exact release being announced. Follow [releasing.md](releasing.md) and run every check in [CONTRIBUTING.md](../CONTRIBUTING.md) before each commit. Marketing posts and outreach require a separate instruction from the maintainer.

Status on 2026-10-04: **v0.2.6 is a repair candidate, not a verified release.** The maintainer reports that the loaded Claude pane shows footer v0.2.5 and no part of a card responds to a mouse click, including its name. The repair must have its own immutable release; v0.2.5 cannot be moved. Checked v0.2.6 source, fixtures, full checks, source CI, server deployment, production verification/smoke, tag/release, marketplace pin/CI and official installations are all pending evidence. Historical v0.2.5 results below do not complete those gates.

Actual native v0.2.6 interaction proof is unavailable. The current computer-use selection for Claude returned captures of Chrome/Codex instead of the intended Claude window; those captures cannot establish Claude behavior. No native card click is claimed verified. The QA world remains offline.

## Product and compatibility

- [ ] Verify the repair in the exact installed v0.2.6 Claude Desktop pane: observe its version footer and click artwork, the name and the surrounding card. Each should select the same creature; Back should return to its originating view and root Close should close the pane.
- [ ] Verify navigation in the loaded release: Team, Collection, Discoveries and Community, with Profile, Market, Rankings and Trading in the shared Community section bar.
- [ ] Recheck Share profile and Manage account in the loaded release, including the current public link and account destination. Source review or SDK tests do not establish native clicks.
- [ ] Replay every supported released mod's traffic against the candidate. Record v0.2.6 before its tag and preserve all earlier released recordings unchanged.
- [ ] Verify the candidate retains API v1, minimum supported mod 0.1.0, rules 1, generator 2 and offline save format 1. Recheck frozen rules, season transitions, one-time rewards, old cards, unavailable servers and capability/version behavior.
- [ ] Recheck passkey recovery across chosen/generated username changes and browser-only sign-out with the candidate.

Claude Code requires 2.1.287 or later. Desktop needs a compatible bundled engine; updating the CLI does not update Desktop's engine. Version 0.2.3 is the complete frozen-catalog loader baseline. Server deployment cannot repair previously installed rendering or hydration code. Recorded compatibility does not promise arbitrary future families, artwork primitives or mechanics in historical mods. See [compatibility.md](compatibility.md) and [SPEC.md, section 32](../SPEC.md#32-versioning-and-backward-compatibility).

Welcome-pack farming restrictions (Backlog 3) and server-delivered content packs (Backlog 5) await the maintainer's decisions and remain untouched. Existing rewards, seasons and creatures retain their rules. The private launch promotion is a proposal only; no new reward is active.

## Browser experience and sharing

The established public website appearance remains preserved. The card-click report concerns Claude's pane; no website click repair is requested. The existing account companion keeps its compact profile and Collection/Team/Stats tabs, rankings inside Stats, whole-collection browsing and contextual card help.

- [ ] Verify candidate production health/version, public routes and previews, robots, sitemap and the private browser collection. Record v0.2.6 results separately.
- [ ] Verify the candidate's disposable production smoke: passkey registration, rename/recovery, the same account/cards/team/stats, filters and Attack sort, browser-only sign-out, deletion and revoked access.
- [ ] Match any smoke-created discovery/Mythic orphan rows to that run's recorded IDs before cleanup; remove only those verified rows.
- [ ] Recheck that account/passkey pages stay out of indexing, public fields remain documented and shared URLs contain no session tokens or passkey tickets.

Established v0.2.5 browser evidence is historical: `.dev/account-share-desktop-0.2.5.png`, `.dev/account-share-mobile-0.2.5.png` and `.dev/profile-share-public-0.2.5.png` contain local test data. Its production route verification and smoke are recorded below. These are not actual v0.2.6 Desktop interaction, release or marketing proofs. No new website appearance change is claimed.

## Repository and media

The README, requirements, install links, security/contribution/self-hosting guidance, repository description/homepage/topics and security settings were reviewed for earlier releases. Custom GitHub social-preview artwork has private uploaded-setting proof at `.dev/github-social-preview-verified.jpg`. Main history and immutable tags are protected; required PRs and main CI remain a recommendation in the direct-push workflow.

- [ ] Review candidate requirements, install links, public preview metadata and the staged diff before the checked release/handoff commits. Exclude credentials and private artifacts.
- [ ] Capture fresh Team, Collection, Community Profile, Market, Rankings and Pack screenshots from the exact loaded v0.2.6 release, including an observed release footer and independent timestamp/hash provenance.
- [ ] Review each new crop for unrelated work, sidebars, session titles, notifications, usage banners, personal data and credentials. Preserve native UI pixels and provide descriptive alt text and working links.
- [ ] Approve the actual final marketing assets in the later marketing task.

The README battle [GIF](media/desktop-duel.gif), [video](media/desktop-duel.mp4) and [still](media/desktop-duel.png) are reviewed real **v0.2.3** Desktop exports: 15 seconds of rounds 5–10, a timed Twist and a win/first-pack reward. They do not show a completed evolution or prove a later release's card clicks. Their private provenance includes source/crop hashes and decoded frames; `.dev/desktop-v0.2.3/public-duel-export.json` verifies the exports. Generated creature artwork, SVG scenes and preview art remain illustrations.

The historical v0.2.5 still helper at `.dev/desktop-v0.2.5/prepare-stills.py` is pinned to that release. No actual v0.2.6 capture, capture manifest, processing, export or version-pinned helper is claimed prepared here. Neither earlier helpers nor the wrong-window captures satisfy the native media gates.

## Release gate — v0.2.6 evidence pending

- [ ] Exact checked source SHA and pushed commit: pending.
- [ ] All required checks before source commit: pending. Require zero failures/skips, both strict validators, isolated plugin SDK tests, all HTTP end-to-end steps and a fresh site build; record Worker dry-run separately.
- [ ] Four version constants, changelog and new compatibility fixtures agree: pending.
- [ ] Source CI on that exact unchanged commit: pending.
- [ ] Server-first deployment and read-only production verification: pending.
- [ ] Disposable production smoke and restricted cleanup: pending.
- [ ] Correct immutable v0.2.6 tag and published release with sanitized notes: pending.
- [ ] Marketplace tag/exact SHA pin, all checks before its commit and pin CI: pending.
- [ ] Fresh official marketplace and actual user installs match every tagged plugin blob and pass strict validation: pending.
- [ ] Cancel only the new release's redundant tag deploy after manual deployment: pending.
- [ ] Exact loaded v0.2.6 Desktop footer and native card-click/Back/Close/Share/Manage account behavior: pending.
- [ ] Return the Desktop QA world to online after final native checks with `/spin world online`: pending.
- [ ] Final readiness/handoff commit, full pre-commit checks and its CI: pending.
- [ ] Private kit finalized against those proofs: `.dev/launch-kit-v0.2.6.md` is prepared with explicit pending gates; no marketing or campaign action is authorized.

Before any later docs/media/handoff commit, run every required check again after edits stop and verify that commit's CI. Earlier passing results do not cover future edits. Recheck destination rules and maker access immediately before the separate marketing task. Reddit destinations remain candidates, Product Hunt access/date require maker selection, and Hacker News submission text must be written personally under its stated rules.

## Historical v0.2.5 release evidence

[v0.2.5](https://github.com/416rehman/spinlings/releases/tag/v0.2.5) remains immutable at `49dacb3ddc1c6dedb7d5ba700ce47b9911aec97f`. [Source CI 37244791846](https://github.com/416rehman/spinlings/actions/runs/37244791846) passed; marketplace commit `a20310fe5a3467f2ac39af882446117d4fff26ef` pins it and [marketplace CI 37245239156](https://github.com/416rehman/spinlings/actions/runs/37245239156) passed. Both official installs matched 92 tagged files and strictly validated. Only its redundant deploy `37245055884` was cancelled.

Pre-source and pre-pin checks passed 944 Node tests with zero failures/skips, 165 isolated plugin tests with zero failures, both strict validators, 24 HTTP steps (319/320 requests), a 208,607-byte build and Worker dry-run. Its 188-exchange recording remains unchanged. Production verification passed 158 checks; its smoke used 19 mod/client requests over 14.2 seconds plus direct browser/passkey/profile checks, followed by cleanup of exactly three verified smoke-owned records. Private evidence: `.dev/codex-share-{final,pin}-0.2.5-*.log`, `.dev/codex-live-share-final-0.2.5.log`, `.dev/codex-prod-smoke-share-final-0.2.5.log`, `.dev/codex-smoke-cleanup-share-final-0.2.5.log` and `.dev/codex-install-0.2.5-{fresh,user}-*.log`.

Final v0.2.5 readiness commit `69d3ea4d6020eb4793ec4621712ca8c6eab0cafa` and CI `37245747095` passed their full checks (944 Node/165 SDK, both strict validators, 24 HTTP steps/322 requests, fresh build and dry-run). The later user report establishes a native click failure despite those harness and installation results. None of this historical evidence verifies the v0.2.6 repair.
