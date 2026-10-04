# Launch readiness

Complete this checklist against the release being announced. A passing older release does not cover new changes. Follow [releasing.md](releasing.md) for the release order and [CONTRIBUTING.md](../CONTRIBUTING.md) for the checks.

Status below is for the v0.2.3 candidate on 2026-10-04. Checked items have local candidate evidence or verified repository settings; production, marketplace installation and release media still need their own verification. The candidate has not been published.

## Install and keep playing

- [ ] A fresh install from `416rehman/spinlings` resolves to the release tag and pinned commit, passes strict validation, and opens `/spin` after restart.
- [x] The README's minimum Claude Code version matches the supported engine. Desktop instructions account for its separately bundled version.
- [x] Recorded traffic from every supported released mod still works against the new server; released fixtures remain unchanged.
- [x] Missing server features stay hidden, unsupported mechanics have a safe supported path, and an unavailable server leaves Claude usable.
- [x] A season transition preserves old cards, applies rewards once, changes the rating as documented, and serves the next season's frozen species to supported older mods.
- [x] Passkeys still recover the same collection after username changes. Browser sign-out revokes only the browser session.
- [x] `/spin version` explains installed and server status, with a working update instruction when one is needed.

Compatibility covers the installed mod's supported protocol and rendering rules. New families, new artwork primitives or new battle mechanics require an explicit compatibility design; a future content idea is not covered simply because the server can send JSON. The source of truth is [SPEC.md, section 32](../SPEC.md#32-versioning-and-backward-compatibility).

## Site and sharing

- [ ] The landing page, collection, leaderboards, market, card, profile, odds and privacy links return the intended page on the production origin.
- [x] A new visitor can find the requirements and install commands, then understand their team, sparks, rating, families and daily rule.
- [x] Layouts remain usable in narrow panes and at 320px in the browser, with keyboard, hover and tap help and no obscured actions.
- [x] Demo playback can pause, reduced motion is respected, and filters and disclosure controls remain keyboard accessible.
- [x] Public pages expose only documented public fields. The collection requires authentication; shared links never contain session tokens or passkey tickets.
- [x] Titles, descriptions, canonical URLs and preview images match the actual page. Private and temporary pages stay out of indexing.
- [x] Share a card or public profile using its canonical first-party link. Card previews show that card; profile previews use the branded meadow image. Neither reveals private account data.
- [ ] Production health/version checks and the throwaway-account smoke pass, with only that smoke's disposable records cleaned up.

## Repository and media

- [x] README pitch, install commands, badges and links describe the release accurately. Badge targets lead to checks, releases, licensing or requirements.
- [ ] Repository description, homepage, topics and social preview describe Spinlings accurately. A preview file in the repository still needs verification in GitHub's Social preview setting.
- [x] Issues route ordinary feedback separately from private security reports; contribution and self-hosting instructions are easy to find.
- [ ] The hero uses a real Claude Desktop capture. Capture new Team, Collection and Community views from the release, with the app sidebar and unrelated sessions out of frame.
- [ ] Marketing screenshots and clips come from the real installed release. Generated artwork can illustrate creatures, but is not presented as a product screenshot.
- [ ] Review every image and video for unrelated work, session titles, notification contents, personal data and credentials. Keep descriptive alt text and verify media links on GitHub.
- [x] Inspect repository security settings, private vulnerability reporting and secret protection before pushing launch assets.

Existing media includes a real [Desktop duel](media/desktop-duel.gif), its [video](media/desktop-duel.mp4) and [still](media/desktop-duel.png), plus [repository preview artwork](media/github-social.png). The duel capture predates the current four-tab navigation. Fresh release captures are still needed for the launch gallery; rendering a local preview does not replace them.

## Release gate

- [x] Every required Node and plugin test passes with no failures or skips, both strict validators pass, HTTP end-to-end checks pass, and the site build is fresh. The Worker dry-run passes too.
- [x] Version constants, compatibility recordings and changelog agree. No secrets or private test artifacts enter the commit.
- [ ] Deploy the server first; then verify production, tag the exact checked commit, publish the release, and pin the marketplace to that tag and commit.
- [ ] Both release and marketplace CI runs pass. Verify a fresh install and an update of an existing installation against the tag's actual Git blobs.
- [ ] Prepare platform-specific copy and media only after this release gate. Recheck each platform's current rules before submitting. Posting and outreach require the maintainer's explicit instruction.

## Repository audit: 2026-10-04

The repository is public under MIT, with its homepage set to `https://spinlings.dev`, a concise game description and relevant creature-game, Claude Code and pixel-art topics. Issues, private vulnerability reporting and Dependabot security updates are enabled. GitHub secret scanning and secret push protection were enabled during release preparation, and both settings were confirmed enabled.

The presence of `media/github-social.png` confirms the asset exists; its upload as GitHub's social preview has not been verified. Fresh Claude Desktop captures of the release remain unchecked above.

Actions use a read-only default token and require actions pinned by SHA. Active rulesets protect the history of the default branch and make release tags immutable. Requiring pull requests and passing CI on the default branch remains a one-time setup recommendation in releasing.md; it is not enabled in the current direct-push release workflow.

Welcome-pack trading restrictions (Backlog 3) and server-delivered content packs (Backlog 5) remain decisions for the maintainer. Neither has been implemented in this candidate. Existing v1 seasons and creatures remain supported within the bounds in [compatibility.md](compatibility.md).

Candidate checks: 897 Node tests passed with zero failures or skips; 159 Claude plugin tests passed with zero failures. Both strict validators, all 24 HTTP end-to-end steps, the site build and the Worker dry-run passed. The plugin suite ran separately from the heavy Node suite. The minimum supported mod remains 0.1.0; API v1, rules 1, generator 2 and offline save format 1 are unchanged.
