# Security

Spinlings runs inside Claude Code with your permissions, and its server holds other people's cards and must never reveal anything about who they are or how they work. Both deserve care, so reports are very welcome.

## Reporting a vulnerability

Report privately through GitHub: **[Security → Report a vulnerability](https://github.com/416rehman/spinlings/security/advisories/new)**. Please do not open a public issue, pull request or discussion for a security or privacy problem.

A useful report says what is affected (the mod, the server, the pages, CI or the release process), how to reproduce it, and what an attacker gains. A proof of concept against a server you run yourself is ideal.

What to expect from a one-person project:

- an acknowledgement within 7 days;
- a fix, or a plan with a date, within 30 days for anything serious;
- a published advisory once a fix has shipped, with credit if you want it.

## What counts

Clearly in scope:

- **Privacy.** Anything that lets another player, a page visitor or the public learn something [PRIVACY.md](PRIVACY.md) says they cannot: a link to a real identity, timestamps, activity, battle counts, the model or arena someone used, or any field outside the documented lists. Anything that makes the server keep more than PRIVACY.md says, or keep it longer, including a way to recover an IP address.
- **The mod.** Anything that lets a server, another player or a crafted response run code, read local data, draw terminal escape sequences, make the mod contact a host other than the configured server, or leak the token. Anything that breaks the content-blind guarantee in the README.
- **The server.** Bypassing auth; acting on someone else's cards; minting or duplicating cards or sparks; races around escrow, trades, gifts or one-shot actions that a guard should have caught; getting past the pacing (the spacing between battle starts, the minimum battle length, the spacing between pack charges and the 12-pack bank), the pair limits or the proof of work; SQL injection; anything that leaks tokens, token hashes, join counters or `SECRET`.
- **Cheating beyond the documented limits.** The README's "Cheating" section lists what a modified client can and cannot do. Anything better than that is a bug.
- **The pages.** Script injection, or anything that defeats their Content-Security-Policy, including a way to run any script other than the page's own files under `/static/`, or to send a request outside the same-origin access explicitly allowed for authenticated account and passkey pages.
- **The supply chain.** The CI and deploy workflows, the release process, dependency pinning and the marketplace entry.

Out of scope: volumetric denial of service, social engineering, problems in Cloudflare or Claude Code themselves (report those to them), attacks that need an already compromised machine, the documented limits in the README's "Cheating" section, and game balance (open a normal issue for that).

## Testing safely

Please test against a server you run yourself (see [docs/self-hosting.md](docs/self-hosting.md)). Against the public server, use only your own accounts, do not degrade the game for others, and do not access other players' data beyond what you need to show the problem. Good-faith research that follows these rules will not be met with legal action.

## Supported versions

Fixes ship in the latest mod release. The public server supports every released mod from `minClient` upward, checked with each release's immutable compatibility recordings. We do not raise that minimum for new seasons or ordinary balance changes. A breaking protocol change needs a parallel API and the notice period in SPEC 32. Below the minimum, players can still read and delete their account or switch to offline play.

## How it is built to be safe

The full requirements are in [SPEC.md](SPEC.md), sections 12, 15, 16 and 20. In short:

- **The mod does almost nothing.** It uses only the `ui`, `state`, `store`, `clock`, `command`, `http` and `session` parts of the mod API (plus `audio` when sound is on), and from `session` only the model. It never touches files, processes, models, prompts, tools, agents, MCP or environment variables. It talks to one https host, does not follow redirects blindly, rejects responses over 256 KB, validates every response against its expected shape, and strips control characters and escape sequences from every string it draws.
- **No identity on the wire.** The mod never sends anything about your Claude account, organization, machine or session. The server hands out a random token and a random handle.
- **The server decides everything scarce.** Every input is checked by a strict schema: unknown fields are rejected, and bodies over 16 KB are refused. SQL uses bound parameters only. Tokens are 32 random bytes stored as SHA-256 hashes.
- **Atomic by guards.** Every handler writes one D1 batch that first re-checks, with guard statements, everything it read: row versions, owners, escrow, locks and one-shot states. A failed guard rolls back the whole batch. One-shot actions (opening a pack, finishing a battle, catching, accepting an offer, claiming a gift) cannot be replayed.
- **Minimal storage.** No IP addresses (only a daily keyed hash, kept at most 24 hours), no request logs, dates instead of times wherever a rule allows, and scheduled deletion of old battles, notices, offers and gifts, and of accounts nobody can sign in to any more.
- **Pages load only first-party scripts.** `/odds`, `/privacy` and the not-found page run none and send `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Public game pages add only `script-src 'self'` for their files under `/static/` and keep `connect-src 'none'`. `/account`, `/passkey/add` and `/passkey/signin` allow `connect-src 'self'` for account and passkey access. Private pages require authentication for private data, are marked `noindex`, and expose no account details in social previews. Every response also sends `nosniff`, `no-referrer` and `X-Frame-Options: DENY`. API responses send no CORS headers.
- **Supply chain.** Zero runtime npm dependencies. The only dev dependency, `wrangler`, is pinned exactly with a committed lockfile and installed with `npm ci --ignore-scripts` (the repository's `.npmrc` turns install scripts off for everyone else too). GitHub Actions are pinned by full commit SHA and run with read-only permissions. Every pull request runs the tests, the strict `claude plugin validate` and the mod's own tests on one pinned, hash-checked Claude Code build, and fails if any test is skipped. Pull requests get no secrets. Deploys run only from release tags on `main`: the checks run first with no secrets, and only then does a reviewer approve the job that holds them.

## Verifying a release

The marketplace entry in `.claude-plugin/marketplace.json` installs a tagged release (`ref`), never `main`. Once a release is out, the entry also pins that tag's exact commit (`sha`), so moving or recreating a tag changes nothing anyone installs, and CI fails if a released tag is not pinned to its commit. Each release note links the diff from the previous release and includes the `claude plugin validate` output, which lists every hook and every call the mod makes. To check it yourself:

```sh
git clone https://github.com/416rehman/spinlings && cd spinlings
git checkout v0.2.3            # substitute the release you are about to install
claude plugin validate plugin
```
