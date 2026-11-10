# Releasing

A release is a `vX.Y.Z` tag on `main`. The server always goes out before the mod (SPEC 32), and the marketplace pins the tag's exact commit. Complete [launch-readiness.md](launch-readiness.md) against the candidate before announcing it.

The current production setup uses a manual server deployment before tagging. The tag workflow remains available but requires approval and environment credentials; after a manual deployment, cancel only that release's redundant deploy run. Leave unrelated runs and the workflow configuration alone unless the maintainer asks to change them.

## One-time setup

### GitHub

Do these once, in the settings for `416rehman/spinlings`:

- **Security:** turn on private vulnerability reporting (SECURITY.md links to it), Dependabot alerts, Dependabot security updates, secret scanning and secret push protection.
- **Actions:** set the default workflow token to read-only, require approval for workflows from first-time contributors, and require actions to be pinned to a full-length commit SHA.
- **`main`:** a ruleset that requires a pull request and passing `ci / test` and `ci / plugin` checks, and blocks force-pushes and deletion.
- **Tags:** a ruleset on `v*` that only maintainers can create, and that blocks updates and deletion, so a release tag can never move.
- **Environment `production`:**
  - a required reviewer;
  - deployments limited to tags matching `v*`;
  - two environment secrets (not repository secrets), so pull requests and other workflows never see them: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the account the Worker and database live in).

### The deploy token

Create `CLOUDFLARE_API_TOKEN` as a **custom token**, not from a template. The "Edit Cloudflare Workers" template also grants Workers Tail (live request logs, which would defeat PRIVACY.md's promise of no request logs), KV, R2 and routes on every zone. Give it exactly:

| Scope | Permission | Why |
|---|---|---|
| Account (this one account only) | Workers Scripts: Edit | `wrangler deploy` |
| Account (this one account only) | D1: Edit | `wrangler d1 migrations apply --remote` |
| Account (this one account only) | Account Settings: Read | only if wrangler says it needs it to read the account |
| Zone: `spinlings.dev` only | Workers Routes: Edit | attaching the custom domain on deploy; leave it out if you attach the domain once by hand (below) |

Leave out Workers Tail, Workers Observability, Logs, KV, R2, Pages and every other zone. Set an expiry (a year at most), note the date here when you rotate it, and rotate it at once if a maintainer leaves or the token may have leaked.

The production credentials already exist. Record the next rotation date here; do not infer a rotation date from a successful deploy or print credentials while checking them.

### Cloudflare

Done once by hand, never from CI:

- The D1 database `spinlings` exists, and its id is in `wrangler.jsonc`.
- `SECRET` is set on the Worker, with at least 32 random characters:

  ```sh
  node -e "console.log(crypto.randomBytes(32).toString('base64url'))" | npx wrangler secret put SECRET
  ```

  Rotating it is harmless: it only keys the join counters, which last 24 hours.
- Workers observability, Logpush and Tail Workers stay off (PRIVACY.md promises no request logs). Check the dashboard after any change to `wrangler.jsonc`.
- **One origin.** `https://spinlings.dev` serves the Worker as a custom domain, and `wrangler.jsonc` keeps `"workers_dev": false` and `"preview_urls": false`, so there is exactly one origin (SPEC 31). The domain is final: passkeys are bound to it forever, so never move it. If the token has no zone permission and the domain ever needs attaching again, do it once in the dashboard: Workers, then spinlings, then Settings, then Domains & Routes.

## Cutting a release

1. **Bump the version and write the changelog.** In a pull request:
   - set `version` in `plugin/.claude-plugin/plugin.json` to `X.Y.Z`, and the same in `CLIENT_VERSION` (`plugin/hooks/client/remote.ts`) and `SERVER_VERSION` (`server/src/routes/account.ts`); tests fail until the three agree, and `LATEST_CLIENT` equals the marketplace pin. Claude Code caches installs by version, so every release needs a new one;
   - leave `LATEST_CLIENT` (`server/src/routes/account.ts`) at the previous release. It always equals the marketplace pin's `ref` without its `v` (SPEC 32), so the server never announces, and `/whats-new` never lists, a release the marketplace does not serve yet. It moves with the pin in step 6;
   - raise `MIN_CLIENT` (`server/src/app.ts`) only for a justified incompatibility or security fix; new seasons and ordinary balance changes do not justify it. It never goes above `LATEST_CLIENT`, since a player below it must be able to get the release it needs;
   - add the release to `CHANGELOG.md`, including any compatibility impact and any change to what the mod sends, what the server stores or what other players can see (PRIVACY.md must already say so);
   - write the release's `RELEASES` entry at the top of `plugin/hooks/core/releases.ts`, dated as its CHANGELOG heading: 1 to 4 highlights in a player's words, the most important first, each a short label of at most 24 characters and one sentence of at most 120. They become the `/spin updates` notes, the band's chips after an update and the release's lamp on `/whats-new`; the changelog stays technical. Tests tie every entry to its heading;
   - record the new mod's requests and responses with `node scripts/compat-record.ts`. It plays the mod against a server in the same process (no network) and writes `test/compat/fixtures/X.Y.Z/`: one file per flow, and a frozen copy of the mod's response reader. `test/compat/replay.test.ts` replays every version's fixtures against the current server, so later servers prove they still serve it (SPEC 32), and it fails until the new version has its own. A released version's fixtures never change: `--force` records again only before the tag, and only as the last change to `plugin/hooks/core/schemas.ts` before it, so the frozen reader is the one players install. Re-record after any later schema edit. Delete a version's folder only when `MIN_CLIENT` rises above it.

   Merge it once CI passes.

2. **Check the release commit** on an up-to-date `main`:

   ```sh
   npm ci --ignore-scripts
   node --test "test/**/*.test.ts"
   npm run test:plugin
   npm run validate
   npm run e2e
   node server/static/build.ts
   npx wrangler deploy --dry-run
   ```

   Every required check must pass before each commit, including the later marketplace commit, with no failures or skips. Keep the strict validator output for the release note and strip local paths. `npm run e2e` plays two players through every flow over real HTTP; `npm run e2e -- --d1` does the same on a local D1. Run the plugin SDK suite by itself if concurrent suites exceed its hook clock budget; a timeout is not a pass.

   The SDK command stages the exact installable plugin with repository-only `test/plugin/*.sdk.ts` suites. It verifies unchanged runtime bytes and requires every suite to execute with zero failures or skips; a bare `claude plugin test plugin` would find no shipped tests and is not a release check.

   Inspect the compatibility results, including historical rules and generator hashes, multiple server catalogs, more than eight referenced seasons, future battle labels, below-minimum read access, and season rewards paid exactly once. Released fixtures, frozen engines and frozen generators are immutable. Register a new rules engine before raising `RULES_VERSION`; keep the old engine while its battles may exist. A new generator must preserve saved offline generator versions. Read [compatibility.md](compatibility.md) before adding content.

   Check the staged diff for secrets, private smoke records and local artifacts. Verify requirements, install links, release media and public preview metadata. Existing footage must not be passed off as a capture of new screens.

3. **Deploy and smoke test the server first,** from the release commit merged in step 1. For the current manual setup, load credentials without printing them, apply only new migrations, and deploy:

   ```sh
   npx wrangler d1 migrations apply spinlings --remote   # only when a new migration exists
   npx wrangler deploy
   ```

   Confirm `/v1/health` and `/v1/version` (its `server` is `X.Y.Z`; `latestClient` and the first of its `notes` still name the previous release, as expected, until step 6b), public pages, canonical and social previews, the stable preview PNG, `/robots.txt` and `/sitemap.xml`. Cloudflare may prepend managed robots rules; verify the final response still contains the sitemap directive. Run the production throwaway-account smoke, including passkey registration, username change, fresh sign-in to the same collection and browser-only sign-out. Delete that disposable account. Remove null-owner discovery records only after proving each record belongs to this smoke; never sweep all such records when real players exist.

4. **Tag the exact checked release commit and push the tag:**

   ```sh
   git rev-parse HEAD
   git tag -a vX.Y.Z -m vX.Y.Z   # use -s instead if a signing key is configured
   git rev-parse 'vX.Y.Z^{commit}'
   git push origin vX.Y.Z
   ```

   Verify those commit IDs agree before pushing; published tags cannot move. The tag goes out before the marketplace commit, whose CI looks the tag up. When the automated production environment is configured, the `deploy` workflow:
   - in `verify`, with no secrets and no approval needed: checks that the tag is on `main` and matches the plugin version, runs every test (none may skip), validates the mod and runs its tests, and builds the Worker;
   - in `deploy`, only after `verify` passes: waits for approval in `production`, runs `wrangler d1 migrations apply spinlings --remote`, then `wrangler deploy`;
   - checks that `https://spinlings.dev/v1/health` answers and `/v1/version` reports `X.Y.Z`. A missing `SECRET` answers 503 everywhere, so a deploy without it fails here instead of going green.

   Migrations run while the previous Worker is still serving, and the new server must keep working with the previous release of the mod, because players update when they choose to. So a migration may add tables, columns and indexes, but must not drop or rename anything the live Worker still uses. Remove old things in a later release.

5. **Cancel the tag's deploy run.** Pushing the tag starts the `deploy` workflow, and step 3 already deployed this tree, so cancel that run once it waits for approval. Never approve it after step 6b: it would deploy the tag's tree, whose `LATEST_CLIENT` still names the previous release, and the server would quietly stop announcing this one on `/v1/version` and `/whats-new`.

6. **Point the marketplace at the release, and announce it.** In one commit, set the plugin entry's `source` in `.claude-plugin/marketplace.json` to the new tag and its commit, and `LATEST_CLIENT` (`server/src/routes/account.ts`) to `X.Y.Z`:

   ```json
   "source": {
     "source": "git-subdir",
     "url": "https://github.com/416rehman/spinlings.git",
     "path": "plugin",
     "ref": "vX.Y.Z",
     "sha": "<output of: git rev-parse vX.Y.Z^{commit}>"
   }
   ```

   Run every required check before committing (tests fail unless `LATEST_CLIENT` equals the pin). Like every change to `main`, it goes in through a pull request (the ruleset requires one); merge it once CI passes. Verify a fresh install and an update of an existing installation against the release's actual Git blobs, and strictly validate the installed copy. Players who update by hand run:

   ```sh
   claude plugin update spinlings@spinlings
   ```

   It refreshes the marketplace first, so a separate marketplace update adds nothing. Inside a terminal session the same is `/plugin`, then Installed, Spinlings, Update now; closing the menu reloads the plugins. In Claude Desktop's Code tab, `/plugin` opens Desktop's own plugins page: Spinlings' page has an Update button (its tooltip reads Update to X.Y.Z), and Desktop reloads the plugins in its sessions by itself once Claude is idle. `/spin updates` shows each surface its own steps.

   Players who pressed Turn it on in `/spin updates`, or enabled auto-update for the Spinlings marketplace in the terminal's `/plugin` → Marketplaces, get the release a few minutes after the next time Claude Code starts. Third-party marketplaces default to manual updates; `marketplace.json` cannot force that setting, and the mod changes it only on the player's press. Keep supported older mods playable regardless.

6b. **Deploy the server again from the pin commit,** so it announces the release. From the merged pin commit on an up-to-date `main`, load credentials without printing them; there are no migrations to apply:

   ```sh
   npx wrangler deploy
   ```

   The `production` environment deploys only `v*` tags, so this deploy is a manual one. Then check that `https://spinlings.dev/v1/version` reports `latestClient` `X.Y.Z` and that `notes[0].version` is `X.Y.Z`, and that `https://spinlings.dev/whats-new` lists `X.Y.Z` first (`id="vX.Y.Z"`). Installed mods learn of it at their next daily check; the answer may be cached for up to an hour.

7. **Write the GitHub release** for the tag, now that the marketplace serves it. The note must have:
   - the `CHANGELOG.md` entry, in plain words;
   - the diff: `https://github.com/416rehman/spinlings/compare/vPREV...vX.Y.Z`;
   - the strict validator output from step 2, in a code block, so anyone can see the hooks and calls of the release.

8. **Finish the handoff.** Record the release commit, tag, marketplace pin, live version, checks, smoke cleanup and remaining launch gates. Posting on X, Reddit, Product Hunt, Hacker News or elsewhere is a separate maintainer instruction; a release never authorizes marketing posts automatically.

## If something goes wrong

- **A bad Worker deploy:** run `npx wrangler rollback` to go back to the previous Worker version, or re-run the `deploy` workflow for the previous tag. Rolling back the Worker does not undo migrations, which is why they must stay compatible with the previous release. A Worker rolled back to a tag's tree, or to the version before step 6b, announces the release before that tag; once the bad deploy is fixed, deploy again from the current pin commit on `main` (`npx wrangler deploy`) so `LATEST_CLIENT` matches the pin again.
- **Lost data:** D1 Time Travel can restore the database to a point in the last 30 days (`npx wrangler d1 time-travel restore spinlings --timestamp <time>`). Everything written after that point is lost, and anything deleted since then comes back, including accounts players deleted. Use it only to recover from real data loss.
- **A bad mod release:** in one commit, point the marketplace entry back at the previous tag and its commit and set `LATEST_CLIENT` back to that release; deploy the server from that commit (`npx wrangler deploy`) so it stops announcing the bad one, then cut a fixed release. Never move or delete a published tag.
