# Contributing

Thanks for wanting to help. [SPEC.md](SPEC.md) is the source of truth for every rule and number; when code and the spec disagree, fix one of them in the same change. Later sections of the spec override earlier ones, and section 20 (privacy) overrides everything.

## The rules that do not bend

A pull request that breaks one of these will not be merged, however nice it is.

1. **Privacy first** (SPEC.md section 20).
   - Nothing that identifies a player leaves their machine.
   - No work or usage data leaves it either, except the model family of a pack charge or battle.
   - Other players see only the fields listed in PRIVACY.md.
   - The server keeps the minimum and deletes on schedule, and it never logs requests.
   - A change that adds a field another player can see, a value the mod sends, or something the server stores must update PRIVACY.md and the privacy tests in the same pull request. Expect a hard look.
2. **Content-blind.** The mod reads only the signals in SPEC.md section 10. It never hooks `tool.call` or `prompt.submit`, and never reads prompt text, answers, tool data, paths, the repo or cost. A change that adds a hook, reads a new event field or uses a new `$` noun must update SPEC.md section 10, the "What Spinlings can't read" section of the README, PRIVACY.md and the lists in `test/release/allowlist.test.ts` in the same pull request.
3. **Never reward usage.** Nothing may scale with tokens, turns, tool calls, prompts, cost, context fill or turn length.
4. **Never in the way.** Hooks always call `next(e)`. No injected context, no Claude-callable tools and no model calls. The band stays hidden unless something is live, and `/spin quiet` silences everything.
5. **The server decides everything scarce.** The mod only animates. Never trust a client claim beyond the bounds in SPEC.md section 15, and keep the README's "Cheating" section true.
6. **Playable alone.** Every social feature needs a solo fallback (SPEC.md section 19).
7. **No free text and no money.** No chat, no user-written names, no purchases and no crypto.
8. **Tone.** Names, traits, moves and messages are whimsical creature-world words like Pipkin, Fogmaw, Sturdy and Moonlit. There are no programming or developer puns anywhere in game text, and no names or mechanics borrowed from other games or franchises.

## Setup

You need Node 22.18 or later (it runs TypeScript directly) and Claude Code 2.1.287 or later, which has mods.

```sh
git clone https://github.com/416rehman/spinlings && cd spinlings
npm ci --ignore-scripts
```

Always install with `--ignore-scripts`. Nothing here needs an install script, and the flag keeps a compromised package from running code on your machine. The repository's `.npmrc` sets it too, so a plain `npm install` is safe as well.

## Running it

```sh
npm run dev:server                      # the server on Node, with node:sqlite
claude --plugin-dir plugin              # Claude Code with the mod loaded from this checkout
```

The mod reloads when you save. In that session, `/spin server http://localhost:8787` points it at your local server. To run the Worker itself against a local D1 database instead, put `SECRET=<32+ random characters>` in `.dev.vars` and run `npm run dev:worker`.

## Checks

```sh
node --test "test/**/*.test.ts"   # every core, server, compat, docs and release test (npm test runs the same)
npm run test:plugin                # claude plugin test plugin
npm run validate                   # claude plugin validate --strict on the marketplace and the mod
npm run e2e                        # two players through every flow over real HTTP; add -- --d1 for local D1
```

Pass the test path as a quoted glob: `node --test test/` does not work. Test files must be named `*.test.ts`.

CI runs the tests, `validate`, `test:plugin` and a `wrangler deploy --dry-run` on every pull request, with one pinned, hash-checked Claude Code build, and fails if any test is skipped. Two kinds of test skip on a machine that lacks their tools: the real-D1 suites need wrangler's local workerd, and the validator check in `test/e2e/manifest.test.ts` needs a Claude Code with `plugin validate --json` (point `SPINLINGS_CLAUDE` at one if the `claude` on your PATH is older).

The docs are tested too: `test/docs/` fails on per-day quota wording, on a `/spin` command or hook the README leaves out, on a number the README, PRIVACY.md, SECURITY.md or `docs/how-to-play.md` quotes that no longer matches `ECONOMY` (`plugin/hooks/core/economy.ts`) or the server's limits, on a README image that is missing or has no alt text, and if the balance figures in SPEC.md section 5 drift. When you change a number, change the docs that quote it in the same pull request.

`test/compat/` replays what each supported release of the mod sent, recorded at release time by `node scripts/compat-record.ts`, against the current server. When it fails, the change would break players who have not updated yet (SPEC 32): keep what that release relies on, or put the breaking change in `/v2`. Never edit the fixtures by hand.

## Code rules

- `plugin/hooks/core/**` is pure ES2023: no Node APIs, no DOM, no `$`, no `Date.now()` (time is a parameter) and no `Math.random()` (randomness is an `Rng` parameter). The mod, the server and the tests all import it.
- Every relative import spells out its `.ts` extension, and types are imported with `import type`.
- No enums, no namespaces and no parameter properties, because Node strips types and cannot compile them.
- Every `$` call lives in `plugin/hooks/register.tsx`. Other files get plain data, element tables and callbacks.
- Requests and responses are validated by the strict schemas in `plugin/hooks/core/schemas.ts`, which both sides use.
- **Server handlers follow the D1 pattern** (SPEC.md section 16):
  1. Read what you need, including row versions.
  2. Decide in plain code.
  3. Write one batch that starts with a guard for every assumption you made, and bump the `version` of every row you change.
  4. On `Conflict`, retry from the top, up to 3 times.
  - SQL uses bound parameters only, and no handler runs more than about 20 queries.
- **Schema changes are new migrations** in `server/migrations/`, numbered `NNNN_name.sql`. Never edit one that has shipped. A migration runs before the new Worker goes live, so it must keep working with the previous release.
- Never put tokens, bodies, URLs, handles or addresses in errors or logs.
- Keep the existing terse style. Comments only where they earn their place.
- Text files use LF line endings on every platform; `.gitattributes` makes Git check them out that way even with `core.autocrlf` on.

## Dependencies

- **No runtime dependencies** in the mod, the core or the server. Write the small thing yourself; SHA-256 and the PNG encoder are already here.
- `wrangler` is the only dev dependency, pinned to an exact version. Do not add another. Upgrades go through Dependabot, which waits a week after each release before proposing it.
- If you must touch the lockfile, use `npm install --ignore-scripts --save-exact`, and explain why in the pull request.
- GitHub Actions are pinned by full commit SHA with the version in a comment, and workflows keep `permissions: contents: read`.

## Pull requests

Keep them small and focused, with tests for anything that changes behaviour. Say what you changed and why. Contributions are accepted under the [MIT license](LICENSE).

Security and privacy problems go through [SECURITY.md](SECURITY.md), not issues. Releases follow [docs/releasing.md](docs/releasing.md).
