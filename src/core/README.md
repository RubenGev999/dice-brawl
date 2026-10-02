# Game core

Deterministic, UI-free logic for a push-your-luck dice-fight gambling roguelike. Import everything from `src/core/index.ts`. No runtime dependencies, no `Math.random`, no `Date`, no real-time rules. Every coin amount is an integer, multipliers are integer milli units (1000 = 1.0x) and payouts use BigInt with floor.

`RULES_VERSION` is `'2.1.0-house-edge'`. It is also on every state as `state.rulesVersion`. Saved logs from another rules version must not be resumed.

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
- `leaveFee(bankroll)` returns the coins withheld when a player leaves after a passed checkpoint (5%).

## Phases and actions

| Phase | Valid actions | Notes |
|---|---|---|
| `bet` | `bet { amount }` | The amount is floored and clamped to `[minBet, maxBet]`, then deducted. `maxBet` is the whole bankroll on every fight. |
| `fight` | `roll`, `walkAway` | `walkAway` only when `fight.canWalkAway`: at least one exchange played and the walk-away payout is at least 1 coin. |
| `result` | `continue` | See below. |
| `checkpoint` | `continue`, `leave` | Only after a passed boss checkpoint. `leave` ends the run and cashes out the bankroll minus the 5% leave fee (`state.leaveFee`). `continue` opens the shop. |
| `shop` | `pickUpgrade { index }`, `skip` | Pick one offer, or skip (pays nothing). Then `bet`. |
| `gameover` | none | |

```
bet -> fight -(roll...)-> result -continue-> shop -> bet                         (normal fight)
                \-walkAway-/          \-continue-> checkpoint -continue-> shop    (boss passed)
                                                             \-leave-> gameover 'left'        (5% leave fee)
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
| `'left'` (left after a passed checkpoint) | bankroll minus the fee | `leaveFee(bankroll)` |
| `null` (run still going) | `null` | `null` |

Both fees round in the house's favour: a failed checkpoint returns `floor(bankroll * 90 / 100)` and leaving returns `floor(bankroll * 95 / 100)` (a 1-coin bankroll leaves with 0). `state.failedCheckpointFeePercent` is 10 and `state.leaveFeePercent` is 5. During the `checkpoint` phase `state.leaveFee` is the fee leaving would cost now (0 in every other phase).

### Skip

`skip` in the shop pays **nothing**; it only declines the offers. A 0-coin skip cannot be farmed into coins, and nobody can reach the shop at 0 coins anyway (a normal-fight loss to 0 is `'broke'`).

## Levels

A level is a stage: 4 normal fights, then a boss that is the checkpoint. `state.level === state.stage`, and `state.levelInfo` describes the current level. Later levels hit harder and pay more per knockout, but the expected return per fight stays below 1.0 at every level for a player who picks upgrades well (the smart bot, see Balance), and declines with level.

- Global fight index `k` (0-based) is in level `floor(k/5) + 1`; `k % 5 === 4` is the boss. `levelOfFight(k)` (alias of `stageOfFight`).
- Target: `target = max(1, entry + 1, floor(entry * (100 + g) / 100))`, with `g` the level's `targetGrowthPercent` and `entry` the bankroll the level was entered with.
- Enemy flat roll bonus (milli): `enemyBonusMilli + fightInLevel * enemyBonusStepMilli`, plus `bossBonusMilli` on the boss, all per level. The fractional part is a seeded chance of +1. Brute and Mighty add +1.
- Enemy HP: `8 + enemyHpBonus + 0..2`. Tough x1.3, then boss +4, then Colossus x1.4 (floors, min 3). Intimidate cuts the result.
- KO payout: `fullKo + koBonus` (plus Finisher). Damage pays `floor(netDamage * fullKo / enemyMaxHp)`.
- Plain enemies get rarer: the `plain` trait weight is the level's `plainWeight`, the other 10 normal traits keep fixed weights (sum 12).
- Beyond level 8 the level-8 row repeats with `+400` milli enemy bonus per extra level and `+1` HP every 2 extra levels; KO multipliers and max win stay at the level-8 values.

| Level | Label | `enemyBonusMilli` | `enemyBonusStepMilli` | `bossBonusMilli` | HP bonus | Plain weight | KO (normal) | KO (boss) | Target |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Easy | -490 (was -370) | 370 (was 250) | +150 (was +270) | 0 | 6 | 1.4 + 0.2 = 1.6x | 2.0 + 0.5 = 2.5x | +4% |
| 2 | Normal | 1300 (was 1060) | 230 (was 250) | +240 (was +210) | 1 | 4 | 1.5 + 0.2 = 1.7x | 2.1 + 0.6 = 2.7x | +4% |
| 3 | Tricky | 2610 (was 2240) | 290 (was 250) | +10 (was +120) | 2 | 3 | 1.6 + 0.2 = 1.8x | 2.2 + 0.7 = 2.9x | +4% |
| 4 | Hard | 3960 (was 3380) | 280 (was 250) | -270 (was 0) | 2 | 2 | 1.7 + 0.2 = 1.9x | 2.3 + 0.8 = 3.1x | +5% |
| 5 | Brutal | 5070 (was 4380) | 130 (was 250) | +10 (was -330) | 3 | 2 | 1.8 + 0.2 = 2.0x | 2.4 + 0.9 = 3.3x | +5% |
| 6 | Savage | 5750 (was 5400) | 30 (was 250) | -160 (was -640) | 3 | 1 | 1.9 + 0.2 = 2.1x | 2.5 + 1.0 = 3.5x | +6% |
| 7 | Nightmare | 5830 (was 5460) | 0 (was 250) | -130 (was -760) | 4 | 1 | 2.0 + 0.2 = 2.2x | 2.6 + 1.1 = 3.7x | +6% |
| 8 | Abyss | 5840 (was 5540) | 40 (was 250) | -210 (was -760) | 4 | 1 | 2.1 + 0.2 = 2.3x | 2.7 + 1.2 = 3.9x | +7% |

The in-level step replaced the global `enemyBonusStepMilli` (250). Level 1 needs a steep step because the first upgrades are worth the most (+0.07 to +0.16 return per fight each) and a well-chosen one arrives after every fight; from level 6 builds are nearly complete, so the step is close to 0. Bonus and boss offsets were calibrated against the smart bot (see "How the levels were calibrated").

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
| `weightedDice` | Weighted Dice | 1 | +0.102 | +0.067 |
| `sharpBlade` | Sharp Blade | 3 | +0.106 / +0.094 / +0.072 | +0.084 / +0.067 / +0.061 |
| `secondWind` | Second Wind | 2 | +0.104 / +0.088 | +0.079 / +0.069 |
| `vitality` | Vitality | 2 | +0.126 / +0.096 | +0.107 / +0.096 |
| `shield` | Shield | 2 | +0.122 / +0.098 | +0.086 / +0.078 |
| `loadedDice` | Loaded Dice | 1 | +0.141 | +0.083 |
| `escapeRope` | Escape Rope | 1 | +0.069 | +0.088 |
| `insurance` | Insurance | 1 | +0.080 | +0.088 |
| `finisher` | Finisher | 3 | +0.100 x3 | +0.062 x3 |
| `intimidate` | Intimidate | 2 | +0.065 / +0.113 | +0.068 / +0.107 |
| `vampire` | Vampire Fang | 1 | +0.088 | +0.052 |
| `thickSkin` | Thick Skin | 2 | +0.109 / +0.094 | +0.092 / +0.086 |
| `tieBreaker` | Tie Breaker (new) | 1 | +0.070 | +0.067 |
| `firstBlood` | First Blood (new) | 1 | +0.121 | +0.067 |
| `ironGuard` | Iron Guard (new) | 1 | +0.069 | +0.060 |
| `combo` | Combo (new) | 1 | +0.156 | +0.097 |
| `riposte` | Riposte (new) | 1 | +0.093 | +0.097 |
| `bloodlust` | Bloodlust (new) | 1 | +0.111 | +0.084 |

Gain = change in return per fight from copy n given n-1 copies (`balance.test.ts`, 20000 fights per cell, common seeds). Level 1 starts from an empty build, level 2 from a random 4-upgrade base. Band target: +0.06 to +0.18.

- **Out of band:** Vampire Fang at level 2 (+0.052). Its heal is capped by max HP, so a bigger heal does not help (heal 7 measured +0.059); it is documented and the test allows 0.05 for it.
- **Escape Rope** is weakest at level 1 (+0.069) because walking is least valuable there; it grows with level.
- **Intimidate** copy 2 is worth more than copy 1 because 40% HP cuts cross more HP thresholds.

Changes in this revision: Loaded Dice crits at total 9 (was 10); Escape Rope = +20% walk refund (was: knockout becomes a walk); Insurance 25%, 1 copy (was 20%, 2 copies); Vampire Fang heals 6 (was 3). New: Tie Breaker, First Blood, Iron Guard, Combo, Riposte, Bloodlust. Rejected during tuning: a cross-fight "Momentum" upgrade (its stored bonus let players time big bets after a win: fights with it active returned 1.22-1.31, a bet-timing exploit), and "Last Stand" (bonus at low HP; it fought the walk-away decision and made walking worse than fighting).

## Determinism

- mulberry32 streams, seeded by `deriveSeed(seed, name, fightIndex)`: `enemy` (name, trait, HP, bonus fraction, in that order), `enemy-dice` (2 draws per exchange), `player-dice` (player rolls and rerolls), `shop` (offer order).
- Enemies, enemy dice and shop order for fight `k` depend only on `(seed, k)`, whatever the bets, walks or picks. The target depends on the entry bankroll, which is a player outcome.
- `replay` and `createGameFromLog` reproduce the live state exactly (`determinism.test.ts`, 8 seeds x 2 buy-ins, plus mid-fight resume, out-of-order and rejected logs).

## State fields

New in `2.1.0-house-edge` on `GameState`: `leaveFeePercent` (5) and `leaveFee` (the coins leaving would cost now during `checkpoint`, 0 in every other phase). `cashOutFee` is now non-zero for `'left'`.

Earlier revision: New or changed on `GameState`: `rulesVersion`, `level`, `levelInfo`. Removed: `skipCoins`, `pawnValue`, `canPawn`.

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
| `failedCheckpointFeePercent` / `leaveFeePercent` | 10 / 5 (new; leaving was free) |
| `playerBaseHp` / `playerBaseDice` / `playerBaseBonus` | 10 / 2d6 / 0 |
| `walkAwayRefundMilli` / `walkAwayKeepMilli` | 300 / 500 |
| `critFactor` | 2 |
| `levels` | the 8-row level table above; each row now has `enemyBonusStepMilli` |
| `levelOverflowBonusMilli` / `levelOverflowHpEvery` | 400 / 2 |
| `enemyDice` / `enemyBaseHp` / `enemyHpSpread` / `enemyMinHp` / `bossExtraHp` | 2d6 / 8 / 2 / 3 / 4 |
| `enemyNames` / `bossNames` / `archetypes` | 20 / 14 / name -> archetype |
| trait constants | Tough 130%, Brute +1, Armor 1, Savage x3, Vicious +1, Lucky 1, Frenzied +1, Leech 1, Thorn 1, Cursed max face 5, Enrage +1, Regenerate 1, Ironhide 2, Executioner +2, Colossus 140%, Mighty +1, Vampiric 2, Crusher x3 |
| `upgradeEffects` | Weighted Dice +1 min face, Sharp Blade 1, Second Wind 1, Vitality 3, Shield 4, Loaded Dice 9, Escape Rope 200, Insurance 250, Finisher 300, Intimidate 20%, Vampire 6, Thick Skin 1, Tie Breaker 2, Iron Guard 1, Combo every 2nd x3, Riposte margin 3 / 1 damage, Bloodlust 2 |
| `upgradeMaxCopies` | Sharp Blade 3, Finisher 3, Second Wind / Vitality / Shield / Intimidate / Thick Skin 2, all others 1 |
| `shopOfferCount` | 3 |

Removed in this revision: the global `enemyBonusStepMilli` (now per level). Removed earlier: `targetGrowthPercent` (now per level), the target-floor knobs, `skipPawnPermilleOfBuyIn`, `fullKoMultiplierMilli` / `koBonusMilli` / `bossFullKoMultiplierMilli` / `bossKoBonusMilli` (per level), `enemyHpPerFightMilli` and the old enemy-bonus ramp constants.

### How the levels were calibrated

The previous ramp was calibrated against the priority-build bot. A smart player (see "Smart bot" below) beat it: mean cash-out 1.05-1.08 of the buy-in, and the per-slot fixed-bet return with a smart shop reached 1.09 at level 1 and 1.10 on average at level 3. This revision recalibrates against the smart bot instead.

- Measurement: for each level and slot (4 normal fights + boss), the return per fight of a fixed bet with the smart shop (every pick before that slot, from the real seeded offers) and Monte Carlo walking, 2000 samples per slot, common random numbers between iterations (`SmartBot.slotReturns`).
- Target: `0.96 - 0.01 * (level - 1)` for every slot.
- Update: a damped fixed-point step per slot (return falls about 0.33 per +1000 milli of enemy bonus on normal fights, about 0.5 on the boss), refit to `enemyBonusMilli + fightInLevel * enemyBonusStepMilli` plus `bossBonusMilli`, iterated until every slot is within about 0.02 of its target at levels 1-6 and about 0.03 at levels 7-8.
- Level 8 was raised from the fitted 5820 to 5840 so the base bonus keeps increasing with level.
- Targets, KO multipliers, HP and walk-away constants were not changed.

## Smart bot (`__tests__/smartBot.ts`)

`SmartBot` plays like a strong human with a calculator. It reads only what the UI shows (bankroll, target, level, fight index, both HPs and bonuses, the offers, owned upgrades, the walk-away payout) and never the seed. Every simulation it runs uses fresh seeds derived from a hash of the visible state (`deriveSeed(hash(state), 'smart-rollout', i)`), so it is deterministic and cannot see future dice or offers.

Method:
1. **Slot distributions.** For a build, level and slot it simulates `slotN` fights of a 1-coin bet with a heuristic walk and keeps the distribution of the return multiple.
2. **Shop.** For each offer it compares the build with and without it over the next 5 fights (the boss weighted 2), with common random numbers, and picks the best gain; it skips only when nothing helps.
3. **Bet (level DP).** A dynamic programme over (fight in level, bankroll / target) on a grid of `gridStep`, with bet shares from 4% to the cap. The terminal value at the checkpoint is `bankroll * max(leave keep, value of the next level)` when the target is reached, and `bankroll * 0.9` otherwise. The value of the next level is solved the same way, recursively.
4. **Walk.** At each roll it compares the walk-away payout with `rollN` Monte Carlo rollouts of "roll, then keep fighting with the `aboutToLose` or the `lowHp` rule", and walks only when walking beats both.
5. **Checkpoint.** It continues when the value of the next level is above the 0.95 leave keep, otherwise it leaves.

Sample sizes (`SMART_SIZES`):

| Size | Fast (default) | `SMART_FULL=1` |
|---|---|---|
| `slotN` (fights per slot distribution) | 300 | 300 |
| `shopN` (fights per offer comparison) | 200 | 300 |
| `rollN` (rollouts per walk decision) | 100 | 200 |
| `gridStep` / `distStep` (DP grid, distribution bins) | 0.01 / 0.02 | 0.004 / 0.01 |
| `betSteps` | 200 | 400 |
| Runs per seed block and buy-in in the test | 1000 | 3000 |
| Slot-table samples / levels | 200 / L1-L3 | 2000 / L1-L5 |

1000 runs take about 55 s in one process at buy-in 100 (the second buy-in reuses the caches, about 5 s). The fast sizes agree with the full ones (checked during tuning on the same ramp with a 50% boss cap): block A, buy-in 100 is 0.922 (fast, 5000 runs) against 0.927 (full, 3000 runs).

A variant that also plans future upgrade picks (`growth: true`) was tried; it cashes 0.884 against 0.922 for the default (block A, buy-in 100, 2000 runs, same tuning config), so the default does not use it.

`smartA.test.ts` and `smartB.test.ts` run it on seed blocks A and B at buy-in 100 and 1000 next to leave1, firstAllInLeave1, coasting and sensible on the same seeds, and assert smart mean cash < 0.98, < 2% of runs over 60 fights and smart > leave1. `smartA.test.ts` also prints the per-slot table for levels 1-3 and asserts a mean below 1.0 over levels 1-3 and below 1.05 per level (200 samples per slot have a standard error of about 0.03 per cell).

### Smart bot results

Before (original config, same bot, 3000 runs): block A 1.055, block B 1.083 at buy-in 100.

After (5000 runs per cell):

| Block | Buy-in | Cash mean | SE | Trimmed 99% | Median | Max | Clears L1 | Leaves | Broke | Failed CP | Mean fights |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A | 100 | 0.928 | 0.010 | 0.898 | 1.040 | 5.02 | 0.608 | 0.608 | 0.065 | 0.328 | 4.86 |
| A | 1000 | 0.944 | 0.010 | 0.913 | 1.061 | 5.04 | 0.610 | 0.610 | 0.077 | 0.313 | 4.80 |
| B | 100 | 0.912 | 0.010 | 0.883 | 1.040 | 5.98 | 0.602 | 0.602 | 0.064 | 0.333 | 4.85 |
| B | 1000 | 0.923 | 0.010 | 0.892 | 1.052 | 5.99 | 0.602 | 0.602 | 0.081 | 0.318 | 4.79 |

The test-size runs (1000 runs, the exact test seeds) give 0.942 / 0.953 (block A, buy-in 100 / 1000) and 0.886 / 0.898 (block B); their standard error is about 0.022. The smart bot always leaves after level 1: with the new ramp, a level-2 entry is worth less than the 0.95 leave keep.

Per-slot fixed-bet return, smart shop + Monte Carlo walking, 2000 samples per slot (standard error about 0.01):

| Level | Slot 1 | Slot 2 | Slot 3 | Slot 4 | Boss | Mean | Before |
|---|---|---|---|---|---|---|---|
| 1 | 0.965 | 0.949 | 0.979 | 0.949 | 0.959 | 0.960 | 0.998 (max 1.093) |
| 2 | 0.963 | 0.928 | 0.968 | 0.959 | 0.970 | 0.958 | 1.038 |
| 3 | 0.958 | 0.920 | 0.946 | 0.941 | 0.922 | 0.937 | 1.103 |
| 4 | 0.934 | 0.938 | 0.919 | 0.933 | 0.938 | 0.932 | |
| 5 | 0.922 | 0.937 | 0.907 | 0.928 | 0.926 | 0.924 | |
| 6 | 0.904 | 0.917 | 0.906 | 0.915 | 0.924 | 0.913 | |
| 7 | 0.918 | 0.872 | 0.904 | 0.917 | 0.908 | 0.904 | |
| 8 | 0.887 | 0.884 | 0.858 | 0.879 | 0.874 | 0.876 | |

### Lever ablation

Each lever alone on the original config (an earlier smart bot with one walk continuation, 3000 runs, seeds 1-3000; slot table 1000 samples). Sensible = clear L1 / clear L3 / cash.

| Lever | Smart cash @100 / @1000 | Smart slot table | Sensible | leave1 | fixedMedium | Verdict |
|---|---|---|---|---|---|---|
| None (baseline) | 1.046 / 1.058 | L1 0.994, L2 1.031, L3 1.096 (max 1.125) | 0.67 / 0.28 / 0.640 | 0.923 | 0.712 | |
| Boss bet cap 50% | 1.002 / 1.017 | unchanged | 0.65 / 0.26 | 0.921 | | rejected: not needed once the ramp and leave fee are in (see below) |
| Bet cap 50% on every fight | 0.985 / 0.998 | unchanged | | | | rejected: all-in disappears, allIn never goes broke |
| L1 target growth +8% (was +4%) | 1.041 / 1.053 | unchanged | 0.59 / 0.25 | 0.915 | | rejected: little effect |
| Failed-checkpoint fee 20% (was 10%) | 1.061 / 1.060 | unchanged | cash 0.569 | 0.906 | 0.633 | rejected: smart leaves anyway |
| Leave fee 5% | 1.030 / 1.031 | unchanged | unchanged | 0.881 | | used |
| Upgrades every 2nd fight at L1 | 0.901 / 0.917 | L1 0.836, L2 0.809, L3 0.877 | 0.54 / 0.12 / 0.486 | 0.807 | 0.584 | rejected: too strong, sensible L3 collapses, adds a cadence rule |
| Walk keep 40% (was 50%) | 1.049 / 1.057 | -0.01 to -0.02 | cash 0.622 | 0.919 | 0.701 | rejected: little effect |
| Walk refund 20% (was 30%) | 1.026 / 1.029 | -0.015 to -0.025 | cash 0.572 | 0.907 | 0.678 | rejected: hurts casual play more than smart play |
| Ramp calibrated against the smart bot | 0.973 / 0.982 | L1 0.956, L2 0.960, L3 0.961 | 0.66 / 0.19 / 0.545 | 0.902 | 0.653 | used |

Combinations:

| Combination | Smart cash, block A @100 / B @100 / A @1000 / B @1000 |
|---|---|
| Ramp + boss cap | 0.975 / - / 0.985 / - |
| Ramp + leave fee | 0.928 / 0.922 / 0.939 / 0.930 |
| Ramp + leave fee + boss cap | 0.933 / 0.914 / 0.944 / 0.921 |
| Ramp recalibrated with the improved walker + leave fee + boss cap | 0.922 / 0.907 / 0.936 / 0.919 |
| **Final**: ramp recalibrated with the improved walker + leave fee (no boss cap) | 0.928 / 0.912 / 0.944 / 0.923 |

The ramp alone leaves block A at buy-in 1000 at 0.982, above the 0.98 limit, so a second lever is needed. Of the levers combined with the ramp (boss cap, leave fee), only the leave fee closes the gap: ramp + leave fee meets target 1 on every cell. A harder ramp alone was not tried; it would be expected (not measured) to push sensible clear rates down further, while the leave fee does not touch sensible, which never leaves, and also serves the leave1 target. Adding the boss cap moved the means by under 0.01 (it cut the right tail: smart max cash-out about 4x instead of 5-6x, SE 0.007 instead of 0.010) but lowered sensible clear rates by about 0.02, so it was dropped. The final config is ramp + leave fee.

## Balance

`__tests__/balance.test.ts` plays full seeded runs of the simple bots, prints the tables below and asserts the targets. `smartA.test.ts` / `smartB.test.ts` run the smart bot (above). The default run (`npx vitest run src/core`, about 2.5 minutes wall time with files in parallel) uses seed block A with 1500 runs per bot (4000 for sensible) and 1000 smart runs per block and buy-in. `BALANCE_FULL=1` adds the large runs: 5000 runs per bot on seed block A (seeds from 0) and block B (seeds from 50,000,000), each at buy-in 100 and 1000. Split them with `-t "seed block A, buy-in 100\b"` and so on (about 80 s each). `SMART_FULL=1` switches the smart bot to the full sizes and raises the smart test timeouts to 4 hours; expect roughly 1-2 hours per seed-block file in one process (estimated from the parallel harness timings, not measured under vitest).

### Bots (`__tests__/bots.ts`)

All simple bots pick upgrades by a fixed priority (Weighted Dice, Sharp Blade, Thick Skin, Bloodlust, Shield, Intimidate, Vitality, First Blood, Second Wind, Combo, Finisher, Vampire Fang, Riposte, Iron Guard, Loaded Dice, Tie Breaker, Escape Rope, Insurance) unless they skip. Walk rules: `lowHp` = HP <= 40% of max; `aboutToLose` = HP <= 35% of max while the enemy is above 40% of its max; `emergency` = boss at 1 HP; `first` = at the first chance.

- **smart** (`smartBot.ts`): see "Smart bot".
- **sensible**: the Medium preset (25%), raised to what it needs to reach the target; once at or over the target it bets the minimum on normal fights and protects the target on the boss; walks with `aboutToLose`, or on the boss when walking reaches the target; never leaves.
- **sensibleNoWalk / lowHpWalk / aboutToLose / bossEmergency**: sensible with only that walk rule (no target walk except bossEmergency).
- **fixedMedium / fixed10 / fixed20 / fixed50**: a fixed share every fight. **bossTarget**: 25%, target-aware only on the boss.
- **minBossMax / minBossMaxLeave1**: minimum on normal fights, maximum on the boss; the second leaves after level 1.
- **minSkipWalk / minSkipFail**: minimum bets, always skip the shop; walk / never walk.
- **allIn / allInWalk**: all-in every fight; never walk / `aboutToLose`.
- **timid**: sensible, but walks at the first chance. **coasting**: minimum bets.
- **leave1/2/3**: sensible, leaves after clearing level 1/2/3.
- **firstAllIn / firstAllInLeave1**: all-in on fight 1, then sensible with a 0% base share.

Style groups used below: casual = fixedMedium, sensible; greedy = fixed50, firstAllIn, allInWalk; leaver = leave1; walk-first = timid; all-in = allIn.

Columns: Cash = `cashOut / buyIn` (mean, its standard error, the mean without the top 1% of runs, median). P/W = total paid out / total wagered. L1..L5 = share of runs that cleared that level. Median fights / P95 / >60 = run length. Walk share = walks / fights. Broke / Failed CP = how runs ended (the rest left).

### Return per fight by level (priority build)

Printed by the test: priority build of one upgrade per fight so far, fixed bet, 12000 fights per cell, buy-in independent. "Best walker" is the best of never / lowHp / aboutToLose.

| Level | Label | Enemy | Boss | Enemy HP | KO | Boss KO | Target | Best walker | Never walk | Walk first | Max win/fight | Max win/level |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Easy | 2d6 | 2d6+1 | 8-10 | 1.6x | 2.5x | +4% | 0.906 | 0.890 | 0.436 | 3.4x | 16.38x |
| 2 | Normal | 2d6+2 | 2d6+2 | 9-11 | 1.7x | 2.7x | +4% | 0.869 | 0.836 | 0.424 | 3.6x | 22.55x |
| 3 | Tricky | 2d6+3 | 2d6+4 | 10-12 | 1.8x | 2.9x | +4% | 0.773 | 0.674 | 0.408 | 3.8x | 30.44x |
| 4 | Hard | 2d6+4 | 2d6+5 | 10-12 | 1.9x | 3.1x | +5% | 0.699 | 0.519 | 0.403 | 4x | 40.40x |
| 5 | Brutal | 2d6+5 | 2d6+6 | 11-13 | 2x | 3.3x | +5% | 0.705 | 0.470 | 0.396 | 4.2x | 52.80x |
| 6 | Savage | 2d6+6 | 2d6+6 | 11-13 | 2.1x | 3.5x | +6% | 0.887 | 0.591 | 0.558 | 4.4x | 68.07x |
| 7 | Nightmare | 2d6+6 | 2d6+6 | 12-14 | 2.2x | 3.7x | +6% | 0.900 | 0.633 | 0.589 | 4.6x | 86.67x |
| 8 | Abyss | 2d6+6 | 2d6+6 | 12-14 | 2.3x | 3.9x | +7% | 0.895 | 0.627 | 0.591 | 4.8x | 109.14x |

This curve is no longer the calibration target. The priority list ranks Escape Rope, Insurance and Riposte last, but they are among the best picks at levels 3-5 (+0.08 to +0.11 return per fight each for the smart shop), so the priority build falls to about 0.70 at levels 4-5 and recovers at levels 6-8, where it owns nearly everything. The test asserts every level < 1.0, no level above level 1 by more than 0.03, level 1 >= 0.88, levels 1-3 not rising, and walk-first at least 0.25 below the best walker.

Max win per fight is the boss KO multiplier with 3 Finishers (`bossKo + 0.9x`); max win per level is `levelInfo.maxWinPerLevel` (no Finisher).

### Full runs (5000 runs per bot, two seed blocks)

#### Block A, buy-in 100, 5000 runs per bot

| Bot | Runs | Cash mean | SE | Trimmed 99% | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 5000 | 0.524 | 0.005 | 0.508 | 0.530 | 0.813 | 0.651 | 0.369 | 0.177 | 0.063 | 0.024 | 10 | 25 | 0.000 | 0.365 | 0.000 | 1.000 | 0.063 |
| sensibleNoWalk | 5000 | 0.465 | 0.005 | 0.452 | 0.460 | 0.768 | 0.614 | 0.381 | 0.179 | 0.052 | 0.018 | 10 | 25 | 0.000 | 0.000 | 0.000 | 1.000 | 0.043 |
| lowHpWalk | 5000 | 0.577 | 0.004 | 0.564 | 0.570 | 0.819 | 0.542 | 0.283 | 0.130 | 0.044 | 0.013 | 10 | 20 | 0.000 | 0.510 | 0.000 | 1.000 | 0.057 |
| aboutToLose | 5000 | 0.541 | 0.005 | 0.526 | 0.540 | 0.815 | 0.632 | 0.350 | 0.163 | 0.056 | 0.020 | 10 | 25 | 0.000 | 0.356 | 0.000 | 1.000 | 0.071 |
| bossEmergency | 5000 | 0.420 | 0.005 | 0.407 | 0.440 | 0.769 | 0.724 | 0.448 | 0.215 | 0.065 | 0.021 | 10 | 25 | 0.000 | 0.051 | 0.000 | 1.000 | 0.046 |
| fixedMedium | 5000 | 0.647 | 0.004 | 0.629 | 0.610 | 0.852 | 0.324 | 0.090 | 0.016 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.329 | 0.000 | 1.000 | 0.051 |
| fixed20 | 5000 | 0.693 | 0.003 | 0.679 | 0.660 | 0.850 | 0.344 | 0.097 | 0.017 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.331 | 0.000 | 1.000 | 0.054 |
| bossTarget | 5000 | 0.548 | 0.005 | 0.531 | 0.540 | 0.843 | 0.499 | 0.204 | 0.059 | 0.010 | 0.002 | 5 | 20 | 0.000 | 0.330 | 0.000 | 1.000 | 0.057 |
| minBossMax | 5000 | 0.349 | 0.009 | 0.306 | 0.260 | 0.740 | 0.313 | 0.094 | 0.017 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.336 | 0.000 | 1.000 | 0.053 |
| minBossMaxLeave1 | 5000 | 0.702 | 0.012 | 0.682 | 0.320 | 0.783 | 0.313 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.313 | 0.000 | 0.687 | 0.285 |
| minSkipWalk | 5000 | 0.818 | 0.001 | 0.817 | 0.820 | 0.610 | 0.041 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.348 | 0.000 | 1.000 | 0.000 |
| allIn | 5000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.843 | 0.031 | 0.000 | 0.000 | 0.000 | 0.000 | 2 | 5 | 0.000 | 0.000 | 0.926 | 0.074 | 0.000 |
| allInWalk | 5000 | 0.065 | 0.005 | 0.042 | 0.000 | 0.870 | 0.105 | 0.007 | 0.000 | 0.000 | 0.000 | 3 | 8 | 0.000 | 0.273 | 0.735 | 0.265 | 0.006 |
| timid | 5000 | 0.264 | 0.002 | 0.257 | 0.220 | 0.411 | 0.012 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.946 | 0.000 | 1.000 | 0.000 |
| coasting | 5000 | 0.854 | 0.001 | 0.852 | 0.850 | 0.826 | 0.166 | 0.030 | 0.006 | 0.001 | 0.000 | 5 | 10 | 0.000 | 0.303 | 0.000 | 1.000 | 0.015 |
| minSkipFail | 5000 | 0.811 | 0.001 | 0.810 | 0.810 | 0.588 | 0.060 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.000 | 0.000 | 1.000 | 0.000 |
| leave1 | 5000 | 0.857 | 0.005 | 0.851 | 0.980 | 0.893 | 0.651 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.293 | 0.000 | 0.349 | 0.319 |
| leave2 | 5000 | 0.758 | 0.006 | 0.746 | 0.710 | 0.869 | 0.651 | 0.369 | 0.000 | 0.000 | 0.000 | 10 | 10 | 0.000 | 0.315 | 0.000 | 0.631 | 0.380 |
| leave3 | 5000 | 0.659 | 0.006 | 0.642 | 0.590 | 0.843 | 0.651 | 0.369 | 0.177 | 0.000 | 0.000 | 10 | 15 | 0.000 | 0.337 | 0.000 | 0.823 | 0.209 |
| firstAllIn | 5000 | 0.759 | 0.009 | 0.749 | 1.050 | 0.905 | 0.563 | 0.167 | 0.039 | 0.004 | 0.001 | 10 | 15 | 0.000 | 0.329 | 0.265 | 0.735 | 0.514 |
| firstAllInLeave1 | 5000 | 0.861 | 0.010 | 0.853 | 1.320 | 0.935 | 0.563 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.279 | 0.265 | 0.173 | 0.534 |
| fixed10 | 5000 | 0.796 | 0.002 | 0.790 | 0.790 | 0.842 | 0.321 | 0.088 | 0.015 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.328 | 0.000 | 1.000 | 0.038 |
| fixed50 | 5000 | 0.425 | 0.006 | 0.393 | 0.320 | 0.859 | 0.269 | 0.065 | 0.011 | 0.001 | 0.000 | 5 | 15 | 0.000 | 0.325 | 0.000 | 1.000 | 0.034 |

Sensible return per fight by level, block A, buy-in 100: 0.893 0.839 0.754 0.629 - - - -.

#### Block A, buy-in 1000, 5000 runs per bot

| Bot | Runs | Cash mean | SE | Trimmed 99% | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 5000 | 0.527 | 0.005 | 0.510 | 0.523 | 0.823 | 0.670 | 0.402 | 0.203 | 0.073 | 0.028 | 10 | 25 | 0.000 | 0.369 | 0.000 | 1.000 | 0.064 |
| sensibleNoWalk | 5000 | 0.434 | 0.005 | 0.420 | 0.459 | 0.768 | 0.691 | 0.429 | 0.200 | 0.058 | 0.020 | 10 | 25 | 0.000 | 0.000 | 0.000 | 1.000 | 0.052 |
| lowHpWalk | 5000 | 0.584 | 0.005 | 0.568 | 0.573 | 0.835 | 0.584 | 0.331 | 0.161 | 0.054 | 0.017 | 10 | 25 | 0.000 | 0.516 | 0.000 | 1.000 | 0.059 |
| aboutToLose | 5000 | 0.543 | 0.005 | 0.527 | 0.542 | 0.826 | 0.653 | 0.382 | 0.190 | 0.068 | 0.025 | 10 | 25 | 0.000 | 0.362 | 0.000 | 1.000 | 0.071 |
| bossEmergency | 5000 | 0.415 | 0.005 | 0.402 | 0.422 | 0.771 | 0.730 | 0.454 | 0.223 | 0.075 | 0.023 | 10 | 25 | 0.000 | 0.045 | 0.000 | 1.000 | 0.042 |
| fixedMedium | 5000 | 0.662 | 0.004 | 0.643 | 0.616 | 0.864 | 0.333 | 0.095 | 0.017 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.330 | 0.000 | 1.000 | 0.061 |
| fixed20 | 5000 | 0.707 | 0.004 | 0.692 | 0.671 | 0.863 | 0.357 | 0.103 | 0.018 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.332 | 0.000 | 1.000 | 0.064 |
| bossTarget | 5000 | 0.567 | 0.005 | 0.548 | 0.555 | 0.854 | 0.502 | 0.208 | 0.062 | 0.010 | 0.002 | 10 | 20 | 0.000 | 0.332 | 0.000 | 1.000 | 0.067 |
| minBossMax | 5000 | 0.358 | 0.009 | 0.315 | 0.266 | 0.744 | 0.320 | 0.096 | 0.018 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.340 | 0.000 | 1.000 | 0.054 |
| minBossMaxLeave1 | 5000 | 0.708 | 0.011 | 0.688 | 0.350 | 0.787 | 0.320 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.316 | 0.000 | 0.680 | 0.303 |
| minSkipWalk | 5000 | 0.836 | 0.001 | 0.835 | 0.834 | 0.664 | 0.056 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.350 | 0.000 | 1.000 | 0.000 |
| allIn | 5000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.843 | 0.031 | 0.000 | 0.000 | 0.000 | 0.000 | 2 | 5 | 0.000 | 0.000 | 0.926 | 0.074 | 0.000 |
| allInWalk | 5000 | 0.066 | 0.005 | 0.043 | 0.000 | 0.871 | 0.107 | 0.007 | 0.000 | 0.000 | 0.000 | 3 | 8 | 0.000 | 0.274 | 0.735 | 0.265 | 0.006 |
| timid | 5000 | 0.289 | 0.002 | 0.282 | 0.252 | 0.434 | 0.026 | 0.002 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.947 | 0.000 | 1.000 | 0.000 |
| coasting | 5000 | 0.873 | 0.001 | 0.870 | 0.870 | 0.884 | 0.212 | 0.047 | 0.007 | 0.001 | 0.000 | 5 | 10 | 0.000 | 0.309 | 0.000 | 1.000 | 0.027 |
| minSkipFail | 5000 | 0.827 | 0.001 | 0.826 | 0.833 | 0.615 | 0.060 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.000 | 0.000 | 1.000 | 0.000 |
| leave1 | 5000 | 0.877 | 0.005 | 0.871 | 0.988 | 0.913 | 0.670 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.292 | 0.000 | 0.330 | 0.397 |
| leave2 | 5000 | 0.787 | 0.006 | 0.774 | 0.750 | 0.889 | 0.670 | 0.402 | 0.000 | 0.000 | 0.000 | 10 | 10 | 0.000 | 0.316 | 0.000 | 0.598 | 0.411 |
| leave3 | 5000 | 0.683 | 0.007 | 0.665 | 0.599 | 0.859 | 0.670 | 0.402 | 0.203 | 0.000 | 0.000 | 10 | 15 | 0.000 | 0.339 | 0.000 | 0.797 | 0.230 |
| firstAllIn | 5000 | 0.784 | 0.009 | 0.774 | 1.107 | 0.919 | 0.565 | 0.177 | 0.043 | 0.004 | 0.001 | 10 | 15 | 0.000 | 0.333 | 0.261 | 0.739 | 0.526 |
| firstAllInLeave1 | 5000 | 0.873 | 0.010 | 0.864 | 1.346 | 0.941 | 0.565 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.280 | 0.261 | 0.174 | 0.534 |
| fixed10 | 5000 | 0.809 | 0.002 | 0.802 | 0.798 | 0.866 | 0.346 | 0.098 | 0.018 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.331 | 0.000 | 1.000 | 0.056 |
| fixed50 | 5000 | 0.435 | 0.006 | 0.403 | 0.331 | 0.864 | 0.275 | 0.067 | 0.011 | 0.001 | 0.000 | 5 | 15 | 0.000 | 0.325 | 0.000 | 1.000 | 0.037 |

Sensible return per fight by level, block A, buy-in 1000: 0.913 0.859 0.768 0.638 - - - -.

#### Block B, buy-in 100, 5000 runs per bot

| Bot | Runs | Cash mean | SE | Trimmed 99% | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 5000 | 0.519 | 0.005 | 0.504 | 0.520 | 0.807 | 0.634 | 0.358 | 0.166 | 0.066 | 0.024 | 10 | 25 | 0.000 | 0.365 | 0.000 | 1.000 | 0.055 |
| sensibleNoWalk | 5000 | 0.474 | 0.005 | 0.461 | 0.490 | 0.770 | 0.599 | 0.371 | 0.171 | 0.054 | 0.016 | 10 | 25 | 0.000 | 0.000 | 0.000 | 1.000 | 0.049 |
| lowHpWalk | 5000 | 0.577 | 0.005 | 0.562 | 0.570 | 0.817 | 0.539 | 0.270 | 0.121 | 0.047 | 0.017 | 10 | 20 | 0.000 | 0.510 | 0.000 | 1.000 | 0.052 |
| aboutToLose | 5000 | 0.536 | 0.005 | 0.521 | 0.540 | 0.811 | 0.617 | 0.340 | 0.156 | 0.060 | 0.021 | 10 | 25 | 0.000 | 0.357 | 0.000 | 1.000 | 0.063 |
| bossEmergency | 5000 | 0.424 | 0.005 | 0.410 | 0.440 | 0.769 | 0.714 | 0.438 | 0.205 | 0.072 | 0.021 | 10 | 25 | 0.000 | 0.051 | 0.000 | 1.000 | 0.050 |
| fixedMedium | 5000 | 0.642 | 0.004 | 0.627 | 0.610 | 0.847 | 0.319 | 0.091 | 0.014 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.332 | 0.000 | 1.000 | 0.050 |
| fixed20 | 5000 | 0.690 | 0.003 | 0.679 | 0.660 | 0.846 | 0.334 | 0.095 | 0.013 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.333 | 0.000 | 1.000 | 0.052 |
| bossTarget | 5000 | 0.544 | 0.004 | 0.528 | 0.540 | 0.839 | 0.489 | 0.199 | 0.050 | 0.014 | 0.002 | 5 | 20 | 0.000 | 0.333 | 0.000 | 1.000 | 0.054 |
| minBossMax | 5000 | 0.356 | 0.010 | 0.304 | 0.260 | 0.749 | 0.312 | 0.090 | 0.017 | 0.003 | 0.001 | 5 | 15 | 0.000 | 0.343 | 0.000 | 1.000 | 0.052 |
| minBossMaxLeave1 | 5000 | 0.701 | 0.012 | 0.681 | 0.330 | 0.782 | 0.312 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.316 | 0.000 | 0.688 | 0.286 |
| minSkipWalk | 5000 | 0.818 | 0.001 | 0.817 | 0.820 | 0.609 | 0.041 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.351 | 0.000 | 1.000 | 0.000 |
| allIn | 5000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.865 | 0.036 | 0.001 | 0.000 | 0.000 | 0.000 | 2 | 5 | 0.000 | 0.000 | 0.922 | 0.078 | 0.000 |
| allInWalk | 5000 | 0.062 | 0.004 | 0.042 | 0.000 | 0.881 | 0.104 | 0.008 | 0.000 | 0.000 | 0.000 | 3 | 8 | 0.000 | 0.281 | 0.734 | 0.266 | 0.008 |
| timid | 5000 | 0.260 | 0.002 | 0.253 | 0.210 | 0.409 | 0.013 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.945 | 0.000 | 1.000 | 0.000 |
| coasting | 5000 | 0.853 | 0.001 | 0.851 | 0.850 | 0.822 | 0.173 | 0.032 | 0.003 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.306 | 0.000 | 1.000 | 0.017 |
| minSkipFail | 5000 | 0.810 | 0.001 | 0.809 | 0.810 | 0.583 | 0.058 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.000 | 0.000 | 1.000 | 0.000 |
| leave1 | 5000 | 0.852 | 0.005 | 0.846 | 0.980 | 0.889 | 0.634 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.295 | 0.000 | 0.366 | 0.311 |
| leave2 | 5000 | 0.757 | 0.006 | 0.744 | 0.700 | 0.868 | 0.634 | 0.358 | 0.000 | 0.000 | 0.000 | 10 | 10 | 0.000 | 0.317 | 0.000 | 0.642 | 0.368 |
| leave3 | 5000 | 0.643 | 0.006 | 0.626 | 0.590 | 0.833 | 0.634 | 0.358 | 0.166 | 0.000 | 0.000 | 10 | 15 | 0.000 | 0.339 | 0.000 | 0.834 | 0.195 |
| firstAllIn | 5000 | 0.737 | 0.009 | 0.728 | 1.010 | 0.890 | 0.544 | 0.161 | 0.029 | 0.004 | 0.000 | 10 | 15 | 0.000 | 0.330 | 0.275 | 0.725 | 0.501 |
| firstAllInLeave1 | 5000 | 0.839 | 0.010 | 0.830 | 1.300 | 0.917 | 0.544 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.284 | 0.275 | 0.180 | 0.520 |
| fixed10 | 5000 | 0.795 | 0.002 | 0.790 | 0.790 | 0.838 | 0.312 | 0.085 | 0.011 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.330 | 0.000 | 1.000 | 0.038 |
| fixed50 | 5000 | 0.424 | 0.007 | 0.392 | 0.320 | 0.857 | 0.266 | 0.060 | 0.006 | 0.001 | 0.000 | 5 | 15 | 0.000 | 0.327 | 0.000 | 1.000 | 0.035 |

Sensible return per fight by level, block B, buy-in 100: 0.889 0.840 0.708 0.656 - - - -.

#### Block B, buy-in 1000, 5000 runs per bot

| Bot | Runs | Cash mean | SE | Trimmed 99% | Cash median | P/W | L1 | L2 | L3 | L4 | L5 | Median fights | P95 | >60 | Walk share | Broke | Failed CP | Runs > buy-in |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 5000 | 0.523 | 0.005 | 0.507 | 0.521 | 0.818 | 0.650 | 0.387 | 0.193 | 0.079 | 0.029 | 10 | 25 | 0.000 | 0.369 | 0.000 | 1.000 | 0.057 |
| sensibleNoWalk | 5000 | 0.442 | 0.005 | 0.427 | 0.468 | 0.771 | 0.679 | 0.420 | 0.195 | 0.063 | 0.018 | 10 | 25 | 0.000 | 0.000 | 0.000 | 1.000 | 0.056 |
| lowHpWalk | 5000 | 0.585 | 0.005 | 0.569 | 0.574 | 0.835 | 0.576 | 0.316 | 0.150 | 0.062 | 0.021 | 10 | 25 | 0.000 | 0.516 | 0.000 | 1.000 | 0.059 |
| aboutToLose | 5000 | 0.541 | 0.005 | 0.525 | 0.532 | 0.822 | 0.635 | 0.367 | 0.179 | 0.072 | 0.025 | 10 | 25 | 0.000 | 0.361 | 0.000 | 1.000 | 0.065 |
| bossEmergency | 5000 | 0.421 | 0.005 | 0.407 | 0.426 | 0.774 | 0.720 | 0.445 | 0.215 | 0.083 | 0.026 | 10 | 25 | 0.000 | 0.045 | 0.000 | 1.000 | 0.050 |
| fixedMedium | 5000 | 0.657 | 0.004 | 0.642 | 0.616 | 0.859 | 0.325 | 0.095 | 0.015 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.333 | 0.000 | 1.000 | 0.061 |
| fixed20 | 5000 | 0.704 | 0.003 | 0.692 | 0.673 | 0.860 | 0.348 | 0.102 | 0.016 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.334 | 0.000 | 1.000 | 0.064 |
| bossTarget | 5000 | 0.563 | 0.005 | 0.546 | 0.552 | 0.851 | 0.492 | 0.203 | 0.053 | 0.015 | 0.003 | 5 | 20 | 0.000 | 0.334 | 0.000 | 1.000 | 0.063 |
| minBossMax | 5000 | 0.366 | 0.010 | 0.313 | 0.266 | 0.755 | 0.321 | 0.094 | 0.019 | 0.004 | 0.001 | 5 | 15 | 0.000 | 0.346 | 0.000 | 1.000 | 0.051 |
| minBossMaxLeave1 | 5000 | 0.709 | 0.011 | 0.688 | 0.356 | 0.787 | 0.321 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.319 | 0.000 | 0.679 | 0.302 |
| minSkipWalk | 5000 | 0.836 | 0.001 | 0.835 | 0.836 | 0.664 | 0.056 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.354 | 0.000 | 1.000 | 0.000 |
| allIn | 5000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.865 | 0.036 | 0.001 | 0.000 | 0.000 | 0.000 | 2 | 5 | 0.000 | 0.000 | 0.922 | 0.078 | 0.000 |
| allInWalk | 5000 | 0.064 | 0.004 | 0.043 | 0.000 | 0.881 | 0.106 | 0.008 | 0.000 | 0.000 | 0.000 | 3 | 8 | 0.000 | 0.282 | 0.734 | 0.266 | 0.008 |
| timid | 5000 | 0.285 | 0.002 | 0.278 | 0.250 | 0.431 | 0.026 | 0.001 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.945 | 0.000 | 1.000 | 0.000 |
| coasting | 5000 | 0.871 | 0.001 | 0.869 | 0.868 | 0.878 | 0.214 | 0.043 | 0.003 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.313 | 0.000 | 1.000 | 0.026 |
| minSkipFail | 5000 | 0.826 | 0.001 | 0.825 | 0.833 | 0.610 | 0.058 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 10 | 0.000 | 0.000 | 0.000 | 1.000 | 0.000 |
| leave1 | 5000 | 0.871 | 0.005 | 0.865 | 0.988 | 0.906 | 0.650 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.295 | 0.000 | 0.350 | 0.398 |
| leave2 | 5000 | 0.782 | 0.006 | 0.770 | 0.720 | 0.885 | 0.650 | 0.387 | 0.000 | 0.000 | 0.000 | 10 | 10 | 0.000 | 0.317 | 0.000 | 0.613 | 0.396 |
| leave3 | 5000 | 0.668 | 0.006 | 0.651 | 0.593 | 0.849 | 0.650 | 0.387 | 0.193 | 0.000 | 0.000 | 10 | 15 | 0.000 | 0.340 | 0.000 | 0.807 | 0.218 |
| firstAllIn | 5000 | 0.762 | 0.009 | 0.753 | 1.071 | 0.904 | 0.547 | 0.170 | 0.033 | 0.005 | 0.000 | 10 | 15 | 0.000 | 0.333 | 0.271 | 0.729 | 0.513 |
| firstAllInLeave1 | 5000 | 0.851 | 0.010 | 0.842 | 1.326 | 0.924 | 0.547 | 0.000 | 0.000 | 0.000 | 0.000 | 5 | 5 | 0.000 | 0.286 | 0.271 | 0.182 | 0.520 |
| fixed10 | 5000 | 0.807 | 0.002 | 0.802 | 0.798 | 0.862 | 0.336 | 0.096 | 0.014 | 0.002 | 0.000 | 5 | 15 | 0.000 | 0.333 | 0.000 | 1.000 | 0.057 |
| fixed50 | 5000 | 0.435 | 0.007 | 0.402 | 0.331 | 0.861 | 0.271 | 0.062 | 0.006 | 0.001 | 0.000 | 5 | 15 | 0.000 | 0.327 | 0.000 | 1.000 | 0.035 |

Sensible return per fight by level, block B, buy-in 1000: 0.906 0.858 0.733 0.677 - - - -.

The sensible per-level line is a survivor sample with target-driven bet sizes, not a controlled measurement.

### Summary by style (cash mean, 5000 runs, block A / block B)

| Style | Bot | Buy-in 100 | Buy-in 1000 |
|---|---|---|---|
| Smart | smart | 0.928 / 0.912 | 0.944 / 0.923 |
| Leaver | leave1 | 0.857 / 0.852 | 0.877 / 0.871 |
| Leaver, greedy start | firstAllInLeave1 | 0.861 / 0.839 | 0.873 / 0.851 |
| Low risk | coasting | 0.854 / 0.853 | 0.873 / 0.871 |
| Casual | fixedMedium | 0.647 / 0.642 | 0.662 / 0.657 |
| Casual | sensible | 0.524 / 0.519 | 0.527 / 0.523 |
| Greedy | firstAllIn | 0.759 / 0.737 | 0.784 / 0.762 |
| Greedy | fixed50 | 0.425 / 0.424 | 0.435 / 0.435 |
| Greedy | allInWalk | 0.065 / 0.062 | 0.066 / 0.064 |
| Walk first | timid | 0.264 / 0.260 | 0.289 / 0.285 |
| All-in | allIn | 0.000 / 0.000 (broke 0.93 / 0.92) | 0.000 / 0.000 (broke 0.93 / 0.92) |

### Targets

| Target | Result | Status |
|---|---|---|
| Smart mean cash < 0.98 at buy-in 100 and 1000, two blocks | 0.912-0.944 (5000 runs), 0.886-0.953 (1000-run test seeds) | met |
| Smart mean in 0.90-0.97 | 0.928 / 0.912 (100), 0.944 / 0.923 (1000) | met |
| Smart-shop slot return <= 1.0 at levels 1-3, deeper levels declining | max 0.979 (2000 samples, offline); level means 0.960, 0.958, 0.937, 0.932, 0.924, 0.913, 0.904, 0.876 | met (offline check; see note) |
| Casual style about 0.6-0.8 | fixedMedium 0.642-0.662 (fixed20 0.690-0.707); sensible 0.519-0.527 | partial: sensible is below 0.6 |
| Walk-at-first-chance worst | timid has the lowest P/W of all bots (0.41-0.43) and cashes 0.26-0.29, at least 0.12 below every other walker; only allIn and allInWalk, which mostly go broke, cash less | met (by P/W and within the walk family) |
| allIn mostly broke | broke 0.92-0.93, cash 0.000 | met |
| leave1 not the best style by a wide margin | leave1 0.852-0.877; coasting within 0.006, firstAllInLeave1 within 0.02; smart beats it by 0.05-0.07 | met |
| No simple bot's mean cash > 1.0 | best simple 0.877 | met |
| Sensible clears L1 55-75% | 0.634-0.670 | met |
| Sensible clears L3 20-40% | 0.166-0.203 (0.20 only at buy-in 1000, block A) | missed at three of four cells |
| Median run 8-20 fights | 10 (sensible) | met |
| < 2% of runs over 60 fights | 0.000 | met |
| Upgrade gain +0.06..+0.18 at L1/L2 | all but Vampire Fang at L2 (+0.052) | one documented miss |

Notes on the targets:
- **Slot check.** "No slot above 1.0 at levels 1-3" is verified by the offline 2000-sample run above. The test prints a 200-sample table (standard error about 0.03 per cell, so single cells such as 1.052, 1.031 and 1.026 appear above 1.0) and asserts the mean over levels 1-3 < 1.0 and each level mean < 1.05. Run with `SMART_FULL=1` for 2000 samples.
- **The smart bot never plays past level 1** (it leaves at every passed checkpoint), so its edge is level 1 plus the leave fee. The deeper-level calibration binds players who continue.
- **Sensible L3 clear (0.17-0.20).** The sensible bot uses the priority build, which is about 0.2 per fight weaker than the smart shop at levels 3-5, and the ramp is now calibrated against the smart shop. Lowering the level 2-3 target growth to 3% or 2% moved it by about 0.01 only. Getting it back needs a better default pick order for simple bots (not a core rule) or a softer ramp, which gives the smart player the edge back. L1 clears and the median run length are on target. The test asserts L3 >= 0.15.
- **Sensible cash (0.52-0.53)** is below the casual 0.6-0.8 band because it raises bets to chase the target and plays on until a checkpoint fails. fixedMedium, the other casual style, is in the band.
- Buy-in 100 pays about 0.01-0.02 less than buy-in 1000 because of flooring on small bets.

## UI checklist (API changes)

### This revision (`2.1.0-house-edge`)

Nothing breaks compilation: `npx tsc --noEmit` on the whole project passes. Everything below compiles but is wrong if ignored.

1. **Leave fee.** Leaving costs 5%: `cashOut = bankroll - leaveFee(bankroll)` and `cashOutFee` is the fee (it was 0). Update `format.ts` `leaveLabel(bankroll)` (show `bankroll - state.leaveFee`), `leaveFreeLine()` ("Leaving now is free" is wrong), `gameOverText` for `'left'` ("took all ... Leaving is free" is wrong) and `returnRows` (add a fee row for `'left'` like the `'checkpoint'` one, using `state.leaveFeePercent`). The checkpoint card can show `state.leaveFee` directly.
2. **Failing UI test.** `src/ui/__tests__/ui.test.ts` "plays a whole level, checks the checkpoint text and leaves" expects `cashOut` to equal the bankroll after leaving (340 received, 358 expected); it needs the fee.
3. **New export:** `leaveFee`. New state fields: `leaveFeePercent` (5) and `leaveFee` (non-zero only during `checkpoint`).
4. **Config shape:** `LevelDef` has a required `enemyBonusStepMilli`; the global `CONFIG.enemyBonusStepMilli` is gone. `CONFIG.leaveFeePercent` is new. Anything that read the old global (debug panels, level previews) must read the level row or call `enemyBonusMilliFor`. `levelInfo` values (enemy dice text, bonus ranges) changed with the new ramp.
5. **Saves:** `RULES_VERSION` changed, so `runStore` drops saved runs from `2.0.0-levels` (it already compares `record.rules`). No migration is possible because the fight odds changed.
6. **Tutorial / help text** (`tutorial.ts`): mention the 5% leave fee next to the 10% failed-checkpoint fee. Bets, presets, the boss and the shop cadence are unchanged.

### Earlier revision

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
