# Spinlings

Pixel creatures turn up while Claude works. Catch them, collect cards, build a team and meet rivals in a small game above the prompt. Open `/spin` for your team, collection, discoveries and community. Packs give one card; you choose where it belongs in your team and what price to ask on the market.

Spinlings is a Claude Code mod for Claude Code **2.1.287 or later**, including compatible Code sessions in Claude Desktop. It uses the mod interface; it does not add chat skills or a connector. The pane and the inline game work together, and `/spin quiet` hides the game when you want quiet.

## Install

```sh
claude plugin marketplace add 416rehman/spinlings
claude plugin install spinlings@spinlings
```

Start a new Claude Code session, then run `/spin`. Choose the shared online world or keep an independent collection on this computer. `/spin world` opens that choice again; `/spin world online` returns to Spinlings, `/spin world offline` uses the local world, and `/spin world <server>` reviews a community server before connecting.

Online players can trade, sell cards, challenge teams and share a public profile. Save a passkey to return to the same collection from the browser or another computer. Ordinary rarity and card finishes are separate: Alt colour changes the creature's colours, while Foil adds a rainbow frame.

## Data handling

The online world sends pseudonymous game requests to `https://spinlings.dev`: account sessions, card and pack ids, team choices, battle timing inputs and the model family for joining, pack charges and battles. It fetches game state, frozen season art, battle results and public community data. A community world sends the same game data to the server you explicitly approve. Offline play keeps its independent save on this computer and sends nothing.

Spinlings reads local session signals to animate the game. It never reads or sends conversations, tool contents, files, repository paths, Claude identity or costs. Passkeys are optional and handled on the selected world's website. [Privacy and retention](https://github.com/416rehman/spinlings/blob/main/PRIVACY.md) describes saved game data, public fields and deletion. [Source review notes](REVIEW.md) explain the bundled mod, local controls, tests and assets.

The `command.run` hook is filtered to the literal `spin` command. It reads only that player's game arguments, such as `pack`, `world` or `redeem`, and passes the event onward. It never runs a shell, process, tool, agent, MCP call or model, and never runs an instruction received from a server. Turn/session hooks read only the signals listed in the privacy policy. UI hooks draw the game and handle its own controls; they pass Claude's drawing onward without reading the composer or conversation.

The HTTP adapter calls only the chosen game world's API. Its default host is `https://spinlings.dev`; an explicitly approved community world uses the player's chosen HTTPS origin, with HTTP allowed only for loopback development. URLs cannot contain credentials. Responses are validated game data, not executable code. There are no analytics, third-party asset requests or background requests in the offline world. Local audio is synthesized WAV data, and the arena images are bundled PNG bytes.

Storage belongs to this plugin: game settings, an offline save, cached game appearances, and separate game sessions for each chosen world. The session credential is created by the game server; it is not taken from Claude, the user's environment or another application's files. Online requests use that world's own session, never the offline save or another world's session. The mod has no filesystem, environment, process, tool, model or MCP capability.

Game responses pass strict schema checks. The record validator uses `Object.getPrototypeOf` only to compare an input's prototype with `Object.prototype` and `null`, rejecting class instances and custom-prototype records. It does not mutate prototypes or traverse to constructors. The manifest's [supported `types` field](https://code.claude.com/docs/en/plugins/mods/interface#point-the-manifest-at-the-declaration) declares all 13 plugin-owned state keys for strict validation; it grants no extra capability.

Rendering identifiers are not credentials or destinations. `tokens.ts` contains colours and spacing, UI keys identify controls, and `http://www.w3.org/2000/svg` is the standard SVG namespace. The frozen naming generator's vocabulary and tokenization use ordinary words, not machine secrets. The frozen catalogue fetches validated season data through the same game-world adapter; it does not obtain a credential from that generator.

[Play and browse](https://spinlings.dev) · [Game guide](https://github.com/416rehman/spinlings/blob/main/docs/how-to-play.md) · [Privacy policy](https://spinlings.dev/privacy) · [Privacy details](https://github.com/416rehman/spinlings/blob/main/PRIVACY.md) · [Support](https://github.com/416rehman/spinlings/issues) · [Private security reports](https://github.com/416rehman/spinlings/security/advisories/new) · [Source and screenshots](https://github.com/416rehman/spinlings)

Released under the [MIT license](LICENSE). Created by [416rehman](https://github.com/416rehman).
