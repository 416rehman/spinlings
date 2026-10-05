# Source review notes

Spinlings uses Claude Code's TypeScript mod interface. Its sole registered module is `hooks/register.tsx`, loaded through `hooks/hooks.json`. It registers `/spin` and draws its own game pane and band. It does not register a model tool, MCP server, shell command, permission hook or prompt hook, and does not call a model or start a process. Source is shipped directly, without downloads, runtime dependencies or generated executable bundles.

## Local state and controls

The mod's state atoms hold game views; its plugin store holds settings, independent offline saves and pseudonymous Spinlings sessions per approved server origin. These are game credentials issued by that server, not credentials from Claude, environment variables or user files. `ui.copy` copies a player-selected game link or command, `ui.focus` focuses a visible game control, and the local card pointer module posts only a null click message. Neither pointer coordinates nor local session signals other than coarse model family enter game requests.

Audio plays the four bundled WAV chimes only when the player enables sound. SVG strings use the standard W3C namespace as an identifier; it is not a network destination. Creature parts include a curled tail, and frozen naming modules contain word lists. Those pure data modules do not run shell commands, access credentials or download code. The strict schema parser inspects game response fields and supplies compatibility defaults; it does not evaluate code.

## Network

Online game requests use the fixed default origin `https://spinlings.dev`, or an origin explicitly selected and approved through the world chooser. Secure origins are required except loopback development servers. The game API is documented in the repository's privacy policy and specification. Sessions and catalogs stay separate for each origin. Automatic background requests run on game clock callbacks; session and turn hooks do not wait for network calls. Explicit game commands and controls can wait for their requested API operation. Offline saves never enter online requests.

## Tests

Files under `tests/` run only through `claude plugin test plugin`. They provide mock engine handlers, in-memory fake servers, synthetic session strings and fixture tokens. They intentionally exercise signals, commands, failure paths and UI pointer controls to prove behavior and the privacy boundary. They are not registered game modules and their mock handlers never run in an installed game session. The repository's Node tests separately check content blindness, allowed hooks and methods, network payloads, offline isolation and historical compatibility.

See [PRIVACY.md](https://github.com/416rehman/spinlings/blob/main/PRIVACY.md) for the exact request fields, public fields, retention schedule and account deletion behavior.
