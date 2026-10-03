# Spinlings: game and architecture spec

The single source of truth for the game's rules, numbers and code layout. When code and this file disagree, fix one of them in the same change.

## 1. The game in one paragraph

Spinlings is a creature card game that lives inside Claude Code. While Claude works, wild creatures show up and other players' teams come to duel. Your team of three battles them in the band above the prompt. Wins catch creatures, earn sparks and level your team up through three evolution stages, and every card is a one-of-a-kind creature with its own look, genes and traits. Now and then a Mythic turns up that has never existed before. You fuse cards into brand-new hybrids, and you trade and gift them with other Claude Code users, or play entirely offline. The game never knows what you are working on. It reads only the shape of the session: which model, the effort setting, whether Claude is working, idle time, agents, context fill and rate limits. It never reads files, commands, prompts or output.

## 2. Hard rules

1. **Content-blind.** The mod reads only the signals in section 10. It never hooks `tool.call` or `prompt.submit`. It never reads prompt text, answers, tool names, inputs, outputs, paths, repo names or cost.
2. **Never reward usage.** No reward scales with tokens, turns, tool calls, prompts, cost, context fill or turn length. Every finished battle pays the same, and battles are paced by server spacing. Packs charge per 50 minutes of presence, which counts idle time. There are no daily quotas (section 24).
3. **Never in the way.**
   - Hooks always call `next(e)`, and nothing blocks or slows Claude.
   - The mod injects no context, registers no Claude-callable tools and makes no model calls.
   - The band is hidden unless something is live.
   - `/spin quiet` silences everything.
4. **The server decides everything scarce:** rolls, card DNA, ownership, battle results, sparks, ratings and trades. The client only animates.
5. **No free text.** Handles are generated, and there is no chat, so there is nothing to moderate.
6. **No money.** No purchases, no paid currency and no crypto. Cards have no cash value.
7. **Tone.** Names, traits, moves and messages are whimsical creature-world words, such as Pipkin, Fogmaw, Sturdy and Moonlit. There are no programming or developer puns anywhere in the game's text.

## 3. Families (types)

There are four families, one per Claude model. A pack belongs to the family of the model you used, and the battle arena is the family of the model you are using now.

| Family | Model ids containing | Hue range | Stat bias | Special move |
|---|---|---|---|---|
| `haiku` | `haiku` | 85–165 (greens, teals) | fast, fragile | **Flurry**: two hits at 0.9x each |
| `sonnet` | `sonnet` | 190–255 (blues) | balanced | **Couplet**: a 1.5x hit, then heal 15% of max HP |
| `opus` | `opus` | 345–40, wrapping (reds, oranges) | heavy, slow | **Crescendo**: a 2.1x hit |
| `fable` | `fable` | 260–320 (purples) | tricky | **Twist**: a 1.6x hit that always counts as super effective |

An unknown model maps to a family by `hashString(modelId) % 4`, in the order haiku, sonnet, opus, fable.

**On screen,** sprites draw each family's range inside a narrower band (haiku 92–150, sonnet 196–234, opus 358–32, fable 270–308), mapping a hue's place in the range onto the band, so drawn families always stay at least 35° apart.

**Type cycle.** Opus beats Sonnet, Sonnet beats Haiku, Haiku beats Fable, and Fable beats Opus.

| Matchup | Multiplier |
|---|---|
| Attacker beats defender | 1.5x |
| Defender beats attacker | 0.67x |
| Anything else | 1.0x |

## 4. Seasons, species and DNA

### Seasons
- A season lasts 28 days. Season 1 starts 2026-10-01T00:00:00Z: `season = floor((now - EPOCH) / 28 days) + 1`.
- Each season has 8 regular species per family plus 1 legendary per family, so 36 species in all.
- Species ids look like `s{season}-{family}-{index}`. Index 0–7 is regular and index 8 is the legendary.
- Every species property comes from `hashString("spinlings/season/{season}/{family}/{index}")`:
  - body template
  - base hue, inside the family range
  - default pattern
  - accessory (worn from stage 2)
  - base stats
  - names (through the name generator, section 23)
- Cards from past seasons stay in your collection and can still battle and trade. Crafting covers the current season only.

### Bodies: torso archetypes plus parts
- There are 6 torso archetypes: blob, critter, bird, ghost, bug and wyrm. Each family's 8 regular species use at least 5 different ones.
- Every creature is assembled from parts picked from a seed (`core/parts.ts`):
  - torso size and shape;
  - a head, merged into the torso or a distinct round, wide or small one;
  - ears or a head-top: pointy, round, long, floppy, nubs, antennae, crest, tuft, sprout or fins;
  - wings (none, small, large, leaf or bat), a tail (none, curl, spike, fluffy or fin) and legs (none, stubby, long or many);
  - arms, a snout or beak, and the spacing of the eyes.
- Each archetype leans toward its own parts (birds have beaks, bugs many legs, ghosts float) but can grow almost any of them.
- The seed is the species id, a fusion's parents (see Fusion) or a Mythic's own seed (section 18). Silhouettes count as distinct when they differ by 4 or more pixels. At stage 1, at least 430 of 500 seeds are distinct, and across 14 seasons of regular species at least 95% are distinct at every stage.
- Sprites are mirrored, with controlled asymmetry: the tail grows on one side, crests and tufts sweep to one side, and antennae, sprouts and waving arms lean.
- Nothing floats: every part touches the body orthogonally (or, for an antenna bud, through its stalk), and an appendage that cannot show at least 3 pixels past the body is left off. Wings ride at the shoulder or, for some species, low at the hip; a bird always has a beak; a ghost tapers into a wisp; a wyrm's tail sweeps out along the ground.
- The outline is coloured on the lit top and left and darkest on the bottom and right; antenna and sprout stalks are drawn without one.

### Base stats
Base stats are for stage 1, level 1, common rarity, before genes. They start from a budget of 100 points split by the family's bias weights, plus species jitter of up to 8 points per stat. Each stat is then mapped from its share:

| Stat | Value |
|---|---|
| hp | 20 + share |
| atk | 4 + share / 2 |
| def | 3 + share / 2 |
| spd | 1 + share / 2 |

Bias weights (hp, atk, def, spd):

| Family | hp | atk | def | spd |
|---|---|---|---|---|
| haiku | 24 | 26 | 18 | 32 |
| sonnet | 28 | 26 | 24 | 22 |
| opus | 34 | 30 | 24 | 12 |
| fable | 26 | 28 | 22 | 24 |

Legendaries get 1.15x base stats. Mythics get 1.1x the legendary base (section 18).

### Names
Every species has three stage names, and a legendary has one stately name used at every stage. Section 23 defines how names are made. No two species in a season share any name, and every name passes the profanity and franchise blocklists.

### Card DNA (every card is unique)
When the server creates a card, it rolls a 32-bit `dna`, and everything individual derives from `hashString(species + ":" + dna)`:

| Gene | Effect |
|---|---|
| Palette | Hue shift of ±18° from the species hue (kept inside the family range), lightness ±6%, saturation ±8% |
| Pattern | The species default 80% of the time; otherwise one of none, spots, stripes, belly or mask |
| Eyes | dot, tall, sparkle, sleepy or fierce |
| Mouth | none, smile, fang or o |
| Shape | The torso's and head's corner rows round off or square up, the tail may switch sides, ears and tail may grow or shrink a size, and 1 in 5 cards is a runt or a chonk (half a pixel slimmer or wider), so silhouettes differ slightly while the species stays recognisable. The pattern's colourway varies too. |
| Trinket | 5% chance of a cosmetic: tiny hat, bow, flower, scarf or monocle |
| Genes | 4 values from 0 to 15 (hp, atk, def, spd). Each scales its stat by `0.88 + 0.016 * gene` (±12%). The **gene score** is `sum / 60` as a percentage. |
| Traits | 1 trait (2 for epic and legendary), drawn without repeats from the trait pool |

A shiny card (1 in 100) keeps its family's colours but moves its hue to the other half of the family's band, with deeper colour, gold accents, silver accessories and a bronze outline. It always shows a twinkle (a star in a free corner, or two specks of light on its body when no corner is free), and its frame sparkles.

### Traits (whimsical names only)
| Trait | Effect |
|---|---|
| Sturdy | Survives the first lethal hit with 1 HP, once per battle |
| Swift | +15% spd |
| Thick Hide | Takes 10% less damage |
| Lucky Star | Crit chance 1/8 instead of 1/16 |
| Quick Charge | Special is ready after 1 normal attack instead of 2 |
| Glass Heart | +20% atk, −15% hp |
| Regrowth | Heals 6% of max HP at the end of each round it is active |
| Underdog | +25% atk while below 30% HP |
| Ambush | +30% damage on its first action after entering |
| Moonlit | Specials heal it for 25% of the damage they deal |
| Stubborn | Ignores type disadvantage (0.67x becomes 1.0x) |
| Showoff | Specials deal 25% more |
| Guardian | When it faints, the next ally gets +15% def for the rest of the battle |
| Sleepy | −10% spd, +15% hp |
| Homebody | Its arena bonus is 1.2x instead of 1.1x |
| Mimic | Its special uses the special of the opposing active creature's family |

### Stages and stats
- Every card is stage 1, 2 or 3 (section 22). A card evolves automatically to stage 2 at level 4 and to stage 3 at level 8. Each evolution keeps the palette, eyes and parts and grows them; stage 2 adds the species accessory, stage 3 a grander one, and each stage takes its own name.
- Legendaries and Mythics never evolve. They are minted in their single final form (stage 3) with the largest version of every part, a gold crown or halo, and, on legendaries, a gold rim light along the body's outer top and left edges.
- `stat = round(base * geneMult * rarityMult * levelMult * stageMult * traitMult)`

| Multiplier | Values |
|---|---|
| rarityMult | common 1.00, rare 1.08, epic 1.18, legendary 1.30 |
| levelMult | 1 + 0.07 * (level − 1); levels run 1–10, and the next level needs `40 * level` xp |
| stageMult | 1.00 at stage 1, 1.15 at stage 2, 1.30 at stage 3 |

- The server computes every online card's stats and sends them as `Card.stats` (section 32).
- **Power** is `hp + 2*atk + 2*def + spd`. It is used for display and for sizing Rivals.

### Fusion
Fuse any two of your cards (not bound, not in escrow) into one brand-new hybrid card. Both parents are consumed.

| Property | How it is set |
|---|---|
| Body | Parent A's torso, legs and tail, with parent B's head-top, wings and eye spacing |
| Family and palette | Parent B's family. The head and ears keep B's colours; the torso, legs and tail take parent A's, so the hybrid shows both parents |
| Name | Three stage names blending A's name with B's (section 23); the same parents always give the same names, and never a species name |
| Rarity | The higher parent's rarity. 15% chance of one tier up (never into legendary). |
| Traits | One from each parent where possible (no duplicates); epic and legendary keep a second |
| Genes | The average of the parents' genes, ±2 noise, clamped to 0–15 |
| Level and stage | Level `max(1, floor((LA + LB) / 2) − 1)`; the stage that level reaches (2 at 4, 3 at 8). Fusions evolve normally. |
| Species id | `fusion`, with the hybrid's own embedded `form` (`kind: 'fusion'`, `parents: [speciesA, speciesB]`) on the card (section 18) |

- Fusion is not in the Album. It has its own **Fusion Log** of hybrids you have made.
- Costs 40 sparks (20 on Fusion Fair). There is no daily limit.
- A fused card gets a fresh `dna`, so two fusions of the same parents never look identical.

## 5. Battles

### Kinds
- **Wild encounter (PvE).** A wild team of 1–3 creatures, generated from the battle seed. Species come from the current season. Weights: the arena family 50%, the daily featured species 15%, any family 35%. Wild rarity is common 78%, rare 18% and epic 4%. Wild creatures have no legendaries, except two leads: 1 encounter in 40 leads with a Mythic (section 18), and otherwise 1 in 100 with the weekly roamer (section 7). A rested player's lead is rare or better (section 17). Wild levels sit within ±1 of your team's average level.
- **Duel (async PvP).** You fight another player's saved team, or a Rival trainer when no real player fits (section 19). Matchmaking is in section 5, Matchmaking.
- **Waiting battles** start on their own. They are a duel 40% of the time when a duel opponent exists and you have not dueled in the last 20 minutes; otherwise they are wild. `/spin battle` starts a duel. There is no command for wild encounters: wild creatures only find you (section 13).

### When battles happen
- **Waiting battle:** rolls on the encounter timing of section 13 while Claude's main turn runs, when the player has at least 1 card that is not tired and the game is not quiet.
- **Manual battle:** `/spin battle` or a revenge, any time; the server spaces duel starts at least 2 minutes apart.
- **Server pacing** (section 24): a wild start at least 8 minutes after the previous wild start, a duel start at least 2 minutes after the previous duel start, one open battle at a time, and a minimum duration of 1.5 s per round.
- **Never coupled to Claude.** Battles never wait for Claude, and Claude never waits for a battle. If Claude finishes first, the battle keeps playing in the band until it ends.
- **Pace is cosmetic, set by effort:**

  | Effort | Seconds per round |
  |---|---|
  | low | 1.8 |
  | medium | 2.2 |
  | high | 2.5 |
  | xhigh | 3.0 |
  | max | 3.5 ("dramatic slow motion") |

### Format
- Teams have 3 slots. Slot order is play order, and the active creature is the first one not fainted.
- **Tired.** A team card that fainted in your last battle is tired for 15 minutes. At battle start, each tired or missing slot is filled automatically by your highest-power card that is not on the team, not tired and not in escrow ("Tuftbun stepped in for Pipkin"). If no card is available the slot stays empty, and a team with no creatures cannot battle.
- **Limit:** 20 rounds. If both sides still stand after round 20, the side with the higher total remaining HP fraction wins. Equal fractions are a draw.

### A round
1. Both active creatures act. Higher spd goes first. Ties go to the attacker on odd rounds and the defender on even rounds.
2. An actor uses its special whenever it is charged: specials auto-fire on the first action after they become ready, for both sides. Otherwise it makes a normal attack.
3. **Charge.** A normal attack adds 1 charge. 2 charges make the special ready (1 with Quick Charge). Using the special resets charge to 0.
4. **Target.** The target is the opposing active creature. If the first actor knocks the target out, the second actor's action is skipped that round.
5. **End of round:** trait effects such as Regrowth apply.

### Damage
```
raw = atk * atk / (atk + def)
dmg = max(1, round(raw * typeMult * arenaMult * variance * crit * moveMult * traitMods * dailyMods))
```

| Term | Value |
|---|---|
| `typeMult` | From section 3 |
| `arenaMult` | 1.1 when the attacker's family is the arena family (1.2 with Homebody); otherwise 1.0 |
| `variance` | Uniform in [0.85, 1.0] |
| `crit` | 1.5 with probability 1/16 (1/8 with Lucky Star) |
| `moveMult` | 1.0 for a normal attack, otherwise the special's multiplier, times 1.3 for a Perfect special |

**RNG order.** All randomness comes from the battle's seeded RNG. Speed ties are settled by round parity, so nothing is drawn for them; each action draws variance, then crit, in action order. A battle therefore replays identically from `(seed, attackerTeam, defenderTeam, arena, daily, inputs)` under one rules version (`RULES_VERSION`, section 32), and a press on round r never changes any earlier round.

### Controllers
- **Defender** (a saved team or wild creatures): always automatic. A special fires as soon as it is charged.
- **Attacker:** automatic exactly like the defender. **Perfect timing:** in the round the attacker's special fires, the band shows `[1] Now!`. Pressing 1 during that round's animation makes it a **Perfect** special: 1.3x power and a `Perfect!` banner. Watching earns a small bonus; looking away costs nothing.
- **Balance.** An attacker who never presses wins about half of even duels (about 53% of mirror matches, from acting first on odd rounds); pressing on every special wins about 77% of mirror matches and about 59% of random even ones. A test pins all four figures (`test/docs/balance.test.ts`).
- **`inputs`** is the sorted list of 1-based round numbers on which the player pressed. A press counts only in a round where the attacker's special fires; other presses are ignored. Inputs change nothing before their round.

### Arena
The arena is the family of the attacker's current model at battle start. It is symmetric: creatures of that family on both sides get the arena bonus.

### Outcomes
| | Win | Draw | Loss |
|---|---|---|---|
| Sparks | 10 (duel 12) | 5 | 3 |
| XP to each team card that took part | 20 | 12 | 8 |
| Rating (duels only, Rivals included) | Elo up | Elo | Elo down |
| Wild catch | 60% (80% on Wild Bloom; the first wild win ever always catches): pick 1 of the defeated wild creatures to keep | – | The wild team "wanders off"; a Mythic is gone forever |
| Duel bounty | 20%: a freshly rolled card of the opponent's lead species | – | – |
| Tired | – | Fainted cards tired 15 min | Fainted cards tired 15 min |

- **You never lose a card in battle.**
- **No daily caps** (section 24): every finished battle pays sparks and XP, and every wild win rolls a catch.
- **Daily first win:** +1 pack.
- **Defense.** When another player's duel against your team ends as their loss, you get 4 sparks and a notification. Defense sparks and rating move only for the first 3 finished duels between the same two accounts in any rolling 24 hours (the pair limit). Your team is never made tired by defending.
- **Rating.** Starts at 1000, with a floor of 0.
  - The attacker's change is `round(32 * (S − E))`, where S is 1 / 0.5 / 0 and `E = 1 / (1 + 10^((Rdef − Ratt) / 400))`.
  - The defender moves by `−round(delta / 2)`.
  - The pair limit above applies to rating too.
  - Against a Rival, only the player's rating moves, using the Rival's generated rating.
  - Wild battles do not move rating.
- **Abandoned battles.** A battle not finished within 10 minutes is settled with no inputs the next time either player touches the server.

### Matchmaking (duels)
1. **Candidates** must meet all of these:
   - has a saved team of at least 1 card;
   - seen in the last 14 days;
   - not the attacker;
   - not among the attacker's last 5 opponents.
2. **Rating window:** ±150 first, widening to ±400 and then to anyone. Pick uniformly at random from the first window that is not empty.
3. **No candidates:** a Rival trainer sized to the player's team fills in (section 19).
4. **Snapshot.** The defender's team is copied at match time. Tired status does not apply to defense.

## 6. Packs and the economy

### Packs
- A pack holds 5 cards.

  | Slots | Common | Rare | Epic | Legendary |
  |---|---|---|---|---|
  | 1–4 | 70% | 22% | 7% | 1% |
  | 5 | – | 75% | 21% | 4% |

- A legendary roll gives the pack family's legendary species. Every other rarity picks uniformly from the family's 8 regular species.
- Each card rolls shiny independently at 1/100.

**Charging (presence).**
- The client counts minutes in which any Claude Code session on the machine was open. Idle time counts, and a single `$.store` lease means one lamp per machine.
- After every 50 minutes of presence, it asks the server to charge a pack of the family used most in that stretch.
- The server accepts a charge only if both of these hold (section 24):
  - the last accepted charge was at least 45 minutes ago (90 minutes beyond 16 charges in any rolling 24 hours);
  - fewer than 12 unopened packs are held (the bank: "Open some packs to make room").

**Other ways to get packs:**
- **Daily first win:** +1 pack.
- **Buying:** 150 sparks a pack, with no limit.
- **Streaks, season end, the Wandering Trader and drops** also give packs (sections 14, 19 and 25).

**Opening.** The server rolls the cards when the pack is opened, not when it is charged. The pane shows a reveal.

### Sparks
| Earn | Amount |
|---|---|
| Battle | Section 5 |
| Defense win | 4 (pair limit, section 5) |
| Daily hello (first request of the UTC day) | 10 |
| Recycle a card | common 5, rare 25, epic 100, legendary 400; shiny doubles, foil adds half again, and a Mythic doubles once more. Bound cards cannot be recycled. |

| Spend | Amount |
|---|---|
| Craft a current-season species (fresh DNA) | common 50, rare 200, epic 800, legendary 3200 |
| Extra pack | 150 |
| Fusion | 40 (20 on Fusion Fair) |
| Trade fee | 10 per card you receive (burned) |

New players start with 100 sparks.

### First run
1. **Join.** The client joins silently: `GET /v1/challenge`, a proof of work, then `POST /v1/join` with the current family (sections 30 and 34).
2. **Starter team.** The player gets 3 bound common cards at level 3, 20 xp short of level 4 so one won battle evolves them, saved as the team: one from a family the server picks at random, one from the family it beats, and one from the family that beats it, in a shuffled order. The team is public, so it never follows the joining family (section 20.3). They have DNA like any other card.
3. **Welcome gifts.** 2 welcome packs (the current family and one random other family), trade-locked for 7 days, and 100 sparks.
4. **Band.** See section 34.

## 7. The living world (all driven by the date, no server work)

- **Daily rule.** One a day from a pool of 12, picked by `hashString("spinlings/day/" + utcDate)`. It applies to every battle that day:
  1. Haiku Day: haiku creatures get +20% spd
  2. Sonnet Day: sonnet creatures heal 4% per round
  3. Opus Day: opus creatures get +15% atk
  4. Fable Day: fable specials are ready after 1 charge
  5. Topsy-Turvy: the type cycle is reversed
  6. Glass Day: crits deal 2x
  7. Long Day: the round limit is 30
  8. Gentle Day: all damage −15%
  9. Wild Bloom: catch chance 80%
  10. Shiny Hour: from 18:00 to 19:00 UTC, shiny is 1/25
  11. Fusion Fair: fusion costs 20 sparks
  12. Calm Day: no rule
- **Featured species.** One per day, picked from the current season's regular species by date hash. It appears in 15% of wild slots.
- **Weekly roamer.** Each ISO week, one of the season's legendaries roams. Any wild encounter not led by a Mythic has a 1% chance to include it as the lead, at the season's legendary stats. Catching it follows the normal 60% roll, so it is the rarest moment in the game.
- **Seasons** bring 36 new species every 28 days.

## 8. Trading and gifts (async)

### Offers
- **Starting a trade.** Open a player's profile in the pane: from the opponent you just battled, from the trade board, or with `/spin trade <handle>`. You see their cards marked **for trade**.
- **Building an offer.** Pick 1 to 3 of your cards and 0 to 3 of theirs, then send. Either side may be empty except yours, so an offer can be a pure gift-trade.
- **Escrow.** Your offered cards go into escrow until the offer resolves.
- **Responding.** The receiver can **accept**, **decline** or **counter**. A counter declines the offer and sends a new one with the roles swapped.
- **Expiry.** Offers expire after 72 hours, and expired offers return escrowed cards.
- **Accepting.** On accept, the server checks that every requested card is still owned by the receiver and still tradeable. It then swaps atomically and charges each side 10 sparks per card received. If a side cannot pay, the accept is refused and nothing moves. Traded cards leave teams. Received cards are trade-locked for 24 hours.
- **Who can trade:** online accounts at least 3 days old with 10 finished battles (section 30). Claiming a gift is always allowed.
- **Limits:** at most 20 open outgoing offers at once (storage, not a quota). Bound, escrowed and trade-locked cards can't be offered.
- **What an offer shows:** the other player's cards appear as public battle cards: no ownership details or timestamps (section 20).

### Trade board
- Every card has a **for trade** toggle.
- Each player keeps a **wishlist** of up to 5 species ids.
- The board lists **matches**: players who have a for-trade card on your wishlist and want a species you have marked for trade. Each match shows one card from each side, at most 20 matches, freshest players first.
- If you have no matches, the board shows recent for-trade cards from active players.
- The board always shows the Wandering Trader's deals too (section 19).

### Gifts
- **Making a gift.** `POST /v1/gift` puts one tradeable card in escrow and returns a code: 3 words plus 4 digits, e.g. `quiet-otter-lamp-4821`. The code is valid for 14 days. The share link is `{server}/g/{code}`, a page that shows the card and how to install and claim.
- **Claiming.** `POST /v1/claim` gives the card to the claimant and trade-locks it for 24 hours. You cannot claim your own gift.
- **Bonus for the giver.** If the claimant joined after the gift was made, the giver gets a bonus pack once the claimant has finished 5 battles on 2 different days (section 24).
- **Expiry.** Expired gifts return to the giver the next time the giver touches the server.
- **Limits:** 10 open gifts at once (storage) and 5 claim attempts per hour (brute-force protection on codes).

## 9. Surfaces

### Status line
- Empty by default.
- `spinlings · 2 packs` when packs are waiting.
- `spinlings · vs soft-otter-42` during a duel, and `spinlings · wild Fogmaw` during a wild encounter.
- Appends ` · update 0.2.0` when the server names a newer release (SPEC 32).
- Never shows a sparks count.

### Band (above the prompt; hidden by default)

| State | Size | Contents |
|---|---|---|
| Battle | Up to 4 rows | Header `vs soft-otter-42 · Opus arena · Haiku Day · round 3`. Both active creatures as 8×8 mini sprites with name, HP bar and HP. `[1] Now!` during the round the attacker's special fires (Perfect timing). A `+n cheering` line while subagents run. |
| Result | 1 row, 12 s | e.g. `Won vs wild Fogmaw · caught Fogmaw! · +10 sparks · Pipkin evolved into Pipmaw`, with `[Open]` |
| Catch choice | 1 row | When a wild win allows a catch: `[1] Fogmaw  [2] Tuftbun  [3] Mintling` (auto-picks the rarest after 20 s) |
| Welcome | 2 rows, once ever | See "First run" in section 6 |

### Pane (`/spin`)
Four tabs, hotkeys 1–4. A header shows the daily rule and `[p] Open pack (n)`.

| Tab | Shows |
|---|---|
| Team | 3 slots with tired timers, rating, last 5 battles, defense notices |
| Cards | Collection grid with family and rarity filters; card detail (stats, genes, traits, origin) with set in team, for trade, fuse, recycle and gift |
| Album | The season's 4 families × 9 species with silhouettes for unseen ones, plus craft; also the Fusion Log |
| Trade | Inbox (incoming and outgoing offers), the trade board, the wishlist, gifts and claim |

### Sprites
- **Terminal:** a `Raster` of half-blocks. Cards are 16×16 pixels (16 columns × 8 rows). Minis are 8×8 (8 × 4).
- **Minis** downscale the card sprite to fit the body's core, so thin wings, tails and antennae fall away. They are centred between the eyes, keep the outline (the lighter of the card's two outline tones) and exactly two eyes on one row, at least a cell apart and never on the face's edge, and mark tall ears and horns on their top row.
- **Faces:** eyes are 2×2 with a catchlight when the face has room (dot eyes are 1×2); a snout is a lighter muzzle with a dark nose, the mouth below it; a mask is a patch around each eye with a bridge of body colour between; a belly patch shows only on a real tummy below the mouth. At most two near-white tones per creature.
- **Desktop:** `Svg`.

### Commands
- There is one command, `/spin`, with these subcommands:
  - `battle`, `pack` (opens the pack view; never creates a pack)
  - `team <a> <b> <c>`
  - `trade <handle>`
  - `gift <card>`, `claim <code>`
  - `share [card]`
  - `redeem <code>`
  - `world online|offline`
  - `devices`
  - `quiet [on|off]`, `motion on|off`, `sound on|off`
  - `privacy`
  - `server [url|default]`
  - `version`
  - `demo`
- Every command answers `{}`. Output that is text goes to `$.ui.log`, so the model never reads it.

### Shares
- `/spin share [card]` copies a short text: an 8×8 emoji mosaic of the sprite, the card's name, family, rarity and shiny status, and the card page link `{server}/c/{id}`.
- Card pages carry an `og:image` (a PNG of the pixel art), so links unfurl with the creature.
- Profiles live at `{server}/u/{handle}`.

## 10. Signals the mod reads (content-blind)

| Signal | Hook | Used for |
|---|---|---|
| Model id | `$.session.model()`, `turn.step` `e.model` | Pack family, arena |
| Effort | `turn.step` `e.effort` | Battle pace (cosmetic) |
| Claude working | `turn.start` and `turn.complete` (main thread, where `agentId` is undefined) | Waiting battles |
| Turn ending | `turn.complete` `reason` | A one-line reaction only (e.g. the creature flinches on Esc) |
| Spinner phase | `ui.render` Spinner `e.props.mode` | Spinner suffix during a battle |
| Subagents | `agent.spawn` (count only) | Cheering line in the band (cosmetic) |
| Context fill, rate limits | `session.measure` | Status line comfort note only ("your team is napping until 3:40 PM" at a 100% limit) |
| Compaction | `session.compact` `trigger` | A one-line reaction only |
| Session open | `session.start`, `session.end`, a `$.clock.every(60s)` heartbeat with a `$.store` lease | Presence minutes for pack charging |

**Never hooked:** `tool.call`, `prompt.submit`, `classic.PermissionRequest`.

**Never read:** `answer`, prompt text, tool data, paths, cwd, repo, `cost`.

## 11. Architecture

```
spinlings/
  .claude-plugin/marketplace.json   the repo is a plugin marketplace
  plugin/                           the Claude Code mod
    .claude-plugin/plugin.json
    hooks/hooks.json
    hooks/register.tsx              every hook and every $ call lives here
    hooks/core/                     pure, shared game logic (also imported by the server)
    hooks/client/                   pure client logic (presence, scheduler, view models)
    hooks/client/local/             LocalBackend: the offline world, built from core rules only (section 28)
    hooks/ui/                       pure view builders: (elements, viewModel, actions) => tree
    types/index.d.ts                $.state contract
    tests/                          `claude plugin test plugin`
  server/
    src/worker.ts                   Cloudflare Worker entry (D1 binding DB)
    src/app.ts                      request handlers over the async Db
    src/db.ts                       async Db interface with guarded atomic batches; D1 and node:sqlite adapters
    migrations/                     D1 migrations (wrangler d1 migrations apply; Node applies them at start)
    src/node.ts                     self-hosting entry (node:http + node:sqlite)
    src/pages.ts, src/png.ts        HTML pages and og:image PNGs
    src/schema.ts                   the SQL schema
    test/                           `node --test`
  SPEC.md, README.md, PRIVACY.md, LICENSE
```

### Code rules
- **`plugin/hooks/core/**` is pure ES2023.** It uses no Node APIs, no DOM and no `$`. It never calls `Date.now()`, because time is a parameter, and never calls `Math.random()`, because randomness is an `Rng` parameter. It is imported by the mod, the server and the tests.
- **Imports and syntax.**
  - Every relative import spells out its `.ts` extension.
  - Types are imported with `import type`.
  - No enums, no namespaces and no parameter properties: Node strips types natively and cannot compile those.
- **`$` stays in `register.tsx`.** The mod's validator only allows `$` calls inside that file, either directly in hooks or in its top-level functions that take `$`. Other mod files receive plain data, element tables from `$.ui.resolve(e)`, and callbacks.
- **Server.** The server is one stateless Cloudflare Worker with a **D1** database (binding `DB`, database `spinlings`). There are no Durable Objects. See section 16 for how handlers stay atomic on D1. The same `app.ts` runs on Node over `node:sqlite` with the same async `Db` interface.
- **Auth.** `POST /v1/join` returns a session token (sections 27, 29 and 30). The server stores only its SHA-256 hash, and the client keeps it in `$.store`.
- **Proof of work.** Join requires `sha256hex(challenge + ":" + nonce)` to start with `difficulty / 4` zero hex digits. The default difficulty is 16 bits. Challenges are single-use and expire after 5 minutes.
- **Rate limits.**
  - 120 requests per minute per token.
  - 5 joins per hour and 20 per day per IP hash. The IP hash is an HMAC salted by the day and is never kept past 24 hours (section 20).

## 12. Security, privacy and supply chain (hard requirements)

### Supply chain
- **Zero runtime dependencies.** The mod, the shared core and the server have no npm runtime dependencies at all. They use no frameworks, and nothing is vendored except code we wrote.
  - SHA-256 is our own small implementation in `core/sha256.ts`, tested against NIST vectors.
  - The PNG encoder is our own `server/src/png.ts`, using `CompressionStream` (available on both Workers and Node).
- **Dev tooling is minimal and pinned.**
  - `wrangler` is the only dev dependency. It is pinned to an exact version, `package-lock.json` is committed, and CI installs with `npm ci --ignore-scripts`.
  - Tests use `node:test`, which is built in.
  - No `postinstall` scripts anywhere.
- **CI.**
  - GitHub Actions are pinned by full commit SHA.
  - `permissions: contents: read`.
  - No secrets are available to pull-request workflows.
  - Deploys run only from tags on `main`.
- **Releases.**
  - The marketplace entry points at a tagged release (`ref`), not at `main`.
  - Every release note links the diff and the `claude plugin validate` output.
  - `SECURITY.md` explains how to report a vulnerability.

### Client (the mod runs with the user's full permissions, so it does almost nothing)
- **Only `$` nouns used:** `ui`, `state`, `store`, `clock`, `command`, `http` and `session`. Read-only `session` calls: `model`, `id`, `version`, `surfaces`, `usage`.
- **Never used:** `$.fs`, `$.process`, `$.model`, `$.prompt`, `$.tool`, `$.agent`, `$.mcp` or `$.env`. A test asserts this against `claude plugin validate --json` output.
- **One host.** Network calls go only to the configured server URL. It must be https, except `http://localhost` or `http://127.0.0.1` for development. Redirects are not followed blindly, and responses over 256 KB are rejected.
- **Server data is untrusted.** Every response is validated against its expected shape before use, as a tolerant reader (section 32): known fields are type-, format- and range-checked, unknown keys are dropped. Every string drawn in the UI is stripped of control characters and escape sequences and cut to a maximum length.
- **The session token** lives only in `$.store`, is sent only in the `Authorization` header to the configured host, and never appears in logs, shares or the privacy view.
- **`/spin privacy`** shows exactly what the mod has sent: the last 20 request paths and bodies, with the token redacted. It also states the content-blind guarantee and the hook list.

### Server
- **Input validation.**
  - Every endpoint validates its input with a strict schema: unknown fields are rejected, types and lengths are checked, ids must match their formats, and numbers have bounds.
  - Bodies over 16 KB are rejected before parsing. JSON parse errors return 400.
- **SQL** uses bound parameters only, never string concatenation.
- **Auth.** Session tokens are 32 random bytes from `crypto.getRandomValues`, stored as SHA-256 hashes and looked up by hash. Missing or bad auth returns 401 with no detail.
- **Authorization.** Every action checks ownership with guards inside the same atomic D1 batch that changes state (escrow, trade locks, bound cards). Section 16 describes the guard pattern.
- **Rate limits and abuse.**
  - Per-token and per-IP-hash limits, plus the daily game caps.
  - Proof of work on join.
  - Claim attempts are capped.
  - Gift codes carry about 44 bits of entropy and are single-use.
- **Pages.**
  - Every dynamic value is HTML-escaped.
  - Strict headers: `Content-Security-Policy: default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`, no scripts (except the two passkey pages, section 30), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`.
  - API responses use `application/json` and send no CORS headers.
- **Errors** are logged without tokens, IPs or bodies.

### Privacy
Section 20 is the full privacy rule set and overrides this summary.
- **What the server stores about a player:** id, session hashes, passkey public keys (if saved), the generated handle, game state, and day-granularity dates (join day, last-seen day).
- **What it never stores:** IP addresses (only a daily-salted HMAC, for rate limits), user agents, timezones, emails or anything about the user's work.
- **No analytics, no telemetry and no third-party requests,** on the client or the server.
- **Deletion.** `DELETE /v1/me` deletes the account, its sessions, passkeys and cards (traded-away cards stay with their new owners). `/spin privacy` offers it, behind a 2-second hold.
- **What other people see:** a public profile shows the handle, the team, for-trade cards, album count and league, and nothing else.

## 13. Discovery and excitement (every new card is a moment)

**Principle:** no command ever hands out a card. Every new card arrives through a moment that builds anticipation and then pays off. Commands only open views. The game's job is to make the payoff feel earned and surprising: variable timing, foreshadowing, suspense beats, layered reveals (species, then rarity, then genes, traits and trinkets), and a celebration that scales with rarity.

### Where cards come from (all events, never commands)
| Source | The moment |
|---|---|
| Wild encounter while Claude works | rustle → reveal → battle → catch ceremony |
| Packs earned by presence | charge meter fills → "pack ready" → opening ceremony |
| Daily first win | a bonus pack → opening ceremony |
| Duel bounty | a card spins out of the opponent's corner → 1-card reveal |
| Gifts and trades received | a wrapped present in the band → 1-card reveal |
| Fusion | parents merge into an egg → wobble → hatch |
| Craft | the only deliberate source; still gets a short reveal |

`/spin wild` does not exist. Wild creatures only ever find you.

### Encounter timing (variable, so it is never predictable)
- **Turn threshold:** once Claude's main turn has run 20 s, every further 15 s of that turn rolls a 30% chance of an encounter.
- **Spacing:** at most one wild encounter every 8 minutes, enforced by the server. There are no daily caps (section 24).
- **Beginner's luck:**
  - the first encounter ever is guaranteed at 20 s;
  - the first wild win ever always catches.
- **Manual battles:** `/spin battle` challenges a duel only.

### The moments (band unless noted; terminal animates `Raster` frames with `$.ui.blit`, desktop uses `Svg` with SMIL/CSS animation)
1. **Rustle (1.5 to 3 s).** A dark silhouette of the creature wobbles, under the line "Something is rustling…". The silhouette foreshadows rarity:

   | Encounter | Foreshadowing |
   |---|---|
   | rare | 1 bright pixel twinkles |
   | epic | the outline shimmers in the epic colour |
   | shiny | a star glint crosses it |
   | weekly roamer | the band border turns gold and the line reads "The air feels different…" |
2. **Reveal.** A one-frame white flash, then colour, and the line "A wild Fogmaw appeared!", with the name in its rarity colour.
   - A `NEW` badge shows if you have never seen the species.
   - A `★ FIRST IN THE WORLD?` tease shows if no player has caught it this season (the server tells the client in the battle setup).
3. **Battle juice.**
   - **Special move:** a banner reading "Pipkin used Flurry!"; a Perfect special adds a `Perfect!` banner.
   - **A hit:** a white hit flash on the target (one frame), then the damage number pops above it.
   - **Callouts:** "Super effective!", "Not very effective…" or "Critical!".
   - **HP bars** drain smoothly over 300 ms.
   - **A knock-out:** the creature flickers and drops out.
   - **Traits** that fire get a small stamp, such as "Sturdy!".
4. **Catch ceremony (wild win).**
   - If more than one wild creature was defeated, the player first chooses one with `[1][2][3]`.
   - The creature then spins into a card: 4 frames of horizontal squash ending on the card back.
   - The card wobbles 1 beat for common, 2 for rare and 3 for epic or legendary, each beat 0.6 s.
   - **Success:** "Gotcha! Fogmaw joined your collection" with a sparkle burst.
   - **Failure:** "It slipped away!" as the card unspins.
   - The server has already decided the outcome; the animation only adds suspense.
5. **Pack opening ceremony (pane overlay).**
   - **Open:** the pack shows as a pixel package in its family colour. Pressing `[o] Open` plays a 3-frame tear.
   - **Glowing backs:** five face-down cards appear, and each back glows in its rarity colour before it flips: blue for rare, purple for epic, pulsing gold for legendary. That way you see "one is glowing gold" before you know what it is.
   - **Flipping:** `[f]` flips the next card, and cards auto-flip every 1.2 s with no input.
     - Commons flip fast.
     - Rare and better flip slower and add a flash.
     - Shiny cards add sparkles around the card.
     - A legendary turns the pane border gold and shows a `LEGENDARY!` banner.
   - **Each revealed card** shows:
     - its name and rarity;
     - `NEW` for an unseen species;
     - its gene score counting up from 0 to its value;
     - its trait stamps;
     - its trinket, if any ("wears a tiny hat").
   - **Summary:** "5 cards · 2 new species · Album 14/36 (+2)" with `[t] Set team` and `[d] Done`.
6. **Evolution ceremony** (at level 4 and again at level 8, section 22).
   - The band shows "What? Pipkin is evolving!".
   - The current sprite then alternates with a white silhouette of the next stage, getting faster over 3 s, and ends in a flash.
   - Then: "Pipkin evolved into Pipmaw!", with the stat gains.
7. **First discovery.**
   - **Per player:** a species you see for the first time gets `NEW`, and its album cell fills in with a flash.
   - **Global:** the first player in the world to obtain a species in a season gets a permanent `First Discovered` stamp on that card. The album shows "first found by {handle}" to everyone. The moment is a gold banner: "You are the first trainer in the world to find Gloamkin!".
   - Stored server-side (`firsts`: season, species, player, card, at). The card carries `firstFind: true`.
8. **Pack charge meter.**
   - The pane header always shows progress toward the next pack, e.g. `next pack ███░░ 18 min`, filling with presence.
   - When a pack charges, the band shows for 6 s: "A pack is ready! [o] Open". It never nags after that.
9. **Gifts and received trades.** The band shows a wrapped present once: "quiet-otter-42 sent you a gift! [o] Open". Opening it is a 1-card version of the pack ceremony.
10. **Fusion hatch (pane).** The two parents' sprites interleave into an egg. The egg wobbles for 3 beats and cracks, then the hybrid is revealed with "Nobody has ever seen this creature."
11. **Daily hello.** The first time the pane opens each UTC day, a banner shows the daily rule and the featured species' sprite: "Today: Topsy-Turvy Day. The type cycle is reversed. Featured: Gloamkin".
12. **Sound.** Off by default; `/spin sound on` turns it on. It plays tiny chimes via `$.audio.play` for: rare+ reveal, legendary, evolution, first discovery. The chimes are generated by our own script into small WAV files shipped in the plugin, so there are no third-party assets. Playback failures are silent.

### Pacing of the first session
| When | What happens |
|---|---|
| Minute 0 | The welcome pack ceremony, opened from the welcome band |
| First 20+ s Claude turn | A guaranteed encounter |
| First win | A guaranteed catch |
| Every 50 presence minutes | A pack |
| Through the day | Variable encounters |

The design target is a reward moment roughly every 10 to 20 minutes of real use, never on demand.

## 14. Feel: anticipation, animation, foil, streaks, leagues

### Anticipation and payoff
The rule for every moment in section 13: **build up, pause, pay off, celebrate in proportion.**
- **Build-up:** silhouettes, glowing backs, wobbles, rustles. Rarer results get longer build-ups and stronger foreshadowing.
- **Pause:** a 200–400 ms beat of stillness right before a reveal.
- **Payoff:** one bright flash frame, then the reveal snaps in.
- **Celebrate in proportion:**
  - a common gets a quick, clean flip;
  - a rare adds a flash and sparkle;
  - an epic adds a burst and a shimmering border;
  - a legendary gets a gold banner, a border pulse and a longer hold;
  - each extra layer (`NEW`, `FIRST IN THE WORLD`, foil, shiny, a high gene score, a trinket) gets its own short beat, not one crowded frame.
- **Never punish a look away:** everything auto-advances, and the pane keeps the last reveal to re-read.

### Animation engine (client)
- **Terminal:**
  - Every sprite is a keyed `Raster`.
  - Effects are pixel frames pushed with `$.ui.blit` at up to 24 fps; the engine accepts 120/s, so 24 leaves headroom.
  - Layout changes, such as text and new rows, happen only at state transitions through `$.state`.
- **Desktop:**
  - One animated `Svg` per moment (`isInteractive`, SMIL `<animate>` / `<animateTransform>` and CSS keyframes; never scripts).
  - The tree re-renders only at state transitions.
- **Shared frame helpers** in `plugin/hooks/client/anim.ts`, all pure, operating on `Pixels`:
  - `silhouette(px, color)`, `flash(px)`, `squash(px, scaleX)` (card spin), `offset(px, dx, dy)` (wobble, shake)
  - `glowOutline(px, color, strength)`, `sparkles(px, t, seed)`, `foil(px, t)`, `dissolve(px, t, seed)`
  - `cardBack(width, height, rarity, glowT)`, `crossfade(a, b, t)` (evolution)
- **Easing:** ease-out on reveals and ease-in on exits. HP bars drain over 300 ms. Damage numbers rise 1 row and fade over 600 ms.
- **Durations:**

  | Moment | Duration |
  |---|---|
  | Rustle | 1.5–3 s (longer when rarer) |
  | Reveal | 0.4 s |
  | Catch | 1.6–3 s |
  | Card flip | 0.35 s common, 0.8 s rare and above |
  | Evolution | 3 s |
  | Pack tear | 0.5 s |
- **Reduced motion:** `/spin motion off` makes every transition instant and freezes foil to its static border. Quiet mode implies it for the band.

### Foil
- **The roll:**
  - `foil` is a holographic finish rolled independently at 1/16 on any card.
  - Every legendary and every Mythic is foil.
  - A fusion of two foils is foil; any other fusion rolls 1/16.
  - Foil never changes stats. Recycling a foil pays 1.5x.
- **Terminal look:**
  - A diagonal holo band sweeps across the creature every 2.4 s.
  - The band is 3 pixels wide. Pixels inside it blend 28% toward a rainbow hue, `(x*18 + y*10 + t*90) mod 360`, keeping their lightness; eyes, catchlights and the outline are left untouched.
  - The card border cycles through the rainbow.
  - With motion off, only the static rainbow border remains.
- **Desktop look:**
  - A rainbow `linearGradient`, masked to the sprite with `mix-blend-mode: color-dodge` at 40%, translated across with `animateTransform`.
  - The border stroke is a rotating rainbow gradient.
- **Label:** the rarity line reads `Rare · Foil`, and `Rare · Shiny Foil` when both apply. The reveal gives foil its own beat: the sheen sweeps once before the name appears.

### Streaks
- The server tracks consecutive wins, wild or duel. A loss or draw resets the count to 0.
- Every 3rd consecutive win pays a **streak pack**, with no daily limit (section 24). Wins count however close together they come: there is no separate streak spacing, and battle pacing (section 15: duels 2 minutes apart, the minimum battle duration, one open battle) is the only bound, the same for a script as for a player pressing `/spin battle`.
- During a battle the band shows `streak 2 · one more!`. A streak pack plays a `Hot streak! x3` banner.
- `PlayerView.streak` carries the count.

### Leagues and seasons
- **Leagues** come from rating (`ECONOMY.leagues`: Pebble, Brook, Grove, Peak, Star). Crossing a league floor in either direction plays a short badge moment in the result row.
- **Season end:** on a player's first request in a new season, the server:
  1. grants reward packs by the league of their final rating last season (`seasonPacks`), and for Star one guaranteed foil legendary card;
  2. soft-resets rating to `1000 + (rating - 1000) * 0.5`;
  3. adds a notice, e.g. "Season 1 ended in Grove: 3 reward packs!".
- The server stores each player's `season` so the grant happens exactly once.

### Revenge
- A `defense-loss` notice ("soft-otter-42 beat your team") has a `[r] Revenge` button.
- Revenge sends `StartBattleRequest.revenge = handle`. That starts a duel against that player's current team, bypassing random matchmaking but not the duel spacing.
- A revenge win pays 5 extra sparks.

## 15. Authority and anti-cheat

**Model.** The server (the Worker and its D1 database) is the only authority. Clients are untrusted renderers: a modified client can automate what an honest heavy player does, inside the same caps, and nothing more. Self-hosted servers are separate worlds.

### What only the server decides
| Domain | Server rule |
|---|---|
| Minting | Every card (pack open, catch, bounty, daily, streak, season and craft cards) is minted server-side. Randomness comes from `crypto.getRandomValues`. DNA, genes, traits, shiny and foil are rolled on the server. |
| Battles | The server chooses the opponent, the arena check and the seed. The client submits only `inputs` (strictly increasing round numbers, at most 30). The server re-simulates and decides the result. A battle can be finished once, only by its attacker, within 10 minutes. |
| Rewards and pacing | Sparks, XP, rating, streaks, leagues, spacing and pair limits are computed server-side, inside the same guarded batch as the change they guard. |
| Trades and gifts | Escrow, ownership checks, lock checks and the swap all happen in one guarded atomic batch (section 16). |

### What clients report, and the bound on lying about it
| Client claim | Effect if faked | Bound |
|---|---|---|
| Presence (pack charge) | A pack charges without the player being present | At least 45 minutes apart (90 beyond 16 a day) and a bank of 12: never more than an honest all-day user gets |
| Model, i.e. pack family and arena | Picks which family of packs they get, and the arena (a symmetric bonus) | Odds are identical for every family |
| Special timing (`inputs`) | Perfect timing | A press only counts on a round where the attacker's special fires; a script can at best match an attentive player |

### Requests are assumed hostile
- The server **cannot verify** that Claude is working. Nothing attests it, and the game is content-blind by design. Anyone can script the API directly.
- The design goal is therefore that **scripted play earns exactly what a dedicated honest player earns, never more.** Pacing matches the natural rhythm of honest play (section 24), so a script gains nothing by running faster.
- **Spacing, server-enforced (not only client-side):**
  - a wild battle may start only 8 minutes or more after the player's previous wild start;
  - a duel may start only 2 minutes or more after their previous duel start.

  Earlier requests get `rate_limited` with a retry time.
- **Minimum battle duration:** `finish` is refused with `conflict` if it arrives sooner than `rounds × 1.5 s` after `start`, where `rounds` is the number of rounds in the server's own re-simulation. The client simply waits. This keeps scripted farming at human speed and limits load.
- **One open battle per player.** Starting a new battle while one is unfinished first settles the old one with no inputs.

### Multi-account and funnel defences
- **Join:**
  - proof of work, 16 bits by default;
  - 5 joins per hour and 20 per day per daily-salted IP hash.
- **Card restrictions:**
  - Starter cards are bound forever.
  - Welcome-pack cards are trade-locked for 7 days (`lockedUntil = joinedAt + 7 days`).
- **Who may trade or send gifts:** online accounts at least 3 days old with 10 finished battles (section 30). Claiming a gift is always allowed (that is the invite loop).
- **Every trade burns sparks:** 10 per card received.

### Rating integrity
- **Matchmaking is random** within the rating windows. A player cannot choose an opponent, except through revenge.
- **Revenge** is allowed only against a player who won a duel against your team in the last 24 hours, once per defense loss.
- **Pair limit:** rating moves only for the first 3 finished duels between the same two players in any rolling 24 hours. After that the delta is 0.
- **Rivals** (section 19) move only the player's rating, against the Rival's generated rating.

### Request integrity
- **Transport and auth:** TLS only, with bearer tokens stored hashed.
- **Single-shot actions:** every mutation names the object it acts on (pack id, battle id, card id, offer id or code), and the server refuses to repeat a one-shot action (open, finish, catch, accept, claim) with `conflict`.
- **Inputs:** strict schemas on every input, and a 16 KB body limit.

### Transparency
- The odds page publishes every rate.
- The client and server are open source.
- The README has a "Cheating" section that states these limits honestly.


## 16. Storage: Cloudflare D1, atomic by guards

D1 is SQLite behind an async API, with no interactive transactions. Many Worker isolates may run handlers for the same player at once. Every handler therefore follows one pattern.

### The Db interface (`server/src/db.ts`)
```ts
type Stmt = { sql: string; params: unknown[] }
interface Db {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>
  /** atomic: every statement commits, or none do */
  batch(stmts: Stmt[]): Promise<{ changes: number }[]>
}
```
- **`stmt(sql, ...params)`** builds a statement.
- **`guard(conditionSql, ...params)`** builds a statement that **aborts the whole batch** when its condition is false. The condition is a scalar subquery returning 1, for example `SELECT 1 FROM cards WHERE id = ? AND owner_id = ? AND state = 'owned' AND version = ?`.
  - It is implemented as `INSERT INTO _guard (ok) VALUES ((<condition>))`.
  - The `_guard.ok` column is `INTEGER NOT NULL CHECK (ok = 1)`, so a NULL or 0 raises a constraint error, and D1 rolls back the entire batch.
  - Every batch ends with `DELETE FROM _guard`.
  - The adapter turns that failure into a `Conflict` error.
- **Adapters:**
  - **D1:** `env.DB.batch(...)`.
  - **Node:** `node:sqlite` `DatabaseSync` inside `BEGIN IMMEDIATE ... COMMIT`, rolling back on any error.

  Both surface a guard failure as the same `Conflict` error.

### The handler pattern (optimistic concurrency)
1. **Read** what the handler needs: the player row with its `version`, cards with their `version`, offers, and so on.
2. **Decide** in plain code: caps, rolls, costs, results.
3. **Write** one batch:
   - first a guard for every assumption made in step 1, e.g. `players.version = ?` and each card's `owner_id`, `state` and `version`;
   - then the writes, each bumping the `version` of every row it changes.
4. **On `Conflict`**, re-run the handler from step 1, up to 3 times. After that, return HTTP 409 `conflict`.

Every row a player can change has a `version` column. One-shot actions (open a pack, finish a battle, catch, accept an offer, claim a gift) also guard on their row's state, so replaying them always fails cleanly.

### Other D1 notes
- **Migrations:** they live in `server/migrations/NNNN_name.sql`. Deploy applies them with `wrangler d1 migrations apply spinlings --remote`. The Node server applies the same files at start.
- **Rate limits:**
  - Joins are counted in a D1 table keyed by a daily-salted IP hash and the hour.
  - The per-token burst limit is a best-effort in-memory bucket per Worker isolate.
  - The daily game caps are exact, because they live in player rows and are enforced through guards.
- **Challenges** are D1 rows that are consumed with a guarded delete.
- **Indexes:** matchmaking, the trade board and lookups by code or handle all have indexes.
- **Never** run a query without bound parameters, and never let a handler run more than ~20 queries.

## 17. Playing without Claude working

| Activity | Needs Claude working? |
|---|---|
| Wild encounters and catches | **Yes.** Creatures only show up while Claude's main turn runs (section 13 timing). |
| Packs charging | No. Presence counts with Claude idle or out of limits (server spacing, section 24). |
| Opening packs, team, fusion, album, recycle, craft | No |
| Trading, gifts, claims | No |
| Duels (`/spin battle`, revenge) | No; the same duel spacing applies |

### Limits
- When a rate-limit window reaches 100%, the status line reads `Claude is resting until {time} · your team is napping too`.
- There is no reward and no penalty for hitting a limit.

### Rested bonus
- After 4 or more hours with no main-thread Claude turn, for any reason, the first wild encounter after returning is guaranteed rare or better.
- It rewards breaks, never burning usage.
- The server enforces it from the player's `lastBattleAt`: the client cannot claim it.


## 18. Mythics and raised forms (runtime-generated creatures)

### Mythics: one of a kind
- **Encounter rate:** 1 in 40 wild encounters leads with a **Mythic**, a creature generated at that moment from a fresh server seed.
- **Uniqueness:** it has never existed before and never will again. Each one has its own:
  - parts-based body;
  - palette, from a random family;
  - name, two generated words, e.g. "Hollowmere Duskwing";
  - stats at 1.1x the legendary base.
- **Catching:** the normal catch roll applies.
- **Fleeing:** a lost or abandoned Mythic is gone forever. The band says "It vanished into the static. Nobody will ever see it again."
- **Stamps and listing:** a caught Mythic carries `Mythic · 1 of 1` and `Discovered by {handle}`. Mythics appear on a public "Mythics found" list on the landing page, showing handle and name only.
- **Data:** Mythic cards use `species: 'mythic'` with the creature's own embedded `form`, the same mechanism as fusions and drop promos. The card `form` field is `{ kind: 'fusion' | 'mythic' | 'promo', ...Form, parents?, seed?, discoveredBy?, stamp? }`: `parents` for fusions, `seed` (the parts seed) for Mythics and promos, `discoveredBy` for caught Mythics online, `stamp` for promos. It replaces the old `fusion` field.
- **Final form:** a Mythic is minted at stage 3 and never evolves (section 22). Offline Mythics are labelled `Local mythic` and make no "1 of 1" claim (section 28).
- **Rarity:** a Mythic counts as `legendary` for rarity, odds, recycling (x2) and trading, and is always foil.

### Raised forms: evolution depends on how a creature was raised
- **Tracking:** the server counts, per card and hidden from others, the battles it fought in each arena family.
- **At its first evolution** (level 4), the stage-2 form takes the accessory style and a 20% hue tint of its **raising family**, the arena family it battled in most. Ties for the most, and a card that never battled, go to its own family. The card stores `raisedIn: Family`, fixed from then on; the second evolution deepens the same look (section 22).
  - Raised at home, it wears the species accessory in its own family's style.
  - Raised away, it wears the raising family's signature accessory in that family's style: haiku leaf-bud antennae, sonnet feathered wings, opus brass horns, fable a crescent moon.
  - The tint moves the body hue 20% of the way toward the raising family's hue (35% at stage 3, section 22) but stays inside its own family's range, so families are still told apart by colour.
- **A Mythic's look:** its parts come from its own seed, at their largest, with its ears, wings, tail and head re-rolled from that seed so no two look alike. It always floats a halo (never a crown) and keeps only wings or the side spikes of a spikes accessory, so nothing pokes through the halo. It is iridescent: its head and its body sit at opposite ends of its family's band. A light aura replaces its dark outline, and a 4-point sparkle sits in two corners.
- **Result:** the same species can end up in 4 different stage-2 looks, e.g. "Opus-raised Pipmaw". The card shows `Raised under Opus` (the arena name only, never usage).

## 19. Cold start: fully playable with zero other players

| Social feature | Solo fallback (used whenever no real player fits) |
|---|---|
| Duels | **Rival trainers**: generated opponents, always labelled `Rival` with a generated name (e.g. `Rival Thistlewick`). Their team matches the player's own team power, scaled 1.0x at rating 1000 and 8% tougher per 400 rating (clamped to 0.85x–1.25x), and their rating sits within 50 of the player's. Matchmaking prefers real players in the rating window; Rivals fill in otherwise. Duels against Rivals move the player's rating normally. |
| Trading | **The Wandering Trader**, a non-player trader with 3 deals a day, picked by date hash from a pool, e.g. 2 cards of one family give 1 rare of another; 1 epic gives 2 rares of the deal's family; 5 any cards give 1 pack. Each deal can be used once per day per player: it is the Trader's daily stock, a rotating shop rather than a cap on play (section 24). Deals are server-validated, take only free cards (not bound, held or trade-locked) and consume them. Offline, the Trader works the same way. |
| Trade board | Shows the Trader's deals plus real listings |
| First discoveries | Common at launch, which makes early players' First Discovered stamps permanent bragging rights |
| Gifts | The invite loop: a gift link brings a friend in |
| Leaderboard | Real players only, opt-in |

## 20. Privacy hardening (highest priority; overrides anything above that conflicts)

1. **No identity.**
   - Each player is a random token and a random generated handle (`adjective-noun-NN`, server-chosen) that bears no relation to their Claude account, email, organization, machine, OS user, session id, model or anything else.
   - The client never sends any of those. It never calls `$.session.authorize`, `$.session.id` or `$.session.repo` for the server.
   - A handle can be rerolled once a week.
2. **No work and no usage data** leaves the machine, except the `family` of a pack charge or battle. That is needed for the game, but it is never shown to anyone else, never stored longer than its pack or battle row, and battle rows are deleted 7 days after settling, leaving only aggregate counters.
3. **What other players see:**

   | Surface | Visible |
   |---|---|
   | Profile | handle, team, for-trade cards, album count, league |
   | Leaderboard | Opt-in only: handle, league, rating |
   | Defense notices | The other handle and the result, with the time rounded to "today" or "yesterday" |

   Never visible: win/loss/battle counts, join dates, last-seen, activity, the arena or model used, and timestamps.
4. **What the server stores** is minimised:
   - Day-granularity dates instead of timestamps wherever a rule allows. `last_seen` is a date.
   - Notices are deleted after 30 days, and expired offers and gifts after 30 days.
   - Challenges are deleted on use or expiry.
   - Join counters are deleted after 24 hours.
5. **IP addresses** are never stored. Join limiting uses `HMAC(SECRET, utcDate + ip)` truncated to 16 bytes, kept at most 24 hours. `SECRET` is a Worker secret.
6. **No request logging.** Cloudflare Workers observability and logpush stay off. The server logs only error codes, never URLs, bodies, tokens, handles or IPs.
7. **Deletion is total.** `DELETE /v1/me` removes the player, their cards, packs, battles, offers, gifts, notices, wishlist and firsts credit. The handle is freed after 30 days. Cards already traded away stay with their new owners.
8. **Public pages** expose only what the profile shows, and Mythic discoveries as handle plus name.
9. **CI asserts privacy:** tests fail if any response visible to another player contains a field outside the lists above, and if the client sends anything not in the documented request shapes.

## 21. UI bar: extremely intuitive, polished, consistent

**Standard:** a new player understands every screen without reading anything, and nothing looks unfinished. These rules bind every surface: band, pane, overlays, status line, pages.

### Principles
1. **One primary action per surface.** It is a `variant="primary"` Button and always hotkey `1` (or `o` in ceremonies). At most 2 secondary actions; everything else lives in the card detail.
2. **The screen answers "what can I do now?"** Every tab has a one-line hint row at the bottom, e.g. `1 Open pack · 2 Team · esc Close`. Every empty state says what will fill it ("Creatures show up while Claude works. Your first one is on its way.").
3. **Teach by doing, never by tutorial.** The first session is the onboarding: welcome pack → first encounter → first catch. A hint appears once, at the moment it matters, and never again.
4. **Chunking.** At most 4 items per group, 4 tabs, 3 choices in any picker.
5. **Plain words.** Buttons are verbs: "Open pack", "Set team", "Send offer", "Claim". No jargon in the UI: "held for this trade", not "escrow"; "resting", not "tired_until".
6. **Instant feedback.** Every press changes something visible within 100 ms (optimistic state, then reconcile with the server). Every wait over 300 ms shows a dim placeholder, never a frozen screen.
7. **Smart defaults.** The handle is pre-filled, the best pick is pre-selected in pickers, and the album opens at the count you already have, never at 0.
8. **Safety for destructive actions.** Recycle, fuse, gift, cancel and delete account need a 2-second hold, with a one-line consequence ("Pipkin will be gone. You get 25 sparks."). Nothing else asks for confirmation.
9. **Never color alone.** Rarity always shows its word or initial too, and foil and shiny show labels.

### One card component, three sizes
| Size | Used in | Contents |
|---|---|---|
| Full | Card detail, reveals | 16×16 sprite, name, rarity word and color, family mark, level and XP bar, gene score bar, traits (name and one-line effect), stamps (foil, shiny, first, mythic, raised under), origin |
| Tile | Collection grid, offers | Sprite, name (truncated with an ellipsis), rarity initial in its color, level |
| Mini | Band, battle | 8×8 sprite, name, HP bar |

The same card always looks the same everywhere: same colors, same marks, same order.

### Visual tokens (one source: `plugin/hooks/ui/tokens.ts`)
- **Rarity colors:**

  | Rarity | Color |
  |---|---|
  | common | `#9aa3ad` |
  | rare | `#4f8ff0` |
  | epic | `#b06ef3` |
  | legendary | `#f2b33d` |
  | mythic | `#ff7ac6` with a foil border |

- **Family colors:**

  | Family | Color |
  |---|---|
  | haiku | `#5fbf8f` |
  | sonnet | `#5b8def` |
  | opus | `#e8744f` |
  | fable | `#a874e8` |

- **Family marks:** single width-1 BMP glyphs, chosen once and used everywhere. No emoji in the UI.
- **Spacing:**
  - terminal: 0, 1 or 2 cells only;
  - desktop: a 4, 8, 16, 32 px scale, with larger elements getting the larger margin.
- **Text:** primary for names and values, `dimColor` for labels and hints, bold only for the single most important line of a surface.

### Layout and sizing
- **The band** fits in 40 columns at minimum, and adapts at 40, 80 and 120+ columns. It never wraps a word mid-line; long names truncate with an ellipsis.
- **The pane** works from 50 columns. Its grid tile count adapts to `bodyColumns`.
- **Pane structure:**
  - header row: the tab bar on the left, then the daily rule and pack meter on the right;
  - body;
  - hint row at the bottom.

  This is the same on every tab.
- **Parity:** the terminal and desktop show the same information in the same order. The desktop uses `Svg` art and the 4/8/16/32 spacing scale.

### Keys (identical everywhere)
| Key | Action |
|---|---|
| `1`–`4` | Switch tabs, or choose within a picker of up to 3 |
| `o` | Open |
| `f` | Flip next |
| `d` | Done |
| `t` | Set team |
| `r` | Revenge |
| `esc` | Close or go back |

A key never means two things on the same screen.

### Motion and sound
- Motion serves meaning: anticipation, then payoff (section 14). No idle wiggle on screens you are reading.
- `/spin motion off` is respected everywhere.
- Sound is off by default.

### Quality gate
- **Snapshot test.** The mod's test suite mounts every surface state at 40, 80 and 120 columns on terminal and desktop and fails on:
  - a refused tree;
  - overflow;
  - an empty-state screen with no guidance;
  - a primary action without hotkey `1`.
- **Preview.** `/spin demo` shows every state for human review.

## 22. Three evolution stages (overrides every earlier mention of stages)

| Stage | Reached | stageMult | Sprite |
|---|---|---|---|
| 1 | as minted | 1.00 | base parts, smallest torso |
| 2 | automatically at **level 4** | 1.15 | larger torso, upgraded parts, the species accessory; raised-form style (section 18) |
| 3 | automatically at **level 8** | 1.30 | largest torso, parts upgraded again, a full accessory; the raised-form tint is stronger (35%). Still a 16×16 canvas. |

- **Room to grow.** Each stage grows toward its own top row on the canvas (5, 3 and then 1), so every evolution is visibly bigger.
  - **Never smaller.** A body is never smaller than at the stage before. When the accessory it now wears needs more room, the head top rises past that row instead, staying inside the frame. To make it fit, a halo first gives up its clear row, then the accessory and the ears shrink a size.
  - **Halos.** A halo is unoutlined, so it may sit on the frame's very top row. A Mythic stops a row short of the top, which keeps room for its corner sparkles.
- **Wings stay put.** Wings keep to where they first grew: spread beside the body, or rising from behind the head.
- **Proportions.** A stage-1 creature is mostly head with big eyes; by stage 3 the body has caught up, and the eyes gain a lid at their inner corners.
- **A full accessory** is the stage-2 one made grander, with art of its own: taller horns and antennae, a jewelled crown, bigger wings, a glinting halo and more spikes. Horns, antennae and spikes also grow with the species' ear size.
- **Stage 3 unlocks one new part** the creature lacked: a tail, wings, or nub arms that start to wave.
- **One thing on the head top.** An accessory drops the ears that would pile into it or double it. For example:
  - horns replace pointed, long and nub ears;
  - antennae grow from antenna ears instead of adding a pair;
  - a crown, halo or spike frill drops crests, tufts and sprouts.
- **Keeping the ears.** Where it can, a creature keeps its ears as it grows. The accessory takes the variant that leaves them room: a narrower crown, other horn or antenna roots, a shorter frill, or a narrower halo. A pair of ears may also move one cell further out on the head. Any ear left keeps a clear gap from the accessory. A halo is a flat ring as wide as the head allows, and it floats with a clear row between it and the head wherever the frame has room.
- **Trinkets** sit relative to the head: a hat only on a bare head top, a bow or flower at the temple clear of the face, a scarf round the neck, and a gold monocle on one eye.

### Names
Each stage has its own name, and a line keeps a recognisable root as it grows, e.g. Pipkin → Pipmaw → Piptitan. No two species share any stage name in a season. Section 23 defines how the names are made.

### Which creatures evolve
| Creature | Rule |
|---|---|
| Legendaries and Mythics | **Never evolve.** They are minted directly in their single final form with stageMult 1.30, and the UI shows `Final form`. |
| Fusions | Evolve normally. A fusion's form carries three names and grows the same way. |

### Levels and evolution moments
- Levels run 1 to 10, and the XP curve is unchanged.
- Each evolution is its own ceremony (section 13), so a creature has two evolution moments in its life.
- The raising family is fixed at the first evolution and deepens at the second.

### Contract
- `Card.stage` is `1 | 2 | 3`, and `Form.names` is `[string, string, string]`.
- `ECONOMY` holds `evolveAt: [4, 8]` and `stageMult: [1, 1.15, 1.3]`.
- Starter cards begin at level 3 with 100 xp, 20 short of level 4, so the first evolution is one good battle away.

## 23. Names: pronounceable, evocative, generated (overrides the name rules in sections 4, 18 and 22)

**Goal:** every name is sayable on first sight, memorable, and sounds like its creature. Mechanical prefix-plus-suffix joins are not allowed.

### The generator (`plugin/hooks/core/names.ts`)
- **API:**
  - `speciesNames(seed, family, legendary) → [stage1, stage2, stage3]` (legendaries use only the last entry);
  - `mythicName(seed) → string`;
  - `fusionName(nameA, nameB, stage) → string`;
  - `pronounceability(name) → number` (0..1).
- **Phonotactics.** Names are built from syllables with English-friendly onsets, including clusters such as bl br cl cr dr fl fr gl gr pl pr sk sl sn sp st sw tr th sh ch. They use simple, readable vowels and digraphs, and soft codas such as n m l r s t k x ng nk sh th. There is at most one consonant cluster per syllable and never three consonants in a row. The spelling must be one a reader pronounces the same way every time.
- **Length:**

  | Stage | Syllables | Letters |
  |---|---|---|
  | 1 | 2 | 4–8 |
  | 2 | 2–3 | 5–9 |
  | 3 | 3–4 | 6–11 |
- **Meaning.** Names blend evocative roots drawn from a curated per-family pool, joined at a natural sound junction (overlapping letters where possible). The flavour comes from the sound itself:

  | Family | Roots | Sound |
  |---|---|---|
  | haiku | small, quick, light nature | soft consonants, light vowels |
  | sonnet | flowing water and air, song | liquid l, r, w and long vowels |
  | opus | stone, fire, thunder, grandeur | plosives b, d, g, k, r, open heavy vowels |
  | fable | twilight, runes, woods, mystery | th, w, gl, y and shadowed vowels |

  Root pools contain only plain English nature and whimsy words: no brands and no developer or programming words.
- **Evolution lines** share a recognisable root, while the ending changes stage by stage. Endings grow in sound weight: stage 1 is short and soft, stage 2 fuller, stage 3 grand and weighty. Endings are generated per species, not taken from a fixed shared list, so lines do not all end alike.
- **Legendaries** get stately two- or three-syllable names. **Mythics** get two pronounceable words (e.g. "Hollowmere Duskwing"). **Fusions** blend their parents' names at a natural junction.

### Quality gate
- **Best of 24.** Each species name is the best-scoring of 24 candidates by `pronounceability`. Candidates are rejected if they hit any of:
  - the profanity list, including substrings;
  - a blocklist of franchise and brand names, within edit distance 2 of any famous creature-franchise name;
  - endings that imitate a franchise, such as "-mon" or "-chu";
  - plain common English words;
  - duplicates or near-duplicates (edit distance 1) of other names in the same season.
- **Tests** generate 2,000 names and check that all of them pass the phonotactic rules and the blocklists. A preview script, `scripts/names.ts`, prints sample evolution lines per family for human review.

**Ownership note (build coordination):** `core/names.ts` is written by a dedicated naming workstream. Other engineers must not write their own name generator. Every rule that needs a name goes through one seam, `core/naming.ts`:
- `speciesNameLine` (species) calls `speciesNames`;
- `fusionNameLine` (fusions) calls `fusionLine`;
- `mythicNameFor` (Mythics) calls `mythicName`;
- `rivalName` (Rival trainers) is the seam's own.

The seam's blocklist (`isBlocked`) has the last word: a blocked species or fusion name goes back to the generator as taken, and a blocked Mythic name re-seeds. The generator names every seed and fuses any two names, so a season, fusion or Mythic never fails; no prefix-plus-suffix fallback remains. Wiring the generator in made `GENERATOR_VERSION` 2 (section 32).

## 24. No daily quotas: pace, pairs and sinks (overrides every per-day cap anywhere above)

**Principle:** regular players must never hit a wall. Abuse is bounded by **pace**, which matches the natural rhythm of honest play, **pair limits**, which only stop collusion between the same two accounts, **one-time trust gates**, and **economic sinks**. Never by "N per day".

| Old daily cap | Replacement |
|---|---|
| 20 battle starts and 12 rewarded battles a day | Removed. Every finished battle pays. Server pacing: a wild start must be at least 8 minutes after the previous wild start, a duel start at least 2 minutes after the previous duel start, plus the minimum battle duration and the one-open-battle rule (section 15). |
| 6 catches a day | Removed. Flat catch chance on every wild win. |
| 3 pack charges a day | Removed. One charge per 50 presence minutes, server spacing of at least 45 minutes, and a bank of 12 unopened packs (a storage size, not a quota: opening packs frees space). Beyond 16 charges in any rolling 24 hours, the spacing doubles ("your lamp needs sleep"). No human reaches that. |
| 1 bought pack a day | Removed. Packs cost 150 sparks each, with no limit. |
| 3 fusions a day | Removed. The 40-spark cost is the limit. |
| 10 trades and 10 offers a day | Removed. At most 20 open outgoing offers at once (anti-spam storage, not a quota). The fee stays. |
| 3 open gifts | 10 open gifts at once (storage) |
| Defense rewards 10 a day | **Pair limit:** defense sparks and rating move only for the first 3 finished duels between the same two accounts per rolling 24 hours. |
| Rating pair cap | Kept: the same pair limit as above. |
| Streak packs (max 2 a day) | Removed. Every 3rd consecutive win pays a streak pack, however close together the wins come (section 14). |
| Gift bonus packs (3 a week) | Removed. The giver's bonus pack pays only when the claimant (who joined after the gift) has finished 5 battles on 2 different days. The claimant must really play. |
| Claim attempts (5 an hour) | Kept as brute-force protection on codes, not as a game quota |
| Join and redeem limits per IP hash | Kept as anti-abuse request limits, not game quotas |
| Wandering Trader deals (each once per player per day) | Kept: the Trader's daily stock is a rotating shop, not a cap on normal play (section 19) |

### Rules this keeps
- The trust gate for trading and gifting: an online account at least 3 days old with 10 finished battles (section 30).
- Welcome-pack cards trade-locked for 7 days, and starter cards bound forever.
- Proof of work and join limits per IP hash.
- The server re-simulates every battle, makes every roll, and uses guards in every write.

### What players see
- No player-visible counters of battles, catches, packs or trades per day, and no "come back tomorrow" walls.
- The only waiting a player can meet is the natural spacing between wild encounters, which the client never asks to break, and a full pack bank, which says "Open some packs to make room".

## 25. Drops: promo codes for launch and virality

**Idea:** a drop gives everyone the **same limited creature**, which hatches with **personal DNA**, so every redeemer's copy looks different. That creates a "show me yours" moment on X.

### Data, not code
- A drop is one row in D1. The repo contains the mechanism and no codes. The schema is:
  `drops(id, code_hash, code_plain NULL, kind, reward_json, supply NULL, redeemed, per_account 1, bound, starts_at, ends_at, created_at)`.
- **Public vanity codes** (e.g. `FOUNDERS`) store `code_plain` so the drop page can show them.
- **Unique codes** store only `code_hash`: SHA-256 of the normalised code (upper case, dashes removed). They are generated with `crypto.getRandomValues` and carry at least 60 bits of entropy (e.g. `GOLDEN-7Q2M-K9XD`).
- **`reward_json`**, validated by a strict schema, is one of:
  - `{ type: "egg", promo: { seed, name, family, rarity, foil, stamp } }`: a promo species generated from `seed` with the normal parts generator, a fixed name (passed through the name blocklists), a fixed family and rarity, per-player DNA, and the stamp text such as "Founder · Oct 2026". The card is `species: 'promo'` with an embedded `form` (`kind: 'promo'`, `seed`, `stamp`, the one name at every stage). A legendary-rarity promo is a final form; any other evolves normally;
  - `{ type: "pack", family?: Family, count: 1..3 }`;
  - `{ type: "card", rarity, family? }`: a random card;
  - a combination, as an array of up to 8 of the above.

  Cards minted by a drop have origin `promo`; packs have source `promo`.
- **Bound:** public drops default to `bound: true`. A bound promo card can never be traded, gifted or recycled, so alts gain nothing tradeable. Fixed-supply drops may be tradeable.

### No admin API
- There is no admin endpoint and no admin token, so there is nothing to attack.
- Admins run `scripts/admin/drop.ts` locally:
  - `create`: interactive or flags. It previews the promo creature as a PNG and a terminal sprite, then inserts the row with `wrangler d1 execute spinlings --remote` using the admin's own Cloudflare credentials. It prints the codes once; unique codes are shown once and stored hashed.
  - `list`: drops with redemption counts and remaining supply.
  - `end`: closes a drop early.
- `scripts/admin/drop.ts --local` targets the Node server's SQLite database for testing.

### Redemption
- **`POST /v1/redeem { code }`** returns `{ cards: Card[], packs: PackView[] }`.
  - It normalises the code and looks up `code_plain`, then `code_hash`.
  - It checks the time window and supply, and that the player has not redeemed this drop before (a unique `(drop_id, player_id)`).
  - In one guarded batch it increments `redeemed` (guard: `redeemed < supply`, when a supply is set), inserts the redemption, and mints the reward.
  - Errors: `not_found` (a wrong code; the same message whether the code never existed or has expired, to avoid probing), `cap_reached` (supply gone), `conflict` (already redeemed).
  - Attempts are limited per token and per IP hash, against guessing.
- **Mod:** `/spin redeem <code>` plays the egg ceremony (wobble, crack, hatch) for eggs and the pack ceremony for packs, then offers `/spin share`.
- **Pages:** `/d/:code`, for public codes only, shows the promo creature as a silhouette, the live redemption count (an aggregate only), the remaining supply if limited, and install and redeem instructions. Unique codes have no page.
- **Privacy:** no record of who redeemed is ever exposed, only counts.

### Launch plan (suggested)
| Drop | Code | Window | Reward |
|---|---|---|---|
| Founder's Egg | `FOUNDERS` | Launch week | A bound foil promo creature with a Founder stamp, plus 1 pack |
| Golden drops | Unique codes | 100 at a time | Posted in replies; supply shown live |
| Creator codes | Per creator | Fixed supply | A creature themed for that creator |

## 26. Authorization: nobody can read or act for another player

1. **Identity comes only from the token.**
   - The server derives the caller as `players.token_hash = sha256(bearer)`.
   - No request body, path or query ever names "me" or a player id. Handles appear only as targets: an offer's `to`, a revenge, a profile lookup.
2. **Object-level checks in the same guarded batch as the change:**

   | Endpoint | Rule |
   |---|---|
   | Card actions (team, fuse, recycle, for-trade, gift) | `owner_id = caller AND state = 'owned'` |
   | `packs/open` | `owner_id = caller AND opened_at IS NULL` |
   | `battles/:id/finish`, `battles/:id/catch` | `attacker_id = caller`, unfinished (finish) or catch pending (catch) |
   | Offers: accept, decline, counter | `to_id = caller AND state = 'open'` |
   | Offers: cancel | `from_id = caller` |
   | Offers: viewing | only `from_id` or `to_id` |
   | `gifts/:code/cancel` | `giver_id = caller` |
   | `claim`, `redeem` | the caller is the recipient, never another player |
| `trader/:dealId` | every given card: `owner_id = caller AND state = 'owned'`, not bound, not trade-locked |
3. **Foreign objects return 404 `not_found`,** indistinguishable from objects that do not exist. Ids are random 128-bit (from `crypto.getRandomValues`, base32 or hex), but checks never rely on that.
4. **No private data about other players** is in any response. Other players appear only as a public profile or as a leaderboard row (opt-in), with the fields allowed by section 20, or as a handle inside your own offers, gifts and notices. There is no endpoint that lists players. Profiles are fetched by exact handle and rate-limited.
5. **No ambient authority:**
   - Auth is the `Authorization: Bearer` header only, with no cookies, so CSRF is not applicable.
   - The API sends no CORS headers.
   - HTML pages are read-only and carry no tokens.
6. **Token reset.**
   - `POST /v1/me/token` returns `{ token }`. It revokes every session of the player atomically (section 27) and issues one new one; old tokens stop working immediately.
   - The mod offers this as "Reset access" in `/spin privacy`.
   - Tokens are never logged, never included in shares or the privacy view, and never sent to any host except the configured server.
7. **Required tests:**
   - **Authorization matrix:** for every endpoint that takes an object id or code, a second player's token on the first player's object returns 404 and leaves every table unchanged.
   - **Exposure test:** every response that describes another player contains only the allowed public fields.
   - **Enumeration test:** sequential or random ids and handles reveal nothing beyond public profiles, under rate limits.

## 27. Sessions and devices (no accounts, no logins)

Section 30 removed link codes and recovery codes; a passkey is the only way to bring an online account to another computer.

### Origin
- A session token is created only by the server: 32 bytes from `crypto.getRandomValues`, encoded as base64url.
- It is returned exactly once, by `POST /v1/join` (after the proof of work), by `POST /v1/me/token`, or through the passkey sign-in poll (section 30).
- The server stores only `sha256(token)`. Possession of the token is identity.
- The mod keeps it in `$.store` and sends it only as `Authorization: Bearer` to the configured server.

### Multiple devices
- **Storage:** sessions live in their own table, `sessions(id, player_id, token_hash, created_at, last_used_day)` (section 29). A player can hold several, one per device. `last_used_day` is a date (section 20).
- **Another computer** signs in with a saved passkey (section 30) and gets its own session.
- `GET /v1/me/devices` returns `{ sessions, passkeys }`, the counts behind `Signed in on 2 devices · passkey saved ✓`.

### Reset
- `POST /v1/me/token` revokes **all** sessions and returns one new token for the caller.
- The mod shows this as "Reset access" in `/spin privacy`, behind a 2-second hold. The prompt says: "Other machines will need to sign in again."

### Deletion
`DELETE /v1/me` deletes the player's sessions and passkeys along with everything else (section 20).

## 28. Two worlds: Offline (local only) and Online (server)

| | Offline | Online |
|---|---|---|
| Network | **None, ever.** Zero requests. | The configured server only |
| Identity | none | An anonymous session token and a random handle (section 27). No personal information. |
| Storage | `$.store` on this machine only; never synced, uploaded or exported to the server | D1 on the server; the client keeps a cache |
| Randomness | `crypto.getRandomValues` in the mod | the server |
| Features | Wild encounters, catches, packs (presence), evolution, raised forms, fusion, album, daily rules, featured species, seasons, Mythics (labelled `Local mythic`, no "1 of 1" claim), Rival duels, sparks, crafting, the Wandering Trader | Everything |
| Not available | Duels with real players, trading, gifts, drops and redeem codes, leaderboards, First Discovered, public profiles, card pages | none |

### The hard rule
**Offline cards never enter the online world.** No server endpoint accepts card data, stats or rolls from a client: the server mints every online card itself. Offline shares say "offline save" and link only to the landing page. The UI never offers any import or merge path.

### Choosing a world (no wall, smart default)
- **First run** asks nothing: the world is online by default, or offline when the `world` userConfig option says so (section 34). Either way the welcome flow (section 6) starts in that world.
- **`/spin world online|offline`** switches the active world at any time. Each world keeps its own collection; switching never deletes anything. Going online for the first time creates a fresh online account with the normal starter team and welcome packs.
- **Always visible:** the pane header and the status line show the active world (`Offline` / `Online`).
- **Online-only actions in offline mode** show one line instead: `This needs the online world · [1] Join online (fresh collection) · esc Stay offline`.

### One rulebook, two backends (mod architecture)
- The mod talks to one interface, `SpinlingsApi` in `core/api.ts`: one method per operation, taking the path parameters and body fields as one object. `API_ROUTES` gives each operation's method, path, whether it needs auth and whether the offline backend implements it; `routeOf` splits a request into path and body. Requests and responses are validated by the same schemas (`REQUEST_SCHEMAS`, `RESPONSE_SCHEMAS`):
  - `RemoteBackend` is the HTTP client.
  - `LocalBackend` implements the solo subset in the mod (the operations marked `offline`) and answers the rest with `not_allowed`: pure game logic in `plugin/hooks/client/local/*.ts`, built only from the **shared core rule functions** (rolls, simulateBattle, rewards, settling a battle with `settlePlan`, applyXp, evolution, fuse, rivals, trader deals, mythics), with state persisted through callbacks that `register.tsx` backs with `$.store`.
- No game rule is written twice: if the server needs a rule the local backend also needs, it lives in core and both call it.
- The local save is versioned (`offline:v1`), kept within `$.store`'s 4 MiB with headroom (at most about 8,000 cards; beyond that the oldest commons are suggested for recycling), and deletable from `/spin privacy`.
- **Pacing offline.** The same encounter spacing applies offline, for game feel, but nothing is enforced against the player: it is their own save.

## 29. Sessions, sign-in polling and phishing defence

GitHub sign-in was withdrawn (section 30): the game never asks who you are, and nothing about GitHub is stored, sent or shown. This section keeps the pieces section 30 builds on.

### Sign-in polling
- A sign-in or passkey flow starts with an endpoint that returns `{ url, pollId }`. `pollId` is 128 random bits, lives 10 minutes and can be used once.
- The mod shows the `url` as a `Link` plus the URL as text, but only when it is on the configured server's own origin (`isOnServer`).
- The mod polls `GET /v1/auth/poll/{pollId}` every 2 seconds for up to 10 minutes. The response is `{ status: 'pending' }`, `{ status: 'added' }` once a passkey was saved, or `{ status: 'done', token, me }` exactly once after a passkey sign-in, after which the poll row is deleted.
- `/v1/auth/start` and the poll are rate-limited per IP hash.

### Sign-in phishing defence
- **The warning.** Both passkey pages say plainly: "You are signing in to Spinlings on your own computer. If someone sent you this link, close this page: continuing would give them your account." The domain is shown plainly.
- **Short life.** `pollId` and the passkey ticket live 10 minutes and can be used once.
- **New-device notice.** A sign-in that adds a session to an existing account adds a notice on the account (`kind: 'new-device'`): "A new device signed in · Reset access if this wasn't you". Existing sessions are unaffected.
- **No token in any URL or page.** The token is only ever delivered to the poll.

### Naming (applies to sections 26, 27 and 30)
- In code and UI, the server-issued credential is a **session**. The table is `sessions(id, player_id, token_hash, created_at, last_used_day)`.
- A session that goes unused for 180 days expires, and that machine joins anew or signs in with its passkey.
- UI copy: `Signed in on 2 devices · Reset access`. Players never see the token itself.

## 30. Least-suspicious auth: anonymous by default, optional passkey

**Principle:** the game never asks who you are. There is no GitHub, no email, no password and no code to remember.

### 1. Online with zero sign-up
- "Play online" silently creates an anonymous player, in the background: `GET /v1/challenge`, the proof of work (section 11), then `POST /v1/join`.
- The result is a random handle and a **session** (section 29 naming) stored in `$.store`. The UI shows nothing beyond `Welcome, brave-wren-41`.
- The join proof of work and the join limits per IP hash are back (sections 11 and 15).

### 2. Optional passkey: keep your collection, use another computer
- **When it is offered,** once, never repeated more than once a week, and always dismissible:
  - after the player's 3rd day with an online account;
  - the first time they open `/spin privacy`;
  - when they run `/spin devices`.

  The offer reads `Save your collection with a passkey · no email, no password · [1] Save · esc Later`.
- **Add a passkey** (authenticated):
  1. `POST /v1/me/passkey/start` returns `{ url, pollId }`. The URL is `{server}/passkey/add?t={ticket}`, where the ticket is single-use, lives 10 minutes, is bound to this player and stored hashed.
  2. The page calls `navigator.credentials.create` with:
     - `rp.id` = the server's registrable domain;
     - a server challenge;
     - `user.id` = 16 random bytes (never the handle or anything identifying);
     - `residentKey: "required"`, `userVerification: "preferred"`, `attestation: "none"`, `pubKeyCredParams` ES256 and RS256.
  3. The page posts the result to `POST /passkey/add/finish`.
  4. The server verifies the challenge, origin, RP id hash and flags, parses the COSE key with our own minimal CBOR decoder (no dependencies), and stores `passkeys(id, player_id, credential_id, public_key, sign_count, created_day)`.
  5. The mod's poll sees `done`.
- **Sign in on another computer** (no auth):
  1. "Sign in with a passkey" in the mod calls `POST /v1/auth/start`, which returns `{ url, pollId }` for `{server}/passkey/signin?p={pollId}`.
  2. The page calls `navigator.credentials.get`: discoverable credentials, no username, `userVerification: "preferred"`.
  3. The server verifies the assertion signature with WebCrypto (`crypto.subtle.verify`, ECDSA P-256 or RSASSA-PKCS1-v1_5), checks `signCount` monotonicity when it is non-zero, then issues a new session to the poll.
  4. The mod polls `GET /v1/auth/poll/{pollId}` (section 29) and switches to that account. The machine's previous anonymous account, if it had one and it has no passkey, stays on the server as is and can be deleted from `/spin privacy`.
- **Pages:**
  - Only the two passkey pages carry one small first-party script (`/static/passkey.js`), under CSP `script-src 'self'`. Every other page stays script-free.
  - Both pages carry the phishing warning from section 29.
  - The domain is shown plainly.
- **Devices:** `/spin devices` shows `Signed in on 2 devices · passkey saved ✓ · Reset access`. Reset access revokes every session; passkeys stay, so any machine can sign back in.
- **Losing every device without a passkey loses the online account.** The UI states this honestly next to the passkey offer.

### Stored
- **Players:** a session hash per device, and passkey credential ids with their public keys.
- **Never stored:** names, emails, GitHub or any other identity, IPs, user agents.
- **Deletion:** `DELETE /v1/me` removes sessions and passkeys.

### Removed
GitHub sign-in, link codes, recovery codes and `established`. The trust gate for trading and gifting is an online account at least 3 days old with 10 finished battles. Welcome-pack cards stay locked for 7 days.

### Domain warning
Passkeys are bound to `rp.id` forever. The production domain must be final before launch; moving later invalidates every passkey. Self-hosters use their own domain.

## 31. Production domain: spinlings.dev

- **Single origin.** The production server is `https://spinlings.dev`, served by the Worker as a Cloudflare custom domain on the account's `spinlings.dev` zone. The API, every page, the passkey pages and all share links (`/c/:id`, `/g/:code`, `/d/:code`, `/u/:handle`) live on this one origin.
- **Passkeys.** `rp.id` is `spinlings.dev`, and the passkey pages check that the origin is exactly `https://spinlings.dev` (a self-hosted server uses its own configured origin through the `ORIGIN` environment variable). This must never change.
- **The mod's default** `server_url` is `https://spinlings.dev`.
- **workers.dev is off** (`workers_dev: false`) once the custom domain serves, so there is exactly one origin.
- **`.dev` is HSTS-preloaded,** so HTTPS is mandatory, which suits passkeys.
- **Deploy.** `wrangler.jsonc` declares `routes: [{ "pattern": "spinlings.dev", "custom_domain": true }]`. If the deploy token lacks zone permission, an admin attaches the custom domain once in the dashboard: Workers, then spinlings, then Settings, then Domains & Routes.

## 32. Versioning and backward compatibility

**Constraint:** Claude Code does not auto-update plugins by default, so old mods stay in use for months. The server supports every mod version from `minClient` up. Updates never break play, and never affect Claude.

### Wire API
- **Additive within `/v1`:** new endpoints, new optional request fields (the server treats them as absent when missing), and new response fields and enum values.
- **Breaking changes** go to `/v2`, served alongside `/v1` for at least 6 months, with the sunset date announced in `GET /v1/version`.
- **Tolerant reader on the client.** Response parsing in `core/schemas.ts` checks the types of known fields but **ignores unknown keys**, which are stripped. An unknown enum value in a response maps to a safe fallback per field:
  - unknown notice kind → a generic notice line (`notice`);
  - unknown trait → shown by id with no effect line;
  - unknown origin → `unknown`;
  - and likewise: pack source → `bonus`, daily rule → `calm`, league → `Pebble`, offer state → `expired`, error code → `unavailable`, rarity → `common`, opponent kind → wild, sign-in poll status → `pending`. Families stay strict: a new family is a `/v2` change.

  Responses must never be rejected for something new.
- **Strict writer on the server.** Request parsing stays strict: unknown keys are rejected (security, section 12). A client never sends a field the server's `features` do not list.
- **Pages.** `GET /v1/cards` answers the cards oldest first, as many as fit under the mod's 256 KB cap, with `next` while more remain. The mod asks again with `?after={next}` until `next` is absent, and reads the whole list again if `version` moved between pages. It sends `after` only back to the server that gave it, so a server without pages is never asked for one.

### Version handshake
- **`GET /v1/version`** (public, cacheable for 1 hour) returns:
  `{ api: 1, server: semver, rules: int, generator: int, minClient: semver, latestClient: semver, sunset?: { api, date }, features: string[] }`
- **Every request** carries `X-Spinlings-Client: <semver>`. It is identical for everyone on that version and is not logged (section 20). The server uses it only to choose compatible behaviour, and returns `426 upgrade_required` only below `minClient`.
- **Mod behaviour:**
  - checks the version once per day while online;
  - shows `Spinlings {latest} is out · claude plugin update spinlings@spinlings` once per new version in the band (dismissible, never repeated);
  - below `minClient`: online actions are read-only with a clear one-line message; the offline world keeps working.
  - Features missing from `features` are hidden, not broken (for self-hosted servers lagging behind).
  - **Version indicator (never nags):** the pane's hint row ends in a dim `v0.1.0` where the hints leave room; hints never give way to it, and when they run long they drop whole from the middle, the `esc` item always kept. When the server names a newer release (`latestClient`, or `minClient` when only that is newer; never a pre-release) a chip `Update to 0.2.0` (`Update 0.2.0` under 60 columns) always shows; `u` opens `In a terminal: claude plugin update spinlings@spinlings` and `u` again copies it; while that is open the chip reads `Hide update`, and esc closes the row before the pane. The status line appends ` · update 0.2.0`. `/spin version` logs the mod's version, the world, and the server's host with its server, rules and generator versions, then "Up to date." or the update line. It logs `Asking {host}…` before any request, and when the server is out of reach it reports the last answer at once with its day. Offline it names no server and sends nothing.

### Numbers come from the server
- **`Card.stats`** (server-computed `Stats`) is sent on every card. `BattleCard.stats` is part of every battle setup. The client displays these and passes them to the simulator, and never recomputes stats for online cards.
- **Frozen seasons.**
  - Each season's 36 species are generated **once** by the server with the generator version current at season start, then stored (`seasons(season, generator, species_json)`).
  - They are served by `GET /v1/season/{n}` (immutable, cacheable forever).
  - Clients render online cards from this data plus the card's DNA. A generator improvement applies only to future seasons. Core keeps every frozen generator version needed by the offline world, append-only.
- **Rules version.** `core` exports `RULES_VERSION` (battle rules) and `GENERATOR_VERSION` (species generation); `BattleSetup.rules` carries the server's rules version. `FinishBattleResponse.log` carries the authoritative `BattleLog`.
  - **Rules match:** the mod simulates locally (live animation, Perfect timing).
  - **Rules mismatch:** the mod skips the live prompt, finishes with no inputs, and animates the server's `log`. That is always correct, just without Perfect timing.
- **In-flight battles** settle with the rules version stored on their battle row. The server keeps the previous rules version's simulator for at least 1 release.

### Database
- **Forward-only, expand-then-contract migrations:**
  - add columns with defaults and new tables;
  - remove or rename only in a later release, after no deployed code reads them.
- **Deploy order:** CI applies migrations, then deploys the Worker. Old code must run correctly on the new schema.

### Offline save
- `offline:v{n}` carries a format version. The mod migrates it forward on load, and never deletes or resets it.
- Offline battles use the installed mod's own rules, since nothing is shared.

### Releases
- **Semver.** The plugin's `version` is bumped on every release, and the marketplace entry points at release tags.
- **Order:** the server deploys first and the mod is released after.
- **Changelog:** `CHANGELOG.md` gets one entry per release, noting any compatibility impact.
- **Tests:** a compatibility test suite runs the current server against recorded request and response fixtures from every supported mod version, kept in `test/compat/fixtures/{version}/`.

### Offline isolation tests (part of section 28)
- **Mod:**
  - a test drives a full offline session followed by going online, and asserts that no request body or header sent by `RemoteBackend` contains any value from the offline save (card ids, DNA, names, counts);
  - the offline store and the online cache live under separate `$.store` keys and are never read by the other backend.
- **Server:**
  - a schema test asserts that no request schema in `core/schemas.ts` accepts a `Card`, `BattleCard`, `Stats`, genes, DNA or traits;
  - the only card references a client can send are ids of cards the server already owns.

## 33. Community servers

### Running one
Two supported ways, both documented in `docs/self-hosting.md`:
1. **Cloudflare:** the operator's own Worker and D1. Set `ORIGIN` and the database id in `wrangler.jsonc`, `wrangler secret put SECRET`, then `d1 migrations apply --remote`, then `deploy`, then attach a custom domain.
2. **Node 22:** `SECRET=… ORIGIN=… PORT=… node server/src/node.ts`, with one SQLite file and no `npm install`.

A `Dockerfile` is provided, built from a `node:22-alpine` image pinned by digest. It runs as a non-root user, keeps the data volume at `/data` and exposes a port; HTTPS comes from the operator's reverse proxy.

### Operator obligations, enforced by the server
- **`ORIGIN` must be https,** or `http://localhost` for development, and it is the passkey `rp.id`. The server refuses to start without `SECRET`.
- **Same privacy defaults:** no request logging, the same retention sweeps (hourly cron on Workers, an internal timer on Node).
- **Seasons, the daily rule, featured species and the roamer** come from the date, so every server shares the season calendar. Species are frozen per server at season start (section 32), using that server's generator version.
- **Drops** use `node scripts/admin/drop.ts --local --db <path>` on Node, or `--d1 <name>` on Cloudflare.

### Mod behaviour
- **`/spin server <url>`:**
  - normalises the URL to its origin (https only, except localhost);
  - fetches `GET /v1/version`;
  - shows a one-time notice for any origin other than `https://spinlings.dev`: "This is a community server run by someone else. It receives the same anonymous game data as spinlings.dev, and never anything about your work. [1] Connect · esc Cancel".
- **Online accounts are kept per server origin.** Sessions, cache and settings live under a `server:{origin}` prefix in `$.store`, so switching servers never mixes or deletes anything. `/spin server default` returns to `https://spinlings.dev`.
- **Always visible:** the pane header and the privacy view always show the active server's host.
- **No cross-server movement** of cards, accounts or ratings. Each server is a sealed world.

## 34. Zero-friction start (overrides the first-run choice in section 28)

1. **Install is one line inside Claude Code:** `/plugin install spinlings --marketplace 416rehman/spinlings`. The README also offers "just ask Claude: *install the Spinlings mod from 416rehman/spinlings*".
2. **No question at first run.**
   - The default world is **online**: anonymous, with no sign-up and nothing personal (section 30).
   - A player who wants offline from the start sets the `world` userConfig option to `offline` before first run, or switches any time with `/spin world offline`. The README states the default and the offline switch plainly.
3. **Instant payoff.**
   - On the first session start after install, the mod joins silently and the band shows `✦ A Spinling hatched! [1] Open your welcome pack`.
   - The pack ceremony plays, and the starter team is already set.
   - A one-line hint follows: `Creatures find you while Claude works · /spin to open your collection`.
   - The first wild encounter is guaranteed on Claude's first turn longer than 20 seconds.
4. **If joining fails** (no network or server down), the mod starts the welcome in the offline world instead. The band shows `Playing offline · /spin world online when you're connected`.
5. **No command needed to start playing.** `/spin` is optional.

## 35. Claude Desktop is the showcase surface

- **All launch media** (README hero, GIFs, videos, Product Hunt and X images) are captured from the **Code tab of the Claude desktop app**, running the real installed mod.
- **The desktop rendering is the most polished path.** The terminal stays fully supported, but desktop is where the game is judged:
  - **Sprites:** crisp `Svg` (`shape-rendering: crispEdges`) at 4× scale or larger in the pane, and 3× in the band.
  - **Ceremonies:** rustle, reveal flash, card flips, foil sheen, wobble beats, evolution flicker and the egg hatch are animated inside a single `Svg` per moment (`isInteractive`, SMIL and CSS keyframes, no script), so they play smoothly without per-frame redraws.
  - **Cards:** cards have rounded frames, a rarity-coloured border and a foil gradient border. Layout uses the 4/8/16/32 spacing scale, and type hierarchy follows SPEC 21.
  - **Mode safety:** everything reads well in both Claude Desktop light and dark modes.
- **Quality gate:** the mod's UI tests mount every surface state on `surface: 'desktop'` first. A desktop state may never fall back to a text-only placeholder where art is expected.

## 36. The website: creative, playful, never defensive (overrides the site copy in earlier sections)

- **No defensive copy on marketing surfaces.** The landing page, card pages, gift pages and drop pages never mention what the game does not do: no "we don't read your work", no "zero lines examined", no privacy reassurances. Privacy lives on `/privacy`, in the README and in `PRIVACY.md`, linked quietly from the footer.
- **The site is a piece of the game, not a brochure.** It must be:
  - **creative and memorable:** a strong, original art direction built on the game's own pixel creatures and world;
  - **playful:** the visitor can *do* something on the first screen, e.g. meet a wild creature generated just for them, watch it hatch, or flip a foil card;
  - **alive:** today's daily rule, the featured species and the season are part of the scene, not a list.
- **Extremely creative, full of small interactions.** Creatures react to the cursor (look at it, blink, hop or startle), grass rustles where you touch it, and a wild creature generated for this visitor waits to be met. Foil cards tilt and shimmer under the pointer, and clicking things does something delightful. The world shifts with the visitor's local time of day. Small easter eggs are welcome.
- **Allowed:**
  - First-party scripts (`script-src 'self'`, static files under `/static/`) for the interactions.
  - No third-party code, fonts, analytics or requests of any kind.
  - The page must still read correctly without scripts, respect `prefers-reduced-motion`, be keyboard accessible, and stay fast (under 200 KB of JavaScript, no layout jank).
- **Quality bar:** it has to look like a beloved indie game's site, not an AI-generated landing page. No purple gradients, no generic icon grids, no card walls of features.
