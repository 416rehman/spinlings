# Changelog

One entry per release (SPEC 32), newest first. Each says what changed in plain words, any compatibility impact, and any change to what the mod sends, what the server stores or what other players can see. The mod and the server share one version; the server is deployed first.

## 0.1.0 (unreleased)

The first release: Spinlings season 1, the mod and the server, live at [spinlings.dev](https://spinlings.dev).

- **Install:** one line inside Claude Code, `/plugin install spinlings --marketplace 416rehman/spinlings`, or ask Claude to install it. The game starts on its own at the next session, with no sign-up, no setting and no command to run.
- **The game:** wild encounters while Claude works, duels with other players' teams and Rivals, packs charged by presence, three evolution stages and raised forms, foil, Mythics, fusion, crafting, recycling, the Wandering Trader, trading, gifts, drops, streaks, leagues, seasons and the daily rules.
- **No daily quotas:** every finished battle pays. The server paces battle starts and pack charges and caps the bank of unopened packs, and repeat duels between the same two players stop moving rating after the first few.
- **Two worlds:** online by default (an anonymous handle and session: no email, no password, no GitHub) and an offline world that sends nothing at all. An optional passkey brings an online account to another computer.
- **Community servers:** the same server runs on Cloudflare or plain Node, and `/spin server` plays on any of them. Each server is a separate world.
- **What the mod sends, what the server keeps and what others see:** as described in PRIVACY.md at this release.
- **Compatibility:** API `/v1`, rules version 1, generator version 2. `minClient` is 0.1.0. Needs Claude Code 2.1.287 or later.
