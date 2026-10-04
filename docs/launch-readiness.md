# Launch readiness

Complete this checklist against the release being announced. Follow [releasing.md](releasing.md) and run every check in [CONTRIBUTING.md](../CONTRIBUTING.md) before each commit. Marketing posts and outreach require a separate instruction from the maintainer.

v0.2.4 is released and live on 2026-10-04. Its tag points to `01bdb5cf75dcd6f11c0c24f229efdfaf5e310682`; marketplace commit `bfa9766e9ec5979412557d6178113df06e816e60` pins that exact tag and commit. Release and marketplace CI passed, and fresh and existing installs match all 92 tagged plugin files. The remaining launch gate is actual Desktop interaction verification and fresh v0.2.4 pane captures; those unchecked items must be completed before marketing.

## Product and compatibility

- [x] Four Claude tabs group the game into Team, Collection, Discoveries and Community. Profile, Market, Rankings and Trading share one Community section bar.
- [ ] Actual installed v0.2.4 opens `/spin`; clicking card artwork, the name and the surrounding card selects the same creature. Back returns to its originating view and the footer Close closes the root pane.
- [x] Claude Code requires 2.1.287 or later. Desktop needs a compatible bundled engine; updating the CLI does not update Desktop's engine.
- [x] Every supported released mod's recorded traffic passes against the final server. Released recordings remain unchanged; the v0.2.4 recording contains 188 exchanges.
- [x] Frozen rules-1 replay, generator-2 data and offline save format 1 remain supported. API v1 and the minimum supported mod, 0.1.0, are unchanged.
- [x] Tests cover season transitions, one-time rewards, old cards, unavailable servers, capability checks and the installed/server status shown by `/spin version`.
- [x] Passkeys identify the same account across chosen or generated username changes. Browser sign-out revokes only that browser session.

Version 0.2.3 is the complete frozen-catalog loader baseline. Already installed older code retains its shipped loader; a server deployment cannot repair its rendering or hydration behavior. Recorded protocol compatibility does not promise that arbitrary future families, artwork primitives or mechanics work in every historical mod. Any such addition needs explicit supported rendering and replay paths. See [compatibility.md](compatibility.md) and [SPEC.md, section 32](../SPEC.md#32-versioning-and-backward-compatibility).

Welcome-pack farming restrictions (Backlog 3) and server-delivered content packs (Backlog 5) await the maintainer's decisions. Neither is implemented by this release. Existing seasons and creatures retain the compatibility bounds above.

## Browser experience and sharing

- [x] The established public website's header, palette, type and scenery are preserved. The maintainer explicitly requested the account-page redesign: a compact profile summary and Collection, Team and Stats tabs, with rankings inside Stats.
- [x] Account tabs support arrows, Home and End. Switching preserves filters without extra requests; refresh preserves the selected tab and sign-out clears private cards and search terms.
- [x] Account cards offer whole-collection search, filters and sorting, compact combat stats, and hover, focus or tap explanations. Additional details and filters stay behind disclosures.
- [x] The account layout was visually reviewed at desktop size and 320px, including a long username, with no horizontal overflow. Cooldown guidance appears inside username editing or the edit control's tooltip; the permanent weekly/passkey reassurance is removed.
- [x] Landing-demo playback can pause, reduced motion is respected and disclosure/filter controls remain keyboard accessible.
- [x] Final production routes, card/profile previews, health/version, robots, sitemap and private browser collection checks pass: `.dev/codex-live-ui-final-0.2.4.log`.
- [x] The final production smoke proves passkey registration, rename and recovery, the same cards/team/stats, filters and Attack sorting, browser-only sign-out, account deletion and revoked access: `.dev/codex-prod-smoke-ui-final-0.2.4.log`. Exactly five discovery records verified as belonging to that smoke were removed.
- [x] Private account/passkey pages stay out of indexing. Public pages expose only documented public fields. Shared card/profile URLs contain no session token or passkey ticket.

Browser layout evidence is private: `.dev/account-desktop-0.2.4.png` and `.dev/account-mobile-0.2.4.png` show a local test collection. They establish layout review, not a real player's passkey sign-in or installed Desktop release.

## Repository and media

- [x] README pitch, requirements, badges, install commands, security reporting, contribution and self-hosting links describe the product accurately.
- [x] GitHub repository description, homepage and topics are set. Custom social-preview artwork is uploaded and visually verified; private proof is `.dev/github-social-preview-verified.jpg`.
- [x] Private vulnerability reporting, Dependabot security updates, secret scanning and secret push protection are enabled. Actions default to a read-only token and require actions pinned by SHA.
- [x] Active rulesets protect main history and immutable release tags. Required pull requests and CI on main remain a recommendation, not an enabled rule in the current direct-push workflow.
- [x] The README hero uses a real v0.2.3 Claude Desktop duel. The reviewed GIF/video show 15 seconds of rounds 5–10, a timed Twist and a win/first-pack reward; they do not claim a completed evolution.
- [ ] Capture fresh Team, Collection, Community Profile, Market, Rankings and Pack screenshots from the exact installed v0.2.4 release. Candidate previews and v0.2.3 panes are not relabelled as v0.2.4 captures.
- [ ] Review every new screenshot, GIF and video for unrelated work, app sidebars, session titles, notification contents, usage banners, personal data and credentials. Native UI pixels stay intact; media have descriptive alt text and working repository-relative links. New v0.2.4 captures remain pending.

The real battle files are [GIF](media/desktop-duel.gif), [video](media/desktop-duel.mp4) and [still](media/desktop-duel.png). Their private provenance records all 112 source/crop hashes and the 60 decoded clip frames; `.dev/desktop-v0.2.3/public-duel-export.json` verifies the final exports. Creature artwork, themed SVG scenes and repository preview art are illustrations and remain separate from product screenshots.

## Release gate

- [x] Final source passes all required checks: 920 Node tests, zero failures/skips; 165 plugin tests, zero failures; both strict validators; all 24 HTTP end-to-end steps; a fresh site build. Worker dry-run also passes. Logs: `.dev/codex-ui-final-0.2.4-*.log`, `.dev/codex-ui-pin-0.2.4-*.log` and `.dev/codex-ui-handoff-0.2.4-*.log`.
- [x] Version constants, compatibility recordings and changelog agree. No credentials or private test artifacts enter the commit.
- [x] Push the checked source, deploy the server first, complete final production verification and restricted smoke cleanup, then tag the exact checked commit as `v0.2.4` and publish its changelog, comparison and strict validator output.
- [x] Release CI passes on `01bdb5cf75dcd6f11c0c24f229efdfaf5e310682`: [release CI](https://github.com/416rehman/spinlings/actions/runs/37241771442).
- [x] Marketplace source pins `v0.2.4` and `01bdb5cf75dcd6f11c0c24f229efdfaf5e310682`; all checks pass before its commit and [marketplace CI](https://github.com/416rehman/spinlings/actions/runs/37242460139) passes.
- [x] A fresh install and the existing user installation match all 92 tagged plugin blobs and pass strict validation. Private evidence is `.dev/codex-install-{fresh,user}-{marketplace,install,validate}.log`; installation metadata and release bytes agree.
- [ ] Actual Desktop verification confirms the loaded v0.2.4 footer, artwork/body/name selection, Back and root Close. Existing sessions may retain their previously loaded mod until restarted.
- [ ] Return the Desktop QA world to online after the final demo checks with `/spin world online`.
- [x] A private platform kit contains final release links, copy and honest asset versions: `.dev/launch-kit-v0.2.4.md`. Native screenshots remain pending as stated above. No marketing posts, scheduled posts, submissions, accounts or outreach have been created.

Before the later marketing task, recheck each destination's current rules and maker access. Reddit destinations are candidates until their actual rules are reviewed; Product Hunt access and launch date need the maker's selection. Hacker News prohibits generated or AI-edited submission text, so its kit contains facts for a personally written submission. These are posting preparations, not permissions to publish.

The candidate CI audit initially rejected one optional Linux package attestation. Current registry integrity and both attestations independently verified with the exact CI npm tooling and fresh caches; the failed job then passed on the same source commit with the audit unchanged. No dependency was omitted and no verification was disabled. Only this release's redundant tag deployment (`37242230066`) was cancelled after the manual server deploy.
