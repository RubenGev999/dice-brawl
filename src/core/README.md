# Game core

Deterministic, UI-free logic for a push-your-luck dice-fight gambling roguelike. Import everything from `src/core/index.ts`. No runtime dependencies, no `Math.random`, no `Date`, no real-time rules. Every coin amount is an integer, multipliers are integer milli units (1000 = 1.0x) and payouts use BigInt with floor.

`RULES_VERSION` is `'2.0.0-levels'`. It is also on every state as `state.rulesVersion`. Saved logs from another rules version must not be resumed.

The player has few decisions, all of them gambling decisions: bet size, roll, walk away, leave or continue after a passed checkpoint, and which upgrade to pick (or skip).

## API

```ts
const game = createGame(seed, buyIn)
game.dispatch({ type: 'bet', amount: 20 })
game.dispatch({ type: 'roll' })
game.dispatch({ type: 'walkAway' })
game.dispatch({ type: 'continue' })
game.dispatch({ type: 'leave' })
game.dispatch({ type: 'pickUpgrade', index: 0 })
game.dispatch({ type: 'skip' })
game.tick()
game.state
game.log
const resumed = createGameFromLog(seed, buyIn, game.log, game.state.tick)
replay(seed, buyIn, game.log, game.state.tick)
```

- `createGame(seed, buyIn = CONFIG.defaultBuyIn)` starts a run. `seed` is coerced to uint32. `buyIn` must be an integer `>= CONFIG.minBuyIn` (100), otherwise it throws `RangeError`. Use `isValidBuyIn(n)` first. Presets: `CONFIG.buyInPresets` = 100, 250, 500, 1000.
- `dispatch(action)` returns `false` and logs nothing when the action is invalid in the current phase. Every valid action is appended to `log` as `{ tick, action }`.
- `tick()` only increments `state.tick`. No rule reads it.
- `createGameFromLog(seed, buyIn, log, totalTicks?)` returns a live `Game` positioned after the log, ready for more `dispatch`/`tick` calls. It first checks the whole log: a tick lower than the previous entry's throws `RangeError`. It then ticks forward to each entry's tick and dispatches it; an entry the rules reject throws `Error` (a corrupted or foreign log). Entries after `totalTicks` are ignored, and it ticks up to `totalTicks` (default: the last entry's tick). Its `log` equals the applied entries, so a resumed game logs and replays exactly like the original.
- `replay(seed, buyIn, log, totalTicks?)` is `createGameFromLog(...).state`. `replay(seed, buyIn, game.log, game.state.tick)` deep-equals the live `game.state`. It now throws on a rejected entry instead of skipping it.
- `state` is an immutable snapshot rebuilt after every `dispatch`/`tick`.
- `failedCheckpointFee(bankroll)` returns the coins withheld when a run ends on a failed checkpoint.

## Phases and actions

| Phase | Valid actions | Notes |
|---|---|---|
| `bet` | `bet { amount }` | The amount is floored and clamped to `[minBet, maxBet]`, then deducted. `maxBet` is the whole bankroll on every fight. |
| `fight` | `roll`, `walkAway` | `walkAway` only when `fight.canWalkAway`: at least one exchange played and the walk-away payout is at least 1 coin. |
| `result` | `continue` | See below. |
| `checkpoint` | `continue`, `leave` | Only after a passed boss checkpoint. `leave` ends the run and cashes out the full bankroll with no fee. `continue` opens the shop. |
| `shop` | `pickUpgrade { index }`, `skip` | Pick one offer, or skip (pays nothing). Then `bet`. |
| `gameover` | none | |

```
bet -> fight -(roll...)-> result -continue-> shop -> bet                         (normal fight)
                \-walkAway-/          \-continue-> checkpoint -continue-> shop    (boss passed)
                                                             \-leave-> gameover 'left'        (no fee)
                                      \-continue-> gameover 'checkpoint'  (boss failed, fee withheld)
                                      \-continue-> gameover 'broke'       (bankroll 0 after a normal fight)
```

On `continue` from `result`:

1. `fightInStage += 1`.
2. After the boss (5th fight of the level), the checkpoint runs. If `bankroll >= target`, the level is cleared: `stagesCleared += 1`, `stage`/`level += 1`, `stageEntryBankroll = bankroll`, a new `target` is set and the phase becomes `checkpoint`. Otherwise the phase becomes `gameover` with reason `'checkpoint'`, `cashOutFee = failedCheckpointFee(bankroll)` and `cashOut = bankroll - cashOutFee` (a boss loss at 0 coins therefore ends as `'checkpoint'` with cash-out 0, not `'broke'`).
3. After a normal fight, a bankroll below 1 ends the run: `gameover`, reason `'broke'`, `cashOut` 0, `cashOutFee` 0. Owned upgrades do not matter: **pawning is gone**.
4. Otherwise the phase becomes `shop`.

Losing is final. There is no meta currency.

### Cash-out

| `gameOverReason` | `cashOut` | `cashOutFee` |
|---|---|---|
| `'checkpoint'` (failed boss checkpoint) | bankroll minus the fee | `failedCheckpointFee(bankroll)` |
| `'broke'` | 0 | 0 |
| `'left'` (left after a passed checkpoint) | the full bankroll | 0 |
| `null` (run still going) | `null` | `null` |

The fee rounds in the house's favour: `cashOut = floor(bankroll * 90 / 100)`. `state.failedCheckpointFeePercent` is always 10.

### Skip

`skip` in the shop pays **nothing**; it only declines the offers. A 0-coin skip cannot be farmed into coins, and nobody can reach the shop at 0 coins anyway (a normal-fight loss to 0 is `'broke'`).

## Levels

A level is a stage: 4 normal fights, then a boss that is the checkpoint. `state.level === state.stage`, and `state.levelInfo` describes the current level. Later levels hit harder and pay more per knockout, but the expected return per fight stays below 1.0 at every level and declines smoothly.

- Global fight index `k` (0-based) is in level `floor(k/5) + 1`; `k % 5 === 4` is the boss. `levelOfFight(k)` (alias of `stageOfFight`).
- Target: `target = max(1, entry + 1, floor(entry * (100 + g) / 100))`, with `g` the level's `targetGrowthPercent` and `entry` the bankroll the level was entered with.
- Enemy flat roll bonus (milli): `enemyBonusMilli + fightInLevel * 250`, plus `bossBonusMilli` on the boss. The fractional part is a seeded chance of +1. Brute and Mighty add +1.
- Enemy HP: `8 + enemyHpBonus + 0..2`. Tough x1.3, then boss +4, then Colossus x1.4 (floors, min 3). Intimidate cuts the result.
- KO payout: `fullKo + koBonus` (plus Finisher). Damage pays `floor(netDamage * fullKo / enemyMaxHp)`.
- Plain enemies get rarer: the `plain` trait weight is the level's `plainWeight`, the other 10 normal traits keep fixed weights (sum 12).
- Beyond level 8 the level-8 row repeats with `+400` milli enemy bonus per extra level and `+1` HP every 2 extra levels; KO multipliers and max win stay at the level-8 values.

| Level | Label | `enemyBonusMilli` | `bossBonusMilli` | HP bonus | Plain weight | KO (normal) | KO (boss) | Target |
|---|---|---|---|---|---|---|---|---|
| 1 | Easy | -370 | +270 | 0 | 6 | 1.4 + 0.2 = 1.6x | 2.0 + 0.5 = 2.5x | +4% |
| 2 | Normal | 1060 | +210 | 1 | 4 | 1.5 + 0.2 = 1.7x | 2.1 + 0.6 = 2.7x | +4% |
| 3 | Tricky | 2240 | +120 | 2 | 3 | 1.6 + 0.2 = 1.8x | 2.2 + 0.7 = 2.9x | +4% |
| 4 | Hard | 3380 | 0 | 2 | 2 | 1.7 + 0.2 = 1.9x | 2.3 + 0.8 = 3.1x | +5% |
| 5 | Brutal | 4380 | -330 | 3 | 2 | 1.8 + 0.2 = 2.0x | 2.4 + 0.9 = 3.3x | +5% |
| 6 | Savage | 5400 | -640 | 3 | 1 | 1.9 + 0.2 = 2.1x | 2.5 + 1.0 = 3.5x | +6% |
| 7 | Nightmare | 5460 | -760 | 4 | 1 | 2.0 + 0.2 = 2.2x | 2.6 + 1.1 = 3.7x | +6% |
| 8 | Abyss | 5540 | -760 | 4 | 1 | 2.1 + 0.2 = 2.3x | 2.7 + 1.2 = 3.9x | +7% |

The boss bonus offsets are negative late because a boss with +4 HP and a 3.5-3.9x KO pays far more per point of enemy bonus than a normal fight; they were calibrated separately so normal fights and bosses return the same per level.

### `levelInfo`

| Field | Meaning |
|---|---|
| `level`, `difficultyLabel` | Level number and its label (Easy ... Abyss). |
| `koMultiplier` / `koMultiplierMilli` | Normal-fight KO payout (fullKo + KO bonus, no Finisher). |
| `bossKoMultiplier` / `bossKoMultiplierMilli` | Boss KO payout. |
| `targetGrowthPercent` | The level's checkpoint growth. |
| `enemyDiceText` / `bossDiceText` | Typical enemy dice, e.g. `2d6+3` (average normal bonus, rounded; before Brute/Mighty). |
| `enemyBonusMin` / `enemyBonusMax` | Range of normal-fight base bonuses in the level. |
| `enemyHpMin` / `enemyHpMax` | Base normal HP range (before Tough/boss/Colossus/Intimidate). |
| `maxWinPerLevel` | `ko^4 * bossKo`: the most one coin bet all-in through the whole level can become. |

## Walk away

```
walkAwayPayout = floor(bet * refund) + floor(bet * multiplier * 0.5)
refund         = 30%  (CONFIG.walkAwayRefundMilli 300; Escape Rope +20% -> 50%)
keep           = 50%  (CONFIG.walkAwayKeepMilli 500)
```

- Available after the first exchange (won, lost or tied) when the payout is at least 1 coin. A won or lost fight never offers it.
- Shown live as `fight.walkAwayPayout` = `fight.walkAwayRefund` + `fight.walkAwayFromEarned`, with `fight.walkAwayRefundPercent` (30 or 50) and `fight.walkAwayKeep` (0.5). Before the first roll these show what walking would pay, but `canWalkAway` is false. `lastResult.walkAwayRefund` / `walkAwayFromEarned` hold the parts of a walk (0 for other outcomes).
- Examples at bet 100: after a lost first roll (multiplier 0) walking pays 30 (50 with Escape Rope); at multiplier 0.8x it pays 30 + 40 = 70 (90 with the Rope). A knockout on a level-1 normal enemy pays 160, a loss pays 0 (25 with Insurance).
- Walking always pays at least the loss refund: Insurance is capped at 1 copy (25%), below the 30% walk refund.
- Why 30% (the allowed band was 30-40%): tuning started at 35%. There, walking at 40% HP was the best rule at every level and walking became the default rather than a decision. At 30% the best rule changes with the level (never walking is within 0.01 of the best at level 1, walking is worth 0.1-0.3 per fight from level 4), and the escape is still much better than being knocked out.
- Escape Rope (reworked): `+20%` walk refund. It no longer converts a knockout blow into a walk.

## Fight rules

- The player has `playerBaseHp` 10 HP (+Vitality), reset every fight, and rolls 2d6. `fight.player.maxHp` is per fight.
- Each `roll`: both sides roll 2d6 plus their bonus. Order of resolution:
  1. Enemy dice, then player dice. Weighted Dice raises faces below 2 to 2 (`weightedDiceClamps`); Cursed lowers 6s to 5 (`cursedClamps`).
  2. Second Wind: if losing and a reroll is left, reroll the lowest die and keep the better.
  3. Winner: higher total. A tie is a tie, unless Tie Breaker (player hit, fixed 2 damage, beats Lucky) or Lucky (enemy hit for 1).
  4. Player crit source, in priority order: `combo` (every 2nd landed hit, x3), `doubles` (x2), `loadedDice` (total >= 9, x2), `firstBlood` (first landed hit, x2). Tie-breaker hits are not landed hits and never crit.
  5. Player hit damage: `diff * critFactor + Sharp Blade + Bloodlust (if the enemy is already wounded)`, minus Armored/Ironhide (min 1). Vampire heals; Thorny costs 1 HP (never below 1).
  6. Enemy hit damage: `diff * enemyCrit + Vicious/Executioner`, Iron Guard lowers the enemy crit factor by 1, Thick Skin subtracts 1 (min 1), then Shield blocks up to 4. Leech/Vampiric heal the enemy. Riposte: if the player survives a non-lucky loss by 3 or less, the enemy takes 1.
  7. Regenerate heals the boss by 1. The multiplier is recomputed from net damage; a knockout adds the KO bonus.
- Win: `floor(bet * multiplier)`. Loss: the Insurance refund (0 without it). Walk: see above.

### Traits (`traitText` is never empty)

Normal enemies (`normalTraitWeights(level)`): `plain` has the level's `plainWeight` (6, 4, 3, 2, 2, 1, 1, 1).

| Trait | Weight | Effect |
|---|---|---|
| `plain` | per level | Plain: no special tricks. |
| `tough` | 2 | Tough: 30% more HP. |
| `brute` | 2 | Brute: +1 to every roll. |
| `armored` | 1 | Armored: your hits deal 1 less damage (min 1). |
| `savage` | 1 | Savage: its doubles deal x3 damage. |
| `vicious` | 1 | Vicious: its hits deal +1 damage. |
| `lucky` | 1 | Lucky: it wins ties, dealing 1 damage. |
| `frenzied` (new) | 1 | Frenzied: +1 to every roll once below half HP. |
| `leech` (new) | 1 | Leech: heals 1 HP whenever it hits you. |
| `thorny` (new) | 1 | Thorny: each hit you land costs you 1 HP (never below 1). |
| `cursed` (new) | 1 | Cursed: your 6s count as 5s. |

Bosses (each weight 1):

| Trait | Effect |
|---|---|
| `enrage` | +1 to every roll once below half HP. |
| `regenerate` | Heals 1 HP after every roll it survives. |
| `ironhide` | Your hits deal 2 less damage (min 1). |
| `executioner` | Its hits deal +2 damage. |
| `colossus` (new) | 40% more HP. |
| `mighty` (new) | +1 to every roll. |
| `vampiric` (new) | Heals 2 HP whenever it hits you. |
| `crusher` (new) | Its doubles deal x3 damage. |

Live values: `enemy.currentBonus` (Enrage/Frenzied), `exchange.enemyBonusApplied`, `exchange.enemyHealed` (Regenerate/Leech/Vampiric), `exchange.thornDamage`, `exchange.cursedClamps`, `fight.player.maxFace` (5 against Cursed).

### Names and archetypes

`enemy.archetype` is one of `humanoid`, `beast`, `blob`, `skeleton`, `golem`, `caster`, `other`, from `CONFIG.archetypes` (`archetypeOf(name)`, unknown names map to `other`). The original names keep the mapping the UI already used.

- 20 normal names: Goblin, Bandit, Orc, Ghoul, Kobold (humanoid); Rat King, Wolf, Giant Spider, Harpy (beast); Slime, Ooze (blob); Skeleton, Mummy (skeleton); Troll, Mud Golem, Gargoyle (golem); Cultist, Necromancer (caster); Imp, Will-o-Wisp (other).
- 14 boss names: Goblin Warlord, Dread Knight, Ogre Chieftain, Vampire Lord (humanoid); Mire Hydra, Ember Drake (beast); Gelatinous King (blob); Bone Tyrant, The Hollow King (skeleton); Iron Golem, Stone Colossus (golem); Witch of Ash, Lich Queen (caster); The Plague Herald (other).

## Upgrades

The shop opens after every fight except a failed boss. Each fight index `k` has a seeded order of all 18 upgrades (`shopOrderForFight(seed, k)`, Fisher-Yates on the `shop` stream). Offers are that order with capped upgrades removed, first 3 kept (`shopOffersForFight(seed, k, owned)`). The order never depends on player choices. No upgrade adds a decision: every effect is automatic.

Every upgrade reports when it fires, as `{ id, text }` in one of three places:
- `fight.startTriggers` (fight start): Vitality, Intimidate.
- `exchange.upgradeTriggers` (each roll): Weighted Dice, Second Wind, Loaded Dice, Combo, First Blood, Sharp Blade, Bloodlust, Tie Breaker, Vampire, Iron Guard, Thick Skin, Shield, Riposte, Finisher (on the knockout roll).
- `lastResult.upgradeTriggers` (settlement): Finisher (coins), Insurance (coins), Escape Rope (extra coins).

Matching numeric fields on `ExchangeRecord`: `sharpBladeBonus`, `bloodlustBonus`, `weightedDiceClamps`, `thickSkinReduced`, `ironGuardReduced`, `blocked` + `blockedBy: 'shield'`, `healed`, `riposteDamage`, `tieBreak`, `rerolled`, `playerCritSource`.

| id | Name | Cap | Level 1 gain per copy | Level 2 gain per copy |
|---|---|---|---|---|
| `weightedDice` | Weighted Dice | 1 | +0.109 | +0.075 |
| `sharpBlade` | Sharp Blade | 3 | +0.112 / +0.099 / +0.072 | +0.090 / +0.073 / +0.063 |
| `secondWind` | Second Wind | 2 | +0.113 / +0.090 | +0.088 / +0.075 |
| `vitality` | Vitality | 2 | +0.130 / +0.102 | +0.113 / +0.100 |
| `shield` | Shield | 2 | +0.128 / +0.105 | +0.096 / +0.087 |
| `loadedDice` | Loaded Dice | 1 | +0.147 | +0.087 |
| `escapeRope` | Escape Rope | 1 | +0.067 | +0.084 |
| `insurance` | Insurance | 1 | +0.079 | +0.084 |
| `finisher` | Finisher | 3 | +0.104 x3 | +0.073 x3 |
| `intimidate` | Intimidate | 2 | +0.067 / +0.121 | +0.072 / +0.115 |
| `vampire` | Vampire Fang | 1 | +0.094 | +0.058 |
| `thickSkin` | Thick Skin | 2 | +0.115 / +0.101 | +0.098 / +0.097 |
| `tieBreaker` | Tie Breaker (new) | 1 | +0.074 | +0.069 |
| `firstBlood` | First Blood (new) | 1 | +0.127 | +0.072 |
| `ironGuard` | Iron Guard (new) | 1 | +0.071 | +0.066 |
| `combo` | Combo (new) | 1 | +0.164 | +0.106 |
| `riposte` | Riposte (new) | 1 | +0.096 | +0.102 |
| `bloodlust` | Bloodlust (new) | 1 | +0.118 | +0.090 |

Gain = change in return per fight from copy n given n-1 copies (`balance.test.ts`, 20000 fights per cell, common seeds). Level 1 starts from an empty build, level 2 from a random 4-upgrade base. Band target: +0.06 to +0.18.

- **Out of band:** Vampire Fang at level 2 (+0.058). Its heal is capped by max HP, so a bigger heal does not help (heal 7 measured +0.059); it is documented and the test allows 0.05 for it.
- **Escape Rope** is weakest at level 1 (+0.067) because walking is least valuable there; it grows with level.
- **Intimidate** copy 2 is worth more than copy 1 because 40% HP cuts cross more HP thresholds.

Changes in this revision: Loaded Dice crits at total 9 (was 10); Escape Rope = +20% walk refund (was: knockout becomes a walk); Insurance 25%, 1 copy (was 20%, 2 copies); Vampire Fang heals 6 (was 3). New: Tie Breaker, First Blood, Iron Guard, Combo, Riposte, Bloodlust. Rejected during tuning: a cross-fight "Momentum" upgrade (its stored bonus let players time big bets after a win: fights with it active returned 1.22-1.31, a bet-timing exploit), and "Last Stand" (bonus at low HP; it fought the walk-away decision and made walking worse than fighting).

## Determinism

- mulberry32 streams, seeded by `deriveSeed(seed, name, fightIndex)`: `enemy` (name, trait, HP, bonus fraction, in that order), `enemy-dice` (2 draws per exchange), `player-dice` (player rolls and rerolls), `shop` (offer order).
- Enemies, enemy dice and shop order for fight `k` depend only on `(seed, k)`, whatever the bets, walks or picks. The target depends on the entry bankroll, which is a player outcome.
- `replay` and `createGameFromLog` reproduce the live state exactly (`determinism.test.ts`, 8 seeds x 2 buy-ins, plus mid-fight resume, out-of-order and rejected logs).

## State fields

New or changed on `GameState`: `rulesVersion`, `level`, `levelInfo`. Removed: `skipCoins`, `pawnValue`, `canPawn`.

New or changed on `FightState`: `level`; `walkAwayRefund`, `walkAwayFromEarned`, `walkAwayRefundPercent` (with the existing `walkAwayPayout`, `walkAwayKeep` 0.5); `startTriggers`; `fullKoMultiplier`/`koBonusMultiplier`/`koPayout` are level-dependent; `status` no longer has `'escaped'`.

`fight.player`: new `maxFace`, `currentBonus`, `hitsLanded`, `walkAwayRefundPercent`; `maxHp` is per fight; `hasEscapeRope` removed.

`fight.enemy`: new `archetype`.

`ExchangeRecord`: new `playerBonusApplied`, `enemyBonusApplied`, `tieBreak`, `playerCritSource` (`'doubles' | 'loadedDice' | 'combo' | 'firstBlood' | null`), `blockedBy`, `thickSkinReduced`, `ironGuardReduced`, `sharpBladeBonus`, `bloodlustBonus`, `weightedDiceClamps`, `cursedClamps`, `thornDamage`, `riposteDamage`, `upgradeTriggers`; `escaped` removed. On a Riposte, `damageDealt` equals `riposteDamage` even though `winner` is `'enemy'`.

`FightResult` (`lastResult`): new `level`, `walkAwayRefund`, `walkAwayFromEarned`, `upgradeTriggers`; `outcome` no longer has `'escaped'`.

`Upgrade`: `pawnValue` removed (`Upgrade` is `UpgradeDef`).

## Buy-in scaling and rounding

Everything scales with `buyIn`: starting bankroll, relative targets, bet limits and presets (shares), walk-away and payouts (shares of the bet), the failed-checkpoint fee. Rounding floors in the house's favour: payouts and walk parts floor, `minBet` uses ceil, targets are at least `entry + 1`, the fee rounds up. At buy-in 100 flooring costs about 0.02 of cash-out against buy-in 1000 (see the tables).

## Tuning (`src/core/config.ts`)

| Constant | Value |
|---|---|
| `minBuyIn` / `defaultBuyIn` / `buyInPresets` | 100 / 100 / 100, 250, 500, 1000 |
| `fightsPerStage` | 5 (4 normal + boss) |
| `minBetPercent` / `maxBetPercent` / `bossMaxBetPercent` | 4 / 100 / 100 |
| `betPresetPercents` | low 10, medium 25, high 50 (fourth preset is All-in) |
| `failedCheckpointFeePercent` | 10 |
| `playerBaseHp` / `playerBaseDice` / `playerBaseBonus` | 10 / 2d6 / 0 |
| `walkAwayRefundMilli` / `walkAwayKeepMilli` | 300 / 500 |
| `critFactor` | 2 |
| `levels` | the 8-row level table above |
| `levelOverflowBonusMilli` / `levelOverflowHpEvery` | 400 / 2 |
| `enemyDice` / `enemyBaseHp` / `enemyHpSpread` / `enemyMinHp` / `bossExtraHp` | 2d6 / 8 / 2 / 3 / 4 |
| `enemyBonusStepMilli` | 250 per fight within a level |
| `enemyNames` / `bossNames` / `archetypes` | 20 / 14 / name -> archetype |
| trait constants | Tough 130%, Brute +1, Armor 1, Savage x3, Vicious +1, Lucky 1, Frenzied +1, Leech 1, Thorn 1, Cursed max face 5, Enrage +1, Regenerate 1, Ironhide 2, Executioner +2, Colossus 140%, Mighty +1, Vampiric 2, Crusher x3 |
| `upgradeEffects` | Weighted Dice +1 min face, Sharp Blade 1, Second Wind 1, Vitality 3, Shield 4, Loaded Dice 9, Escape Rope 200, Insurance 250, Finisher 300, Intimidate 20%, Vampire 6, Thick Skin 1, Tie Breaker 2, Iron Guard 1, Combo every 2nd x3, Riposte margin 3 / 1 damage, Bloodlust 2 |
| `upgradeMaxCopies` | Sharp Blade 3, Finisher 3, Second Wind / Vitality / Shield / Intimidate / Thick Skin 2, all others 1 |
| `shopOfferCount` | 3 |

Removed: `targetGrowthPercent` (now per level), the target-floor knobs, `skipPawnPermilleOfBuyIn`, `fullKoMultiplierMilli` / `koBonusMilli` / `bossFullKoMultiplierMilli` / `bossKoBonusMilli` (per level), `enemyHpPerFightMilli` and the old enemy-bonus ramp constants.

### How the levels were calibrated

`enemyBonusMilli` and `bossBonusMilli` of each level were bisected (20000 fights per evaluation, common random numbers) so that the best of three walk rules (never, walk at <= 40% HP, walk at <= 35% HP while the enemy is above 40%) with a priority build of one upgrade per fight so far returns `0.955 - 0.01 * (level - 1)` on both normal fights and the boss. Then the targets were set so the sensible bot lands its clear-rate targets.

## Balance

`__tests__/balance.test.ts` plays full seeded runs, prints every table below and asserts the targets. The default run (`npx vitest run src/core`, about 2 minutes) uses seed block A with 1500 runs per bot (4000 for sensible). `BALANCE_FULL=1` adds the large runs: 5000 runs per bot on seed block A (seeds from 0) and block B (seeds from 50,000,000), each at buy-in 100 and 1000. Split them with `-t "seed block A, buy-in"` / `-t "seed block B, buy-in"` (about 3 minutes each).

### Bots (`__tests__/bots.ts`)

All bots pick upgrades by a fixed priority (Weighted Dice, Sharp Blade, Thick Skin, Bloodlust, Shield, Intimidate, Vitality, First Blood, Second Wind, Combo, Finisher, Vampire Fang, Riposte, Iron Guard, Loaded Dice, Tie Breaker, Escape Rope, Insurance) unless they skip. Walk rules: `lowHp` = HP <= 40% of max; `aboutToLose` = HP <= 35% of max while the enemy is above 40% of its max; `emergency` = boss at 1 HP; `first` = at the first chance.

- **sensible**: the Medium preset (25%), raised to what it needs to reach the target; once at or over the target it bets the minimum on normal fights and protects the target on the boss; walks with `aboutToLose`, or on the boss when walking reaches the target; never leaves.
- **sensibleNoWalk / lowHpWalk / aboutToLose / bossEmergency**: sensible with only that walk rule (no target walk except bossEmergency).
- **fixedMedium / fixed10 / fixed20 / fixed50**: a fixed share every fight. **bossTarget**: 25%, target-aware only on the boss.
- **minBossMax / minBossMaxLeave1**: minimum on normal fights, all-in on the boss; the second leaves after level 1.
- **minSkipWalk / minSkipFail**: minimum bets, always skip the shop; walk / never walk.
- **allIn / allInWalk**: all-in every fight; never walk / `aboutToLose`.
- **timid**: sensible, but walks at the first chance. **coasting**: minimum bets.
- **leave1/2/3**: sensible, leaves after clearing level 1/2/3.
- **firstAllIn / firstAllInLeave1**: all-in on fight 1, then sensible with a 0% base share.

Columns: Cash = `cashOut / buyIn` (mean, its standard error, median). P/W = total paid out / total wagered. L1..L5 = share of runs that cleared that level. Median fights / P95 / >60 = run length. Walk share = walks / fights. Broke / Failed CP = how runs ended (the rest left).

### Return per fight by level

Calibration measurement of the current config (20000 fights per level, common seeds, best of the three walk rules): **0.956, 0.946, 0.937, 0.924, 0.914, 0.904, 0.893, 0.886** for levels 1-8 (normal fights and bosses each within 0.002 of these).

The table below is the independent check printed by the test: priority build of one upgrade per fight so far, 12000 fights per cell, different seeds, buy-in independent. "Best walker" is the best of never / lowHp / aboutToLose. It agrees with the calibration within about 0.015 but is not strictly monotone (L1->L2 rise of 0.008, L6-L8 flat); the test asserts values < 1.0, steps <= 0.12 and no rise above 0.01.

| Level | Label | Enemy | Boss | Enemy HP | KO | Boss KO | Target | Best walker | Never walk | Walk first | Max win/fight | Max win/level |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Easy | 2d6 | 2d6+1 | 8-10 | 1.6x | 2.5x | +4% | 0.950 | 0.940 | 0.441 | 3.4x | 16.38x |
| 2 | Normal | 2d6+1 | 2d6+2 | 9-11 | 1.7x | 2.7x | +4% | 0.958 | 0.942 | 0.436 | 3.6x | 22.55x |
| 3 | Tricky | 2d6+3 | 2d6+3 | 10-12 | 1.8x | 2.9x | +4% | 0.937 | 0.901 | 0.434 | 3.8x | 30.44x |
| 4 | Hard | 2d6+4 | 2d6+4 | 10-12 | 1.9x | 3.1x | +5% | 0.920 | 0.816 | 0.440 | 4x | 40.40x |
| 5 | Brutal | 2d6+5 | 2d6+5 | 11-13 | 2x | 3.3x | +5% | 0.915 | 0.721 | 0.424 | 4.2x | 52.80x |
| 6 | Savage | 2d6+6 | 2d6+6 | 11-13 | 2.1x | 3.5x | +6% | 0.901 | 0.611 | 0.560 | 4.4x | 68.07x |
| 7 | Nightmare | 2d6+6 | 2d6+6 | 12-14 | 2.2x | 3.7x | +6% | 0.901 | 0.635 | 0.589 | 4.6x | 86.67x |
| 8 | Abyss | 2d6+6 | 2d6+6 | 12-14 | 2.3x | 3.9x | +7% | 0.901 | 0.640 | 0.591 | 4.8x | 109.14x |

Max win per fight is the boss KO multiplier with 3 Finishers (`bossKo + 0.9x`); max win per level is `levelInfo.maxWinPerLevel` (no Finisher).

### Full runs (5000 runs per bot, two seed blocks)

#### Block A, buy-in 100, 5000 runs per bot

| Bot | Runs | Cash mean | SE | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 5000 | 0.644 | 0.007 | 0.590 | 0.903 | 0.670 | 0.438 | 0.281 | 0.159 | 0.089 | 10 | 30 | 0.000 | 0.363 | 0.000 | 1.000 | 0.122 |
| sensibleNoWalk | 5000 | 0.540 | 0.006 | 0.510 | 0.857 | 0.661 | 0.472 | 0.297 | 0.158 | 0.079 | 10 | 30 | 0.000 | 0.000 | 0.000 | 1.000 | 0.090 |
| lowHpWalk | 5000 | 0.680 | 0.007 | 0.630 | 0.903 | 0.567 | 0.341 | 0.210 | 0.115 | 0.059 | 10 | 30 | 0.000 | 0.502 | 0.000 | 1.000 | 0.116 |
| aboutToLose | 5000 | 0.658 | 0.007 | 0.600 | 0.905 | 0.654 | 0.419 | 0.263 | 0.145 | 0.080 | 10 | 30 | 0.000 | 0.355 | 0.000 | 1.000 | 0.131 |
| bossEmergency | 5000 | 0.525 | 0.006 | 0.510 | 0.864 | 0.742 | 0.524 | 0.336 | 0.186 | 0.094 | 15 | 30 | 0.000 | 0.047 | 0.000 | 1.000 | 0.097 |
| fixedMedium | 5000 | 0.718 | 0.007 | 0.640 | 0.912 | 0.370 | 0.132 | 0.044 | 0.012 | 0.004 | 5 | 15 | 0.000 | 0.323 | 0.000 | 1.000 | 0.090 |
| fixed20 | 5000 | 0.751 | 0.005 | 0.700 | 0.909 | 0.390 | 0.139 | 0.047 | 0.014 | 0.005 | 5 | 15 | 0.000 | 0.324 | 0.000 | 1.000 | 0.094 |
| bossTarget | 5000 | 0.672 | 0.009 | 0.600 | 0.922 | 0.548 | 0.267 | 0.117 | 0.048 | 0.018 | 10 | 20 | 0.000 | 0.324 | 0.000 | 1.000 | 0.120 |
| minBossMax | 5000 | 0.452 | 0.019 | 0.270 | 0.834 | 0.369 | 0.126 | 0.037 | 0.008 | 0.002 | 5 | 15 | 0.000 | 0.329 | 0.000 | 1.000 | 0.078 |
| minBossMaxLeave1 | 5000 | 0.827 | 0.013 | 0.440 | 0.865 | 0.369 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.307 | 0.000 | 0.631 | 0.369 |
| minSkipWalk | 5000 | 0.822 | 0.001 | 0.820 | 0.632 | 0.054 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.343 | 0.000 | 1.000 | 0.000 |
| allIn | 5000 | 0.000 | 0.000 | 0.000 | 0.932 | 0.042 | 0.000 | 0.000 | 0.000 | 0.000 | 2 | 5 | 0.000 | 0.000 | 0.922 | 0.078 | 0.000 |
| allInWalk | 5000 | 0.081 | 0.008 | 0.000 | 0.958 | 0.127 | 0.012 | 0.002 | 0.000 | 0.000 | 3 | 9 | 0.000 | 0.268 | 0.737 | 0.263 | 0.008 |
| timid | 5000 | 0.269 | 0.002 | 0.220 | 0.417 | 0.014 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.946 | 0.000 | 1.000 | 0.000 |
| coasting | 5000 | 0.864 | 0.001 | 0.860 | 0.876 | 0.203 | 0.050 | 0.016 | 0.003 | 0.001 | 5 | 15 | 0.000 | 0.293 | 0.000 | 1.000 | 0.031 |
| minSkipFail | 5000 | 0.814 | 0.001 | 0.820 | 0.611 | 0.078 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.000 | 0.000 | 1.000 | 0.000 |
| leave1 | 5000 | 0.922 | 0.005 | 1.040 | 0.925 | 0.670 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.281 | 0.000 | 0.330 | 0.670 |
| leave2 | 5000 | 0.861 | 0.007 | 0.830 | 0.925 | 0.670 | 0.438 | 0.000 | 0.000 | 0.000 | 10 | 10 | 0.000 | 0.298 | 0.000 | 0.562 | 0.451 |
| leave3 | 5000 | 0.819 | 0.008 | 0.670 | 0.927 | 0.670 | 0.438 | 0.281 | 0.000 | 0.000 | 10 | 15 | 0.000 | 0.316 | 0.000 | 0.719 | 0.312 |
| firstAllIn | 5000 | 0.766 | 0.009 | 0.990 | 0.911 | 0.542 | 0.196 | 0.067 | 0.017 | 0.005 | 10 | 20 | 0.000 | 0.316 | 0.277 | 0.723 | 0.496 |
| firstAllInLeave1 | 5000 | 0.886 | 0.010 | 1.350 | 0.919 | 0.542 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.269 | 0.277 | 0.181 | 0.542 |
| fixed10 | 5000 | 0.823 | 0.002 | 0.800 | 0.898 | 0.367 | 0.129 | 0.041 | 0.010 | 0.004 | 5 | 15 | 0.000 | 0.321 | 0.000 | 1.000 | 0.072 |
| fixed50 | 5000 | 0.512 | 0.013 | 0.360 | 0.911 | 0.307 | 0.094 | 0.026 | 0.006 | 0.001 | 5 | 15 | 0.000 | 0.317 | 0.000 | 1.000 | 0.055 |

Sensible return per fight by level (L1..L8, `-` = under 2000 fights), block A, buy-in 100: 0.925 0.924 0.933 0.868 0.896 0.833 - -.

#### Block A, buy-in 1000, 5000 runs per bot

| Bot | Runs | Cash mean | SE | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 5000 | 0.669 | 0.008 | 0.599 | 0.917 | 0.687 | 0.466 | 0.305 | 0.179 | 0.102 | 10 | 30 | 0.000 | 0.367 | 0.000 | 1.000 | 0.137 |
| sensibleNoWalk | 5000 | 0.523 | 0.006 | 0.513 | 0.860 | 0.725 | 0.517 | 0.326 | 0.173 | 0.088 | 15 | 30 | 0.000 | 0.000 | 0.000 | 1.000 | 0.103 |
| lowHpWalk | 5000 | 0.706 | 0.007 | 0.638 | 0.921 | 0.605 | 0.389 | 0.244 | 0.136 | 0.071 | 10 | 30 | 0.000 | 0.506 | 0.000 | 1.000 | 0.135 |
| aboutToLose | 5000 | 0.680 | 0.008 | 0.607 | 0.919 | 0.673 | 0.447 | 0.288 | 0.166 | 0.093 | 10 | 30 | 0.000 | 0.360 | 0.000 | 1.000 | 0.143 |
| bossEmergency | 5000 | 0.526 | 0.006 | 0.513 | 0.868 | 0.747 | 0.530 | 0.343 | 0.200 | 0.099 | 15 | 30 | 0.000 | 0.042 | 0.000 | 1.000 | 0.098 |
| fixedMedium | 5000 | 0.738 | 0.008 | 0.656 | 0.923 | 0.379 | 0.138 | 0.046 | 0.014 | 0.004 | 5 | 15 | 0.000 | 0.324 | 0.000 | 1.000 | 0.104 |
| fixed20 | 5000 | 0.771 | 0.006 | 0.707 | 0.923 | 0.405 | 0.149 | 0.051 | 0.015 | 0.005 | 5 | 20 | 0.000 | 0.326 | 0.000 | 1.000 | 0.112 |
| bossTarget | 5000 | 0.696 | 0.009 | 0.607 | 0.932 | 0.552 | 0.272 | 0.121 | 0.051 | 0.019 | 10 | 25 | 0.000 | 0.326 | 0.000 | 1.000 | 0.134 |
| minBossMax | 5000 | 0.464 | 0.020 | 0.278 | 0.838 | 0.375 | 0.129 | 0.038 | 0.008 | 0.002 | 5 | 15 | 0.000 | 0.331 | 0.000 | 1.000 | 0.079 |
| minBossMaxLeave1 | 5000 | 0.831 | 0.013 | 0.462 | 0.868 | 0.375 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.310 | 0.000 | 0.625 | 0.375 |
| minSkipWalk | 5000 | 0.839 | 0.001 | 0.843 | 0.685 | 0.074 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.346 | 0.000 | 1.000 | 0.000 |
| allIn | 5000 | 0.000 | 0.000 | 0.000 | 0.932 | 0.042 | 0.000 | 0.000 | 0.000 | 0.000 | 2 | 5 | 0.000 | 0.000 | 0.922 | 0.078 | 0.000 |
| allInWalk | 5000 | 0.082 | 0.008 | 0.000 | 0.958 | 0.129 | 0.012 | 0.002 | 0.000 | 0.000 | 3 | 9 | 0.000 | 0.269 | 0.737 | 0.263 | 0.008 |
| timid | 5000 | 0.295 | 0.002 | 0.258 | 0.440 | 0.027 | 0.001 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.946 | 0.000 | 1.000 | 0.000 |
| coasting | 5000 | 0.883 | 0.001 | 0.879 | 0.935 | 0.253 | 0.072 | 0.020 | 0.004 | 0.001 | 5 | 15 | 0.000 | 0.301 | 0.000 | 1.000 | 0.049 |
| minSkipFail | 5000 | 0.830 | 0.001 | 0.833 | 0.640 | 0.078 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.000 | 0.000 | 1.000 | 0.000 |
| leave1 | 5000 | 0.939 | 0.005 | 1.040 | 0.944 | 0.687 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.280 | 0.000 | 0.313 | 0.687 |
| leave2 | 5000 | 0.891 | 0.007 | 0.917 | 0.944 | 0.687 | 0.466 | 0.000 | 0.000 | 0.000 | 10 | 10 | 0.000 | 0.298 | 0.000 | 0.534 | 0.476 |
| leave3 | 5000 | 0.855 | 0.008 | 0.679 | 0.945 | 0.687 | 0.466 | 0.305 | 0.000 | 0.000 | 10 | 15 | 0.000 | 0.316 | 0.000 | 0.695 | 0.335 |
| firstAllIn | 5000 | 0.790 | 0.009 | 1.041 | 0.925 | 0.545 | 0.207 | 0.074 | 0.019 | 0.006 | 10 | 20 | 0.000 | 0.320 | 0.273 | 0.727 | 0.505 |
| firstAllInLeave1 | 5000 | 0.895 | 0.010 | 1.374 | 0.925 | 0.545 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.271 | 0.273 | 0.183 | 0.545 |
| fixed10 | 5000 | 0.841 | 0.003 | 0.815 | 0.924 | 0.392 | 0.142 | 0.049 | 0.014 | 0.005 | 5 | 15 | 0.000 | 0.325 | 0.000 | 1.000 | 0.103 |
| fixed50 | 5000 | 0.525 | 0.013 | 0.375 | 0.914 | 0.312 | 0.096 | 0.027 | 0.006 | 0.001 | 5 | 15 | 0.000 | 0.318 | 0.000 | 1.000 | 0.060 |

Sensible return per fight by level (L1..L8, `-` = under 2000 fights), block A, buy-in 1000: 0.944 0.944 0.950 0.886 0.914 0.842 - -.

#### Block B, buy-in 100, 5000 runs per bot

| Bot | Runs | Cash mean | SE | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 5000 | 0.638 | 0.007 | 0.590 | 0.900 | 0.660 | 0.431 | 0.272 | 0.158 | 0.085 | 10 | 30 | 0.000 | 0.362 | 0.000 | 1.000 | 0.120 |
| sensibleNoWalk | 5000 | 0.543 | 0.006 | 0.520 | 0.857 | 0.645 | 0.451 | 0.285 | 0.156 | 0.074 | 10 | 30 | 0.000 | 0.000 | 0.000 | 1.000 | 0.088 |
| lowHpWalk | 5000 | 0.682 | 0.007 | 0.630 | 0.902 | 0.565 | 0.329 | 0.201 | 0.113 | 0.059 | 10 | 30 | 0.000 | 0.501 | 0.000 | 1.000 | 0.117 |
| aboutToLose | 5000 | 0.654 | 0.007 | 0.600 | 0.903 | 0.645 | 0.411 | 0.255 | 0.146 | 0.077 | 10 | 30 | 0.000 | 0.353 | 0.000 | 1.000 | 0.130 |
| bossEmergency | 5000 | 0.520 | 0.007 | 0.510 | 0.862 | 0.735 | 0.513 | 0.329 | 0.184 | 0.090 | 15 | 30 | 0.000 | 0.048 | 0.000 | 1.000 | 0.095 |
| fixedMedium | 5000 | 0.713 | 0.007 | 0.630 | 0.910 | 0.364 | 0.136 | 0.046 | 0.016 | 0.003 | 5 | 15 | 0.000 | 0.324 | 0.000 | 1.000 | 0.090 |
| fixed20 | 5000 | 0.750 | 0.005 | 0.690 | 0.908 | 0.381 | 0.141 | 0.048 | 0.016 | 0.003 | 5 | 15 | 0.000 | 0.325 | 0.000 | 1.000 | 0.096 |
| bossTarget | 5000 | 0.666 | 0.008 | 0.590 | 0.920 | 0.543 | 0.270 | 0.122 | 0.049 | 0.015 | 10 | 20 | 0.000 | 0.324 | 0.000 | 1.000 | 0.119 |
| minBossMax | 5000 | 0.473 | 0.023 | 0.270 | 0.846 | 0.369 | 0.127 | 0.037 | 0.009 | 0.002 | 5 | 15 | 0.000 | 0.335 | 0.000 | 1.000 | 0.080 |
| minBossMaxLeave1 | 5000 | 0.832 | 0.013 | 0.440 | 0.870 | 0.369 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.308 | 0.000 | 0.631 | 0.369 |
| minSkipWalk | 5000 | 0.822 | 0.001 | 0.820 | 0.630 | 0.051 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.345 | 0.000 | 1.000 | 0.000 |
| allIn | 5000 | 0.000 | 0.000 | 0.000 | 0.960 | 0.046 | 0.003 | 0.000 | 0.000 | 0.000 | 2 | 5 | 0.000 | 0.000 | 0.920 | 0.080 | 0.000 |
| allInWalk | 5000 | 0.235 | 0.123 | 0.000 | 0.958 | 0.125 | 0.016 | 0.001 | 0.000 | 0.000 | 3 | 9 | 0.000 | 0.273 | 0.737 | 0.263 | 0.010 |
| timid | 5000 | 0.266 | 0.002 | 0.220 | 0.415 | 0.015 | 0.001 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.944 | 0.000 | 1.000 | 0.000 |
| coasting | 5000 | 0.864 | 0.001 | 0.860 | 0.877 | 0.208 | 0.051 | 0.013 | 0.003 | 0.000 | 5 | 15 | 0.000 | 0.294 | 0.000 | 1.000 | 0.033 |
| minSkipFail | 5000 | 0.813 | 0.001 | 0.820 | 0.606 | 0.073 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.000 | 0.000 | 1.000 | 0.000 |
| leave1 | 5000 | 0.921 | 0.005 | 1.040 | 0.926 | 0.660 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.282 | 0.000 | 0.340 | 0.660 |
| leave2 | 5000 | 0.867 | 0.007 | 0.810 | 0.929 | 0.660 | 0.431 | 0.000 | 0.000 | 0.000 | 10 | 10 | 0.000 | 0.299 | 0.000 | 0.569 | 0.442 |
| leave3 | 5000 | 0.811 | 0.008 | 0.650 | 0.922 | 0.660 | 0.431 | 0.272 | 0.000 | 0.000 | 10 | 15 | 0.000 | 0.317 | 0.000 | 0.728 | 0.303 |
| firstAllIn | 5000 | 0.749 | 0.009 | 0.930 | 0.899 | 0.529 | 0.189 | 0.061 | 0.016 | 0.003 | 10 | 20 | 0.000 | 0.315 | 0.288 | 0.712 | 0.486 |
| firstAllInLeave1 | 5000 | 0.868 | 0.010 | 1.050 | 0.906 | 0.529 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.272 | 0.288 | 0.183 | 0.529 |
| fixed10 | 5000 | 0.823 | 0.002 | 0.800 | 0.897 | 0.358 | 0.127 | 0.040 | 0.012 | 0.002 | 5 | 15 | 0.000 | 0.321 | 0.000 | 1.000 | 0.075 |
| fixed50 | 5000 | 0.538 | 0.019 | 0.360 | 0.920 | 0.305 | 0.094 | 0.023 | 0.006 | 0.001 | 5 | 15 | 0.000 | 0.316 | 0.000 | 1.000 | 0.062 |

Sensible return per fight by level (L1..L8, `-` = under 2000 fights), block B, buy-in 100: 0.926 0.934 0.902 0.874 0.881 0.851 - -.

#### Block B, buy-in 1000, 5000 runs per bot

| Bot | Runs | Cash mean | SE | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 5000 | 0.657 | 0.008 | 0.587 | 0.912 | 0.677 | 0.463 | 0.298 | 0.176 | 0.096 | 10 | 30 | 0.000 | 0.366 | 0.000 | 1.000 | 0.131 |
| sensibleNoWalk | 5000 | 0.527 | 0.007 | 0.513 | 0.862 | 0.713 | 0.501 | 0.320 | 0.176 | 0.085 | 15 | 30 | 0.000 | 0.000 | 0.000 | 1.000 | 0.102 |
| lowHpWalk | 5000 | 0.714 | 0.007 | 0.638 | 0.924 | 0.598 | 0.376 | 0.235 | 0.136 | 0.074 | 10 | 30 | 0.000 | 0.507 | 0.000 | 1.000 | 0.134 |
| aboutToLose | 5000 | 0.676 | 0.008 | 0.605 | 0.916 | 0.662 | 0.443 | 0.281 | 0.164 | 0.088 | 10 | 30 | 0.000 | 0.358 | 0.000 | 1.000 | 0.142 |
| bossEmergency | 5000 | 0.524 | 0.007 | 0.513 | 0.867 | 0.740 | 0.519 | 0.337 | 0.199 | 0.096 | 15 | 30 | 0.000 | 0.043 | 0.000 | 1.000 | 0.095 |
| fixedMedium | 5000 | 0.736 | 0.007 | 0.650 | 0.923 | 0.372 | 0.141 | 0.048 | 0.017 | 0.003 | 5 | 15 | 0.000 | 0.325 | 0.000 | 1.000 | 0.106 |
| fixed20 | 5000 | 0.771 | 0.006 | 0.703 | 0.924 | 0.398 | 0.151 | 0.054 | 0.018 | 0.004 | 5 | 20 | 0.000 | 0.326 | 0.000 | 1.000 | 0.115 |
| bossTarget | 5000 | 0.693 | 0.009 | 0.604 | 0.931 | 0.547 | 0.274 | 0.126 | 0.051 | 0.015 | 10 | 25 | 0.000 | 0.325 | 0.000 | 1.000 | 0.135 |
| minBossMax | 5000 | 0.487 | 0.024 | 0.278 | 0.852 | 0.376 | 0.131 | 0.039 | 0.010 | 0.002 | 5 | 15 | 0.000 | 0.338 | 0.000 | 1.000 | 0.079 |
| minBossMaxLeave1 | 5000 | 0.835 | 0.013 | 0.463 | 0.872 | 0.376 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.312 | 0.000 | 0.624 | 0.376 |
| minSkipWalk | 5000 | 0.839 | 0.001 | 0.843 | 0.684 | 0.069 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.348 | 0.000 | 1.000 | 0.000 |
| allIn | 5000 | 0.000 | 0.000 | 0.000 | 0.960 | 0.046 | 0.003 | 0.000 | 0.000 | 0.000 | 2 | 5 | 0.000 | 0.000 | 0.920 | 0.080 | 0.000 |
| allInWalk | 5000 | 0.237 | 0.123 | 0.000 | 0.959 | 0.126 | 0.016 | 0.001 | 0.000 | 0.000 | 3 | 9 | 0.000 | 0.273 | 0.738 | 0.262 | 0.010 |
| timid | 5000 | 0.291 | 0.002 | 0.258 | 0.437 | 0.027 | 0.002 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.944 | 0.000 | 1.000 | 0.000 |
| coasting | 5000 | 0.883 | 0.001 | 0.875 | 0.933 | 0.254 | 0.069 | 0.017 | 0.003 | 0.000 | 5 | 15 | 0.000 | 0.302 | 0.000 | 1.000 | 0.052 |
| minSkipFail | 5000 | 0.829 | 0.001 | 0.833 | 0.633 | 0.073 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.000 | 0.000 | 1.000 | 0.000 |
| leave1 | 5000 | 0.937 | 0.005 | 1.040 | 0.943 | 0.677 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.282 | 0.000 | 0.323 | 0.677 |
| leave2 | 5000 | 0.895 | 0.007 | 0.913 | 0.947 | 0.677 | 0.463 | 0.000 | 0.000 | 0.000 | 10 | 10 | 0.000 | 0.299 | 0.000 | 0.537 | 0.472 |
| leave3 | 5000 | 0.845 | 0.008 | 0.665 | 0.940 | 0.677 | 0.463 | 0.298 | 0.000 | 0.000 | 10 | 15 | 0.000 | 0.319 | 0.000 | 0.702 | 0.327 |
| firstAllIn | 5000 | 0.773 | 0.009 | 0.963 | 0.913 | 0.533 | 0.203 | 0.068 | 0.018 | 0.004 | 10 | 20 | 0.000 | 0.320 | 0.284 | 0.716 | 0.494 |
| firstAllInLeave1 | 5000 | 0.878 | 0.011 | 1.041 | 0.912 | 0.533 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.274 | 0.284 | 0.184 | 0.533 |
| fixed10 | 5000 | 0.841 | 0.002 | 0.812 | 0.923 | 0.385 | 0.143 | 0.050 | 0.017 | 0.003 | 5 | 15 | 0.000 | 0.325 | 0.000 | 1.000 | 0.105 |
| fixed50 | 5000 | 0.551 | 0.020 | 0.370 | 0.924 | 0.310 | 0.095 | 0.024 | 0.006 | 0.001 | 5 | 15 | 0.000 | 0.317 | 0.000 | 1.000 | 0.065 |

Sensible return per fight by level (L1..L8, `-` = under 2000 fights), block B, buy-in 1000: 0.943 0.953 0.921 0.890 0.879 0.868 - -.

### Targets

| Target | Result | Status |
|---|---|---|
| No bot's mean cash > 1.0 | highest is leave1, 0.921-0.939 | met |
| Best simple strategy in 0.90-0.97 | leave1 0.921 / 0.922 (buy-in 100), 0.937 / 0.939 (1000) | met |
| Low-risk play is not the best-paying style | coasting 0.864 / 0.883, minSkipWalk 0.82, both below leave1, leave2, firstAllInLeave1 | met |
| Sensible clears L1 60-75% | 0.660-0.687 | met |
| Sensible clears L3 25-40% | 0.272-0.305 | met |
| Sensible clears L5 8-18% | 0.085-0.102 | met |
| Median run 10-20 fights | 10 | met (at the bottom edge) |
| < 2% of runs over 60 fights | 0.000 (P95 is 30) | met |
| Low-HP walker beats its never-walk twin | lowHpWalk 0.680-0.714 vs sensibleNoWalk 0.523-0.543 | met |
| Walk-at-first-chance clearly worst | judged by P/W and against the walk family: timid has the lowest P/W of all bots (0.41-0.44) and cashes 0.266-0.295, at least 0.15 below every other walker; only allIn and allInWalk, which mostly go broke, cash less | met |
| Level return < 1.0 and declining, max step 0.12 | calibration (20000 fights, common seeds): 0.956, 0.946, 0.937, 0.924, 0.914, 0.904, 0.893, 0.886, strictly declining. Independent test check (12000 fights, other seeds): 0.950, 0.958, 0.937, 0.920, 0.915, 0.901, 0.901, 0.901 | partial: met on the calibration measurement; the test check agrees within about 0.015 but rises at L1->L2 and is flat over L6-L8 |
| Max win per fight and per level grows | 3.4x -> 4.8x per fight, 16.4x -> 109x per level | met |
| Upgrade gain +0.06..+0.18 at L1/L2 | all but Vampire Fang at L2 (+0.058) | one documented miss |

Notes:
- The sensible bot's return per fight by level is not strictly monotone (block A buy-in 100: 0.925, 0.924, 0.933, 0.868, 0.896, 0.833). It changes bet size with the target and is a survivor sample at deep levels; the controlled level curve above is the one that declines. Every value stays below 1.0 and every step is <= 0.12.
- The walk is the strongest single lever: never walking costs about 0.10-0.15 of cash-out, and at level 4+ a never-walker returns 0.82 -> 0.64 per fight against 0.92 -> 0.90 for a walker. At level 1 walking at low HP is only slightly better than fighting on, which keeps the first level simple.
- `lowHpWalk` cashes more than the sensible bot but clears fewer levels: walking early protects the bet, staying in more often reaches the target.
- Buy-in 100 pays about 0.02 less than buy-in 1000 because of payout flooring on small bets.
- Run length is short (median 10 fights) because a failed checkpoint ends the run; the clear-rate targets and the run-length target pull in opposite directions and the clear rates were prioritised.

## UI checklist (API changes)

Breaking (the UI will not compile until fixed):
1. `pawn` action, `state.canPawn`, `state.pawnValue`, `Upgrade.pawnValue`, `skipPawnValue()` are gone. Remove the pawn UI (`src/ui/app.ts` pawnModel/canPawn/pawn, `format.ts` canPawn/pawnValue, `runStore.ts` parseAction `pawn`, `effects.ts` `'pawn'` case). Old saved logs containing `pawn` will now throw in `createGameFromLog`/`replay`.
2. `state.skipCoins` is gone; `skip` pays nothing. Relabel the skip button (no coins), remove skip-coin text (`app.ts`, `format.ts`, `tutorial.ts`).
3. `'escaped'` is gone from `FightStatus`, `FightOutcome` and `ExchangeRecord.escaped`. Remove the escape branches (`effects.ts`, `fighters.ts`, `format.ts`). Escape Rope is now "+20% walk refund".
4. `fight.player.hasEscapeRope` is gone; use `fight.player.walkAwayRefundPercent` / `fight.walkAwayRefundPercent` (30 or 50).
5. `targetFloorForStage` is gone; `targetForStage(stage, entryBankroll)` now takes two arguments.
6. `getUpgrade(id)` no longer takes `buyIn`.
7. `UpgradeId` has 6 new ids (`tieBreaker`, `firstBlood`, `ironGuard`, `combo`, `riposte`, `bloodlust`); `NormalTraitId` has `frenzied`, `leech`, `thorny`, `cursed`; `BossTraitId` has `colossus`, `mighty`, `vampiric`, `crusher`. Exhaustive switches/records need entries (icons, colours, effect text).
8. `CritSource` is `'doubles' | 'loadedDice' | 'combo' | 'firstBlood'` (no `other`).

Silent behaviour changes (compile but wrong if ignored):
9. `walkAwayPayoutAt(bet, m, refundMilli?, keepMilli?)`: the third argument is now the refund, not the keep. Prefer `fight.walkAwayPayout` and its parts.
10. `fullKoMultiplierMilliFor(isBoss, level = 1)` and `koBonusMilliFor(isBoss, mods, level = 1)` default to level 1. Any UI maths built on them (for example the Finisher amount in `effects.ts`) is wrong from level 2; use `exchange.upgradeTriggers` / `lastResult.upgradeTriggers` instead.
11. `replay` and `createGameFromLog` throw on a rejected or out-of-order entry; wrap restores in try/catch and fall back to a new run.
12. Save fingerprint: store `RULES_VERSION` with saved runs and discard saves from another version (the `runStore` config fingerprint changes anyway).
13. `fight.player.maxHp` is per fight (Vitality); do not assume `CONFIG.playerBaseHp`.
14. Thorny self-damage (`exchange.thornDamage`) and Riposte damage (`exchange.riposteDamage`) are separate fields. On a Riposte `winner` is `'enemy'` but `damageDealt` is the riposte damage: animate both a hit taken and a small counter-hit.
15. Tie-breaker hits: `winner` is `'player'` with `tieBreak: true`; they are not crits and do not count towards Combo/First Blood.
16. The `'broke'` end now happens even when upgrades are owned. A boss loss at 0 coins ends as `'checkpoint'` with cash-out 0.
17. `walkAwayPayout` is non-zero before the first roll (the refund) while `canWalkAway` is false; gate the button on `canWalkAway`.

New things to show:
18. `state.level`, `state.levelInfo` (label, KO multipliers, enemy/boss dice text, HP range, target growth, `maxWinPerLevel`): a level banner, and the KO multiplier on the bet screen.
19. Walk-away breakdown: `fight.walkAwayRefund` + `fight.walkAwayFromEarned` = `fight.walkAwayPayout`; `lastResult.walkAwayRefund` / `walkAwayFromEarned` on the result screen.
20. `enemy.archetype` for the sprite mapping (replaces any name-based map; old names keep their old archetype).
21. Upgrade trigger popups: `fight.startTriggers`, `exchange.upgradeTriggers`, `lastResult.upgradeTriggers` (each `{ id, text }`).
22. Per-exchange attribution: `playerBonusApplied`, `enemyBonusApplied`, `playerCritSource`, `blockedBy`, `thickSkinReduced`, `ironGuardReduced`, `sharpBladeBonus`, `bloodlustBonus`, `weightedDiceClamps`, `cursedClamps`, `healed`, `enemyHealed`.
23. `fight.player.maxFace` (5 against Cursed), `fight.player.currentBonus`, `fight.player.hitsLanded` (Combo progress), `enemy.currentBonus` (Enrage/Frenzied).
24. New exports for UI use: `RULES_VERSION`, `createGameFromLog`, `levelInfo`, `levelDef`, `koMultiplierMilliForLevel`, `enemyBonusMilliFor`, `levelOfFight`, `archetypeOf`, `normalTraitWeights`, `walkAwayPartsAt`, `currentWalkAwayParts`, `playerCurrentBonus`, `playerMaxFace`, `resultTriggers`, types `LevelInfo`, `LevelDef`, `Archetype`, `CritSource`, `UpgradeTrigger`, `WalkAwayParts`.
