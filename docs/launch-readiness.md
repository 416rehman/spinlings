# Launch readiness

Complete this checklist against the release being announced. Follow [releasing.md](releasing.md) and run every check in [CONTRIBUTING.md](../CONTRIBUTING.md) before each commit. Marketing posts and outreach require a separate instruction from the maintainer.

Status on 2026-10-04: [v0.2.5 is released](https://github.com/416rehman/spinlings/releases/tag/v0.2.5) under the exact immutable tag `49dacb3ddc1c6dedb7d5ba700ce47b9911aec97f`. Server-first deployment, all 158 read-only production checks, the final disposable-account smoke and restricted cleanup, and source CI passed. Marketplace commit `a20310fe5a3467f2ac39af882446117d4fff26ef` pins that release; its complete pre-commit checks and CI passed, and fresh/existing installs match all 92 tagged files. Release publication and installation gates are complete. Actual Desktop interaction verification, clean pane captures, returning the QA world to online and later marketing asset approval remain pending.

## Product and compatibility

- [x] Four Claude tabs group the game into Team, Collection, Discoveries and Community. Profile, Market, Rankings and Trading share one Community section bar.
- [ ] Actual installed v0.2.5 opens `/spin`; clicking card artwork, the name and the surrounding card selects the same creature. Back returns to its originating view and the footer Close closes the root pane.
- [x] Claude Code requires 2.1.287 or later. Desktop needs a compatible bundled engine; updating the CLI does not update Desktop's engine.
- [x] Every supported released mod's recorded traffic passes in the source and marketplace checks against the new server. The v0.2.5 recording contains 188 exchanges; all prior released recordings remain immutable and unchanged.
- [x] Frozen rules-1 replay, generator-2 data and offline save format 1 remain supported. API v1 and the minimum supported mod, 0.1.0, are unchanged.
- [x] Tests cover season transitions, one-time rewards, old cards, unavailable servers, capability checks and the installed/server status shown by `/spin version`.
- [x] Passkeys identify the same account across chosen or generated username changes. Browser sign-out revokes only that browser session.

Version 0.2.3 is the complete frozen-catalog loader baseline. Already installed older code retains its shipped loader; a server deployment cannot repair its rendering or hydration behavior. Recorded protocol compatibility does not promise that arbitrary future families, artwork primitives or mechanics work in every historical mod. Any such addition needs explicit supported rendering and replay paths. See [compatibility.md](compatibility.md) and [SPEC.md, section 32](../SPEC.md#32-versioning-and-backward-compatibility).

Welcome-pack farming restrictions (Backlog 3) and server-delivered content packs (Backlog 5) await the maintainer's decisions and remain untouched. Existing rewards, seasons and creatures retain their rules and the compatibility bounds above. The private launch promotion is a proposal only; no new reward is active.

## Browser experience and sharing

- [x] The established public website's header, palette, type and scenery are preserved. The maintainer explicitly requested the account-page redesign: a compact profile summary and Collection, Team and Stats tabs, with rankings inside Stats.
- [x] Account tabs support arrows, Home and End. Switching preserves filters without extra requests; refresh preserves the selected tab and sign-out clears private cards and search terms.
- [x] Source review and Node/plugin tests verify the placement of Share profile in Community → Profile, while Manage account sits inside Privacy & settings and requires browser-account support. The browser account summary also offers Share profile. On spinlings.dev, sharing uses the current canonical public profile link, including after a username change, and sends no private session or collection data.
- [ ] Verify those Share profile and Manage account controls in the actual installed Desktop release, including the resulting public link and account destination. Source and harness checks do not establish native Desktop clicks.
- [x] Account cards offer whole-collection search, filters and sorting, compact combat stats, and hover, focus or tap explanations. Additional details and filters stay behind disclosures.
- [x] The account layout was visually reviewed at desktop size and 320px, including a long username, with no horizontal overflow. Cooldown guidance appears inside username editing or the edit control's tooltip; the permanent weekly/passkey reassurance is removed.
- [x] Landing-demo playback can pause, reduced motion is respected and disclosure/filter controls remain keyboard accessible.
- [x] Production routes, card/profile previews, health/version, robots, sitemap and private browser collection checks pass, 158/158: `.dev/codex-live-share-final-0.2.5.log`.
- [x] The final v0.2.5 production smoke passes: passkey registration, rename and recovery, the same cards/team/stats, filters and Attack sorting, browser-only sign-out, account deletion and revoked access. It used 19 mod/client requests over 14.2 seconds plus direct browser/passkey/profile route checks. Public Share HTML uses the renamed canonical handle without private query/session data. Exactly three records verified as belonging to that smoke were removed; real players were untouched. Private evidence: `.dev/codex-prod-smoke-share-final-0.2.5.log` and `.dev/codex-smoke-cleanup-share-final-0.2.5.log`.
- [x] Private account/passkey pages stay out of indexing. Public pages expose only documented public fields. Shared card/profile URLs contain no session token or passkey ticket.

Browser layout evidence is private and uses local test data: `.dev/account-share-desktop-0.2.5.png`, `.dev/account-share-mobile-0.2.5.png` and `.dev/profile-share-public-0.2.5.png`. These show the account and public profile layouts; they do not establish a real player's passkey sign-in, actual Desktop controls or release marketing captures. Earlier v0.2.4 account layout reviews also remain private fixture evidence.

## Repository and media

- [x] README pitch, requirements, badges, install commands, security reporting, contribution and self-hosting links describe the product accurately.
- [x] GitHub repository description, homepage and topics are set. Custom social-preview artwork is uploaded and visually verified; private proof is `.dev/github-social-preview-verified.jpg`.
- [x] Private vulnerability reporting, Dependabot security updates, secret scanning and secret push protection are enabled. Actions default to a read-only token and require actions pinned by SHA.
- [x] Active rulesets protect main history and immutable release tags. Required pull requests and CI on main remain a recommendation, not an enabled rule in the current direct-push workflow.
- [x] The README hero uses a real v0.2.3 Claude Desktop duel. The reviewed GIF/video show 15 seconds of rounds 5–10, a timed Twist and a win/first-pack reward; they do not claim a completed evolution.
- [ ] Capture fresh Team, Collection, Community Profile, Market, Rankings and Pack screenshots from the exact installed v0.2.5 release. Candidate previews and v0.2.3 panes are not relabelled as v0.2.5 captures.
- [ ] Review every new screenshot, GIF and video for unrelated work, app sidebars, session titles, notification contents, usage banners, personal data and credentials. Native UI pixels stay intact; media have descriptive alt text and working repository-relative links. New v0.2.5 captures remain pending.

The real battle files are [GIF](media/desktop-duel.gif), [video](media/desktop-duel.mp4) and [still](media/desktop-duel.png). Their private provenance records all 112 source/crop hashes and the 60 decoded clip frames; `.dev/desktop-v0.2.3/public-duel-export.json` verifies the final exports. Creature artwork, themed SVG scenes and repository preview art are illustrations and remain separate from product screenshots.

The private v0.2.5 still helper and instructions are prepared at `.dev/desktop-v0.2.5/prepare-stills.py` and `README.txt`, pinned to the exact release tag/SHA. They require an owner-observed v0.2.5 footer, source timestamps/hashes and explicit crop bounds. No new capture, manifest, processing or export has been performed; a prepared helper does not complete the media gates.

## Release gate

- [x] All required checks pass before both v0.2.5 source and marketplace commits: 944 Node tests, zero failures/skips; 165 isolated plugin tests, zero failures; both strict validators; all 24 HTTP end-to-end steps (319 requests before source, 320 before pin); a fresh site build (208,607 bytes). Worker dry-run also passes. Logs: `.dev/codex-share-final-0.2.5-*.log` and `.dev/codex-share-pin-0.2.5-*.log`.
- [x] Version constants, compatibility recordings and changelog agree. No credentials or private test artifacts enter the commit.
- [x] Push the checked source and deploy the server first; read-only production verification passes.
- [x] Finish the final production smoke and restricted cleanup; release notes are prepared with local paths stripped.
- [x] Source CI passed before the annotated immutable `v0.2.5` tag and release were published on the exact checked source, with changelog, comparison and strict validator output.
- [x] Source CI passes on `49dacb3ddc1c6dedb7d5ba700ce47b9911aec97f`: [source CI](https://github.com/416rehman/spinlings/actions/runs/37244791846).
- [x] Marketplace commit `a20310fe5a3467f2ac39af882446117d4fff26ef` pins `v0.2.5` and exact release SHA `49dacb3ddc1c6dedb7d5ba700ce47b9911aec97f`; every required check passed before its commit.
- [x] [Marketplace CI 37245239156](https://github.com/416rehman/spinlings/actions/runs/37245239156) passes on the pushed pin commit.
- [x] A fresh official marketplace install and the existing user installation match all 92 tagged v0.2.5 plugin blobs and pass strict validation. Private evidence: `.dev/codex-install-0.2.5-{fresh,user}-{marketplace,install,validate}.log`; earlier v0.2.4 logs are preserved separately.
- [x] Only the redundant new v0.2.5 tag deployment `37245055884` was cancelled after manual deployment; other runs were untouched.
- [ ] Actual Desktop verification confirms the loaded v0.2.5 footer, artwork/body/name selection, Back, root Close, Share profile and Manage account. Existing sessions may retain their previously loaded mod until restarted.
- [ ] Return the Desktop QA world to online after the final demo checks with `/spin world online`.
- [x] A private platform kit contains copy, final release links, honest asset versions and pending native evidence: `.dev/launch-kit-v0.2.5.md`. Actual Desktop screenshots and later marketing asset approval remain pending. No marketing posts, scheduled posts, submissions, accounts or outreach have been created.

Before any final readiness, media or handoff commit, run every required check again after its edits stop, then verify that commit's CI. Earlier passing source and marketplace checks do not cover later edits.

Before the later marketing task, recheck each destination's current rules and maker access. Reddit destinations are candidates until their actual rules are reviewed; Product Hunt access and launch date need the maker's selection. Hacker News prohibits generated or AI-edited submission text, so its kit contains facts for a personally written submission. These are posting preparations, not permissions to publish.

Historical v0.2.4 evidence remains available under its immutable tag `01bdb5cf75dcd6f11c0c24f229efdfaf5e310682` and marketplace commit `bfa9766e9ec5979412557d6178113df06e816e60`. Its source and marketplace CI passed; an attestation retry preserved the exact source and audit after independent verification. No dependency was omitted and no verification was disabled. Only v0.2.4's redundant tag deployment (`37242230066`) was cancelled; v0.2.5's separate cancelled deployment is recorded above.
