# Game core

Deterministic, UI-free logic for a push-your-luck dice-fight roguelike. Import everything from `src/core/index.ts`. No runtime dependencies, no `Math.random`, no `Date`, no real-time rules. Every coin amount is an integer, multipliers are integer milli units (1000 = 1.0x) and payouts use BigInt with floor.

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
game.dispatch({ type: 'pawn', index: 0 })
game.tick()
game.state
game.log
replay(seed, buyIn, game.log, game.state.tick)
```

- `createGame(seed, buyIn = CONFIG.defaultBuyIn)` starts a run. `seed` is coerced to uint32. `buyIn` must be an integer `>= CONFIG.minBuyIn` (100), otherwise it throws `RangeError`. Use `isValidBuyIn(n)` to check first. Suggested presets are `CONFIG.buyInPresets` = 100, 250, 500, 1000.
- `dispatch(action)` returns `false` and logs nothing when the action is invalid in the current phase. Every valid action is appended to `log` as `{ tick, action }`.
- `tick()` only increments `state.tick`. No rule reads it.
- `replay(seed, buyIn, log, totalTicks?)` dispatches each entry at its tick and stops at `totalTicks` (default: the last entry's tick). `replay(seed, buyIn, game.log, game.state.tick)` deep-equals the live `game.state`.
- `state` is an immutable snapshot rebuilt after every `dispatch`/`tick`.
- `failedCheckpointFee(bankroll)` returns the coins withheld when a run ends on a failed checkpoint with that bankroll.

## Phases and actions

| Phase | Valid actions | Notes |
|---|---|---|
| `bet` | `bet { amount }`, `pawn { index }` | The amount is floored and clamped to `[minBet, maxBet]`, then deducted. `maxBet` is the whole bankroll on every fight. `pawn` only when `canPawn` (bankroll 0 and at least one upgrade owned). |
| `fight` | `roll`, `walkAway` | `walkAway` only when `fight.canWalkAway`: at least one exchange played and the walk-away payout is at least 1 coin. |
| `result` | `continue` | See below. |
| `checkpoint` | `continue`, `leave` | Only reached after a passed boss checkpoint. `leave` ends the run and cashes out the full bankroll, with no fee. `continue` opens the shop. |
| `shop` | `pickUpgrade { index }`, `skip` | Pick one offer, or take `skipCoins` instead. Then `bet`. |
| `gameover` | none | |

```
bet -> fight -(roll...)-> result -continue-> shop -> bet                 (normal fight)
                \-walkAway-/          \-continue-> checkpoint -continue-> shop   (boss passed)
                                                             \-leave-> gameover 'left'       (no fee)
                                      \-continue-> gameover 'checkpoint' (boss failed, fee withheld)
                                      \-continue-> gameover 'broke'      (bankroll 0 after a normal fight, no upgrade to pawn)
```

On `continue` from `result`:

1. `fightInStage += 1`.
2. After the boss (5th fight of the stage), the checkpoint runs. If `bankroll >= target`, the stage is cleared: `stagesCleared += 1`, `stage += 1`, `stageEntryBankroll = bankroll`, a new `target` is set and the phase becomes `checkpoint`. Otherwise the phase becomes `gameover` with reason `'checkpoint'`, `cashOutFee = failedCheckpointFee(bankroll)` and `cashOut = bankroll - cashOutFee`. The result is stored in `lastCheckpoint` (its `bankroll` is the amount before the fee).
3. If the bankroll is below 1 and no upgrade is owned, the phase becomes `gameover` with reason `'broke'`, `cashOut` 0 and `cashOutFee` 0.
4. Otherwise the phase becomes `shop`. A player at 0 coins who owns an upgrade reaches the shop too: `skip` pays `skipCoins`; picking an upgrade leads to a `bet` phase at 0 coins, where only `pawn` is valid.

Losing is final. There is no meta currency.

### Cash-out

| `gameOverReason` | `cashOut` | `cashOutFee` |
|---|---|---|
| `'checkpoint'` (failed boss checkpoint) | bankroll minus the fee | `failedCheckpointFee(bankroll)` |
| `'broke'` | 0 | 0 |
| `'left'` (left after a passed checkpoint) | the full bankroll | 0 |
| `null` (run still going) | `null` | `null` |

- `state.failedCheckpointFeePercent` is always set (`CONFIG.failedCheckpointFeePercent`, 10). The UI can show it on the boss bet screen, for example "fail the checkpoint and the house keeps 10% of what is left".
- The fee rounds in the house's favour: `cashOut = floor(bankroll * 90 / 100)` and `cashOutFee = bankroll - cashOut`. So the fee is `ceil(10%)`: bankroll 0 pays 0, bankroll 1 to 10 pays 1 (bankroll 1 returns 0), 11 pays 2, 100 pays 10, 105 pays 11.
- House return is `cashOut / buyIn`.

## Stages, bets and targets

- A stage has `fightsPerStage = 5` fights: 4 normal enemies, then 1 boss. The boss is the checkpoint fight (`isCheckpointFight === isBossFight`).
- The target is relative to the bankroll you entered the stage with: `target = max(entry + 1, floor(entry * 107 / 100))`, and at least 1. The first stage's entry is the buy-in, so buy-in 100 gives target 107, and buy-in 1000 gives 1070.
- Bet limits are shares of the current bankroll and are the same on every fight:
  - `minBet = max(1, ceil(bankroll * 4%))`.
  - `maxBet` is the whole bankroll (all-in), on normal fights and on the boss. An all-in loss on a normal fight can leave you at 0 mid-stage.
  - Outside the bet phase, or at 0 coins, both are 0.
- `betPresets` has 4 entries, the same shares on every fight: `low` 10%, `medium` 25%, `high` 50%, then `max`, labelled `All-in` (100%). Each preset is clamped to the limits, and `isAllIn` is true when it equals the bankroll. At 0 coins every preset has `amount` 0 and `isAllIn` false.
- Skip and pawn both pay `skipPawnValue(buyIn) = max(1, floor(buyIn * 1%))`: 1 coin at buy-in 100, 2 at 250, 5 at 500 and 10 at 1000. `state.skipCoins === state.pawnValue` and every `Upgrade.pawnValue` is the same value.

Note that the target depends on player choices, because it depends on the entry bankroll. Enemies, enemy dice and the shop order do not.

### Pawn and skip economy

- Pawn is only valid at 0 coins, so it is reached by an all-in loss on a normal fight while owning an upgrade. Such a player reaches the shop with 0 coins and can `skip` (paid `skipCoins`) or pick an upgrade and then `pawn` any owned one (paid the same). Picking and pawning therefore never pays more than skipping; at most it swaps an old upgrade for a new one.
- A pawn pays 1% of the buy-in, against a stage target of 107% of the stage-entry bankroll. It is a lifeline for a few more fights, not a way back: in 2000 allIn runs at buy-in 100 and 1000, 51% pawned at least once, no run cleared a stage or set a new peak bankroll after its first pawn, and those runs cashed out 0.3% (100) and 0.9% (1000) of the buy-in on average. `rules.test.ts` checks this on 300 seeds per buy-in.

## Fight rules

- The player has `playerBaseHp` 10 HP, reset every fight, and rolls 2d6.
- The enemy for global fight index `k` (0-based) is derived only from `(seed, k)`:
  - Stage is `floor(k/5) + 1`. The fight is a boss when `k % 5 === 4`.
  - HP = `8 + floor(k * 0.15) + 0..2`. Tough multiplies it by 1.3. Bosses get +4. The minimum is 3.
  - Flat roll bonus: a concave ramp `(-540 + 303k - 3.95k^2)` milli for `k <= 23`, flat after that. Bosses add `100 - 50 * (stage - 1)` milli. The fractional part is a seeded chance of +1. Brute adds +1.
- Each `roll`: both sides roll 2d6 plus their bonus. The higher total wins and deals the difference as damage. A tie does nothing, except against Lucky.
- Crit:
  - The player crits by winning with doubles, or with a total of at least 10 when Loaded Dice is owned.
  - The enemy crits by winning with doubles.
  - A crit multiplies damage by `critFactor` 2, or by 3 for a Savage enemy's crits.
  - `playerCritFactor` and `enemyCritFactor` on each exchange are 1 when there is no crit.
- Multiplier: `floor(netDamage * fullKo / enemyMaxHp)`, in milli units.
  - `fullKo` is 1.4x on normal fights and 2.0x on the boss.
  - A knockout adds the KO bonus: +0.2x on normal fights, +0.5x on the boss, plus Finisher.
  - A knockout therefore pays 1.6x on normal fights and 2.5x on the boss.
  - Net damage is `maxHp - hp`, so Regenerate can make `multiplierGainedMilli` negative.
- Win: the payout is `floor(bet * multiplier)`.
- Loss: the payout is the Insurance refund (0 without Insurance).
- Walk away: the payout is `floor(bet * multiplier * 0.5)`. It is only allowed after one exchange, and only if it pays at least 1 coin.
- Escaped (Escape Rope): a blow that would knock you out pays the walk-away payout instead. This only happens when that payout is at least 1 and more than the Insurance refund.

### Traits (`traitText` is never empty)

Normal enemies (weights in brackets):

| Trait | Weight | Effect |
|---|---|---|
| `plain` | 4 | Plain: no special tricks. |
| `tough` | 2 | Tough: 30% more HP. |
| `brute` | 2 | Brute: +1 to every roll. |
| `armored` | 1 | Armored: your hits deal 1 less damage (min 1). |
| `savage` | 1 | Savage: its doubles deal x3 damage. |
| `vicious` | 1 | Vicious: its hits deal +1 damage. |
| `lucky` | 1 | Lucky: it wins ties, dealing 1 damage. |

Bosses (each weight 1). Boss names: Goblin Warlord, Bone Tyrant, The Hollow King, Mire Hydra, Iron Golem, Witch of Ash, Dread Knight, Ogre Chieftain.

| Trait | Effect |
|---|---|
| `enrage` | Enrage: +1 to every roll once below half HP (`enemy.currentBonus` shows the live value). |
| `regenerate` | Regenerate: heals 1 HP after every roll it survives (`exchange.enemyHealed`). |
| `ironhide` | Ironhide: your hits deal 2 less damage (min 1). |
| `executioner` | Executioner: its hits deal +2 damage. |

## Upgrades

The shop opens after every fight except a failed boss. Each fight index `k` has a seeded order of all 12 upgrades, from `shopOrderForFight(seed, k)`: a Fisher-Yates shuffle on the `shop` stream. The offers are that order with already-capped upgrades removed, first 3 kept: `shopOffersForFight(seed, k, owned)`. The shop therefore never offers a useless upgrade. It can show fewer than 3 offers, or 0; with 0, only `skip` is possible. The order never depends on player choices, and only the filtering does. Offers are `ShopOffer` objects: `Upgrade` plus `owned`, the copies already held.

The gain is the change in return per fight from copy n (given n-1 copies), from `balance.test.ts`.
- Stage 1 starts from an empty base.
- Stage 2 starts from a random 4-upgrade base.

| id | Name | Effect | Cap | Stage 1 gain per copy | Stage 2 gain per copy |
|---|---|---|---|---|---|
| `weightedDice` | Weighted Dice | Your dice never roll below 2. | 1 | +0.123 | +0.083 |
| `sharpBlade` | Sharp Blade | Your hits deal +1 damage. | 3 | +0.137 / +0.129 / +0.082 | +0.127 / +0.103 / +0.096 |
| `secondWind` | Second Wind | Once per fight per copy, a losing roll rerolls your lowest die and keeps the better. | 2 | +0.112 / +0.092 | +0.078 / +0.068 |
| `vitality` | Vitality | +3 max HP. | 2 | +0.140 / +0.108 | +0.103 / +0.095 |
| `shield` | Shield | The first hit each fight deals 4 less damage (one more hit per extra copy). | 2 | +0.131 / +0.112 | +0.092 / +0.075 |
| `loadedDice` | Loaded Dice | Winning rolls that total 10 or more also crit. | 1 | +0.125 | +0.113 |
| `escapeRope` | Escape Rope | A knockout blow becomes a walk-away payout. | 1 | +0.130 | +0.104 |
| `insurance` | Insurance | 20% of the bet back on a loss. | 2 | +0.111 / +0.111 | +0.113 / +0.123 |
| `finisher` | Finisher | Knockouts pay +0.3x more. | 3 | +0.125 x3 | +0.089 x3 |
| `intimidate` | Intimidate | Enemies start with 20% less HP (min 3). | 2 | +0.091 / +0.151 | +0.078 / +0.138 |
| `vampire` | Vampire Fang | Heal 3 HP whenever you land a hit. | 1 | +0.124 | +0.074 |
| `thickSkin` | Thick Skin | Take 1 less damage from every hit (min 1). | 2 | +0.130 / +0.109 | +0.093 / +0.103 |

Descriptions are generated from `CONFIG.upgradeEffects` and end with "Max 1 copy." or "Stacks up to N.". The caps also apply in `computeMods`, so extra copies can never add power.

Caps were set where stacking broke the curve:
- Weighted Dice copy 2 was worth +0.36.
- Vampire copy 2 was weak, so it is capped at 1 with a stronger heal.
- The old Loaded Dice (+2x crit) and the old Escape Rope (a bigger walk-away keep) were reworked.

## Determinism

- mulberry32 streams, seeded by `deriveSeed(seed, name, fightIndex)`:
  - `enemy` for enemy stats;
  - `enemy-dice` for enemy rolls, always 2 draws per exchange;
  - `player-dice` for player rolls and rerolls;
  - `shop` for the offer order.
- Enemies, enemy dice and the shop order for fight `k` depend only on `(seed, k)`, whatever the bets, walks or picks. `determinism.test.ts` checks this.
- `replay` reproduces the live state exactly.

## Buy-in scaling and rounding

Everything that used to be an absolute coin amount scales with `buyIn`:
- the starting bankroll;
- the target, which is relative;
- the bet limits and presets, which are shares;
- skip and pawn value (1%, floored, but at least 1 coin);
- the failed-checkpoint fee, which is a share of the bankroll.

Rounding floors in the house's favour, with one exception:
- targets use `floor(entry * 1.07)` but are at least `entry + 1`;
- payouts floor;
- `minBet` uses ceil;
- the failed-checkpoint cash-out floors, so the fee rounds up;
- the exception is skip/pawn, whose 1-coin floor would favour the player below buy-in 100. With `minBuyIn = 100` it never triggers: skip/pawn is exactly 1% at every valid buy-in.

Buy-in 100 and 1000 now match closely (see "Buy-in invariance"). Payout flooring still costs a little at 100: sensible stage-1 clear is 0.662 at 100 and 0.690 at 1000.

## Tuning (`src/core/config.ts`)

| Constant | Value |
|---|---|
| `minBuyIn` / `defaultBuyIn` / `buyInPresets` | 100 / 100 / 100, 250, 500, 1000 |
| `fightsPerStage` | 5 (4 normal + boss) |
| `minBetPercent` / `maxBetPercent` / `bossMaxBetPercent` | 4 / 100 / 100 |
| `betPresetPercents` | low 10, medium 25, high 50 (the fourth preset is All-in) |
| `targetGrowthPercent` | 7 (relative to stage-entry bankroll) |
| `skipPawnPermilleOfBuyIn` | 10 |
| `failedCheckpointFeePercent` | 10 |
| `playerBaseHp` / `playerBaseDice` | 10 / 2d6 |
| `fullKoMultiplierMilli` / `koBonusMilli` | 1400 / 200 |
| `bossFullKoMultiplierMilli` / `bossKoBonusMilli` | 2000 / 500 |
| `walkAwayKeepMilli` | 500 |
| `critFactor` | 2 |
| `enemyBaseHp` / `enemyHpPerFightMilli` / `enemyHpSpread` / `enemyMinHp` | 8 / 150 / 2 / 3 |
| `enemyBaseBonusMilli` / `enemyBonusPerFightMilli` / `enemyBonusCurveMicro` / `enemyBonusRampFights` | -540 / 303 / 3950 / 23 |
| `bossExtraHp` / `bossBonusMilli` / `bossBonusPerStageMilli` | 4 / 100 / -50 |
| trait constants | see the traits table above |
| `upgradeEffects` / `upgradeMaxCopies` | see the upgrades table above |
| `shopOfferCount` | 3 |

`targetGrowthPerStagePercent`, `targetFloorFirstPermilleOfBuyIn` and `targetFloorGrowthPercent` are tuning hooks for an absolute target floor. They are off by default (`targetFloorFirstPermilleOfBuyIn = 0`).

Changes in this revision: `minBuyIn` 50 -> 100, `buyInPresets` 50/100/250/1000 -> 100/250/500/1000, `maxBetPercent` 50 -> 100, `betPresetPercents` 10/20/35 -> 10/25/50, new `failedCheckpointFeePercent` 10, `enemyBonusCurveMicro` 3470 -> 3950.

## Bet-sizing analysis

History: the old rules (a fixed target ladder, no minimum bet, no cap) let a player coast on 1-coin bets to clear stage 1 every time. The options below were each simulated with 2000 runs under those old rules. Each cell is stage-1 clear / stage-3 clear / mean cash-out relative to the buy-in.

| Option | Sensible | Fixed 20% | Coasting | All-in | Timid |
|---|---|---|---|---|---|
| Old: ladder, no min, no cap | 1.00 / .52 / .66 | .60 / .16 / .73 | 1.00 / .00 / .95 | .05 / .00 / .01 | 1.00 / .01 / .25 |
| (a) ladder + min 10% | .77 / .29 / .72 | .60 / .16 / .73 | .74 / .18 / .86 | .05 / .00 / .01 | .06 / .00 / .53 |
| (a) ladder + min 20% | .66 / .21 / .67 | .60 / .16 / .71 | .60 / .16 / .71 | .05 / .00 / .01 | .03 / .00 / .34 |
| (b) relative target +10% | .60 / .18 / .83 | .28 / .02 / .91 | .00 / .00 / .98 | .05 / .00 / .01 | .05 / .00 / .20 |
| (c) ladder + cap 50% | 1.00 / .52 / .66 | .60 / .16 / .73 | 1.00 / .00 / .95 | .32 / .03 / .03 | 1.00 / .01 / .26 |
| (a)+(b) min 10% + relative | .51 / .11 / .82 | .28 / .02 / .91 | .26 / .02 / .95 | .05 / .00 / .01 | .01 / .00 / .21 |
| (b)+(c) | .60 / .18 / .83 | .28 / .02 / .91 | .00 / .00 / .98 | .20 / .01 / .29 | .05 / .00 / .20 |
| min 1% + relative 7% + cap 50% | .75 / .34 / .73 | .30 / .03 / .89 | .00 / .00 / .98 | .23 / .01 / .26 | .06 / .00 / .21 |

The previous decision was a relative +7% target, a 4% minimum bet, a 50% cap on normal fights with all-in only on the boss, skip/pawn at 1% of the buy-in, a free exit after a passed checkpoint and a free cash-out on a failed one. Under it, the best-paying styles were the ones that risked least: coasting 0.973, leave1 0.962, minSkipFail 0.956, against 0.762 for the sensible bettor who never leaves.

Current rules (product-owner decisions):
- **Fee on a failed checkpoint (10%).** Low-risk play almost always ends on a failed checkpoint, so it now pays the fee on nearly its whole bankroll. Leaving after a passed checkpoint stays free, so clearing a stage and then walking out is the best-paying style, not coasting.
- **All-in on every fight.** The 50% cap is gone; `maxBet` is the bankroll. This makes `'broke'` and `pawn` reachable in ordinary play. The presets are the same on every fight: 10 / 25 / 50 / All-in.
- **Minimum buy-in 100.** Skip/pawn is exactly 1% at every valid buy-in, which removes the buy-in-50 skip-farming edge.

The 4% minimum bet and the relative 7% target are unchanged. The fee is proportional, so on its own it narrows the gap between the best low-risk style and the sensible never-leave bettor only from 0.21 to 0.19. The rest of the narrowing comes from a gentler late enemy ramp (`enemyBonusCurveMicro` 3470 -> 3950). That raises the late-stage return per fight, and so the cash of a player who keeps playing.

Current bet-size sweep: a fixed share of the bankroll every fight, 1000 runs, target-unaware, buy-in 100.

| Fixed share | S1 | S3 | Cash |
|---|---|---|---|
| 0% (min bet) | 0.243 | 0.013 | 0.875 |
| 10% | 0.280 | 0.024 | 0.866 |
| 25% | 0.313 | 0.029 | 0.794 |
| 50% | 0.269 | 0.017 | 0.635 |
| 100% (all-in) | 0.115 | 0.002 | 0.004 |
| target-aware sensible | 0.662 | 0.269 | 0.732 |

Mid-size, target-aware betting clears the most. Minimum bets clear stage 1 less than a quarter of the time and lose about 13%. All-in every fight goes broke.

## Balance

`__tests__/balance.test.ts` plays full seeded runs at buy-in 100 and 1000, prints every table below, and asserts the targets loosely. The bots are in `__tests__/bots.ts`, and all of them pick upgrades by a fixed priority unless noted. Every bot pawns index 0 whenever `canPawn`.

- **sensible**:
  - bets 20% of the bankroll, raised to what it needs to reach the target;
  - once at or over the target, bets the minimum on normal fights and protects the target on the boss;
  - walks away only on the boss at 1 HP, or when walking guarantees the target;
  - never leaves.
- **fixedMedium**: always bets 20%. **fixed10 / fixed25 / fixed50**: always bet that share.
- **bossTarget**: bets 20% on normal fights and is target-aware on the boss.
- **minBossMax** / **minBossMaxLeave1**: bets the minimum on normal fights and all-in on the boss; the second one leaves after stage 1.
- **minSkipWalk** / **minSkipFail**: bets the minimum and always skips the shop; the first walks at the boss emergency, the second never walks.
- **allIn**: always bets the whole bankroll and never walks. When broke with an upgrade it pawns and goes all-in again (the pawn-cycling strategy).
- **timid**: sensible, but walks at the first chance.
- **coasting**: always bets the minimum.
- **leave1/2/3**: sensible, but leaves after clearing stage 1/2/3.
- **firstAllIn** / **firstAllInLeave1**: all-in on fight 1, then plays sensible with a 0% base share (the minimum once at the target, only what it needs otherwise); the second one leaves after stage 1.

### Full runs, buy-in 100

The sensible bot plays 4000 runs; every other bot plays 2000. P/W is total paid out divided by total wagered. Cash is `cashOut / buyIn`. "Failed CP" and "Broke" are the shares of runs that ended that way; "Pawned" is the share of runs with at least one pawn.

| Bot | P/W | S1 | S2 | S3 | S4 | S5 | Median fights | P95 | >60 fights | Rolls normal/boss | Cash mean | Cash median | Runs > buy-in | Failed CP | Broke | Pawned |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 0.924 | 0.662 | 0.440 | 0.269 | 0.151 | 0.081 | 10 | 30 | 0.001 | 5.30 / 6.27 | 0.732 | 0.670 | 0.163 | 1.000 | 0 | 0 |
| fixedMedium | 0.948 | 0.298 | 0.092 | 0.029 | 0.009 | 0.004 | 5 | 15 | 0 | 4.98 / 6.11 | 0.815 | 0.790 | 0.124 | 1.000 | 0 | 0 |
| bossTarget | 0.950 | 0.624 | 0.364 | 0.198 | 0.097 | 0.039 | 10 | 25 | 0 | 5.23 / 6.23 | 0.750 | 0.580 | 0.160 | 1.000 | 0 | 0 |
| minBossMax | 0.895 | 0.349 | 0.117 | 0.035 | 0.010 | 0.002 | 5 | 15 | 0 | 4.95 / 6.31 | 0.450 | 0.000 | 0.041 | 1.000 | 0 | 0 |
| minBossMaxLeave1 | 0.945 | 0.349 | - | - | - | - | 5 | 5 | 0 | 4.79 / 6.19 | 0.930 | 0.000 | 0.349 | 0.650 | 0 | 0 |
| minSkipWalk | 0.636 | 0.089 | 0.001 | 0 | 0 | 0 | 5 | 10 | 0 | 4.60 / 4.78 | 0.857 | 0.850 | 0.003 | 1.000 | 0 | 0 |
| allIn | 0.912 | 0.051 | 0.002 | 0 | 0 | 0 | 5 | 10 | 0 | 4.79 / 6.03 | 0.001 | 0.000 | 0.000 | 0.593 | 0.407 | 0.513 |
| timid | 0.291 | 0.019 | 0.001 | 0.001 | 0 | 0 | 5 | 5 | 0 | 2.02 / 2.27 | 0.200 | 0.120 | 0.001 | 1.000 | 0 | 0 |
| coasting | 0.913 | 0.233 | 0.056 | 0.011 | 0.004 | 0.001 | 5 | 15 | 0 | 4.91 / 6.03 | 0.872 | 0.870 | 0.045 | 1.000 | 0 | 0 |
| minSkipFail | 0.634 | 0.092 | 0.001 | 0 | 0 | 0 | 5 | 10 | 0 | 4.60 / 4.94 | 0.857 | 0.850 | 0.003 | 1.000 | 0 | 0 |
| leave1 | 0.945 | 0.655 | - | - | - | - | 5 | 5 | 0 | 4.79 / 6.01 | 0.941 | 1.070 | 0.655 | 0.345 | 0 | 0 |
| leave2 | 0.945 | 0.655 | 0.440 | - | - | - | 10 | 10 | 0 | 4.97 / 6.18 | 0.898 | 0.900 | 0.454 | 0.560 | 0 | 0 |
| leave3 | 0.941 | 0.655 | 0.440 | 0.271 | - | - | 10 | 15 | 0 | 5.06 / 6.25 | 0.857 | 0.750 | 0.307 | 0.729 | 0 | 0 |
| firstAllIn | 0.946 | 0.593 | 0.225 | 0.089 | 0.039 | 0.009 | 10 | 20 | 0 | 5.14 / 6.34 | 0.821 | 1.170 | 0.560 | 0.593 | 0.407 | 0 |
| firstAllInLeave1 | 0.949 | 0.593 | - | - | - | - | 5 | 5 | 0 | 4.77 / 6.14 | 0.941 | 1.440 | 0.593 | 0 | 0.407 | 0 |
| fixed10 | 0.947 | 0.272 | 0.076 | 0.023 | 0.007 | 0.003 | 5 | 15 | 0 | 4.95 / 6.28 | 0.860 | 0.860 | 0.128 | 1.000 | 0 | 0 |
| fixed25 | 0.949 | 0.296 | 0.090 | 0.028 | 0.009 | 0.004 | 5 | 15 | 0 | 4.97 / 6.13 | 0.789 | 0.750 | 0.116 | 1.000 | 0 | 0 |
| fixed50 | 0.954 | 0.260 | 0.068 | 0.018 | 0.006 | 0.003 | 5 | 15 | 0 | 4.93 / 6.25 | 0.643 | 0.470 | 0.083 | 1.000 | 0 | 0 |

### Full runs, buy-in 1000

| Bot | P/W | S1 | S2 | S3 | S4 | S5 | Median fights | P95 | >60 fights | Cash mean | Cash median | Runs > buy-in | Broke | Pawned |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sensible | 0.932 | 0.690 | 0.463 | 0.288 | 0.166 | 0.090 | 10 | 30 | 0.001 | 0.743 | 0.674 | 0.178 | 0 | 0 |
| fixedMedium | 0.952 | 0.306 | 0.096 | 0.030 | 0.009 | 0.004 | 5 | 15 | 0 | 0.823 | 0.784 | 0.135 | 0 | 0 |
| bossTarget | 0.955 | 0.653 | 0.398 | 0.219 | 0.106 | 0.043 | 10 | 25 | 0 | 0.758 | 0.586 | 0.164 | 0 | 0 |
| minBossMax | 0.897 | 0.349 | 0.117 | 0.035 | 0.010 | 0.002 | 5 | 15 | 0 | 0.456 | 0.000 | 0.042 | 0 | 0 |
| minBossMaxLeave1 | 0.951 | 0.349 | - | - | - | - | 5 | 5 | 0 | 0.938 | 0.000 | 0.349 | 0 | 0 |
| minSkipWalk | 0.660 | 0.089 | 0.001 | 0 | 0 | 0 | 5 | 10 | 0 | 0.871 | 0.867 | 0.003 | 0 | 0 |
| allIn | 0.913 | 0.051 | 0.002 | 0 | 0 | 0 | 5 | 10 | 0 | 0.005 | 0.000 | 0.000 | 0.407 | 0.513 |
| timid | 0.307 | 0.021 | 0.002 | 0.001 | 0 | 0 | 5 | 5 | 0 | 0.217 | 0.140 | 0.001 | 0 | 0 |
| coasting | 0.946 | 0.215 | 0.047 | 0.010 | 0.003 | 0.001 | 5 | 10 | 0 | 0.887 | 0.890 | 0.058 | 0 | 0 |
| minSkipFail | 0.656 | 0.092 | 0.001 | 0 | 0 | 0 | 5 | 10 | 0 | 0.870 | 0.866 | 0.003 | 0 | 0 |
| leave1 | 0.955 | 0.684 | - | - | - | - | 5 | 5 | 0 | 0.953 | 1.070 | 0.684 | 0 | 0 |
| leave2 | 0.956 | 0.684 | 0.461 | - | - | - | 10 | 10 | 0 | 0.915 | 0.873 | 0.472 | 0 | 0 |
| leave3 | 0.951 | 0.684 | 0.461 | 0.287 | - | - | 10 | 15 | 0 | 0.875 | 0.760 | 0.323 | 0 | 0 |
| firstAllIn | 0.953 | 0.593 | 0.222 | 0.088 | 0.040 | 0.010 | 10 | 20 | 0 | 0.836 | 1.187 | 0.568 | 0.407 | 0 |
| firstAllInLeave1 | 0.951 | 0.593 | - | - | - | - | 5 | 5 | 0 | 0.944 | 1.449 | 0.593 | 0.407 | 0 |
| fixed10 | 0.961 | 0.275 | 0.079 | 0.024 | 0.008 | 0.004 | 5 | 15 | 0 | 0.873 | 0.867 | 0.137 | 0 | 0 |
| fixed25 | 0.953 | 0.305 | 0.095 | 0.029 | 0.009 | 0.004 | 5 | 15 | 0 | 0.799 | 0.731 | 0.128 | 0 | 0 |
| fixed50 | 0.955 | 0.260 | 0.068 | 0.018 | 0.006 | 0.003 | 5 | 15 | 0 | 0.653 | 0.492 | 0.084 | 0 | 0 |

How to read this:
- **No bot reaches 1.0** at either buy-in. The best simple strategies are leave1 (0.941 / 0.953) and firstAllInLeave1 (0.941 / 0.944), then minBossMaxLeave1 (0.930 / 0.938). All are inside the 0.90-0.97 band.
- **Low-risk play no longer pays best.** The best low-risk style is coasting at 0.872 (0.887 at 1000), 0.07 below leave1. Under the old rules it was the best style overall at 0.973.
- **Gap to the sensible never-leave bettor:** best low-risk 0.872 against sensible 0.732, a gap of 0.14 (0.887 against 0.743 at 1000). It was 0.973 against 0.762, a gap of 0.21.
- **Degenerate strategies under the new rules:**
  - all-in on fight 1, then coast and leave (firstAllInLeave1): 0.941. Its median run cashes out 1.44, but 41% go broke on fight 1. It ties leave1 and stays under 1.0, because the fight-1 return and the stage-1 return are both below 1.0.
  - minimum bets, all-in on the boss, then leave (minBossMaxLeave1): 0.930. Its median cash-out is 0; it is a pure bet on the stage-1 boss.
  - pawn-cycling (allIn): 51% of runs pawn at least once, and the mean cash-out is 0.001 (0.005 at 1000). Pawning does not grind back.
- **Walking away is costly:** timid walks at the first chance and gets 0.200 cash with a P/W of 0.29.

### Sensible return per fight by stage (buy-in 100)

Stage 8 and later have fewer than 500 fights and are not shown.

| Stage | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|
| All fights | 0.96 | 0.94 | 0.93 | 0.92 | 0.91 | 0.87 | 0.88 |
| Normal fights | 0.96 | 0.96 | 0.92 | 0.90 | 0.90 | 0.90 | 0.89 |
| Boss fights | 0.94 | 0.87 | 0.95 | 0.99 | 0.92 | 0.80 | 0.87 |
| Fights sampled | 20000 | 13235 | 8795 | 5370 | 3030 | 1610 | 865 |

The largest step between stages is 0.04 (stage 5 to 6). Stage 7 is 0.01 above stage 6, which is sampling noise on 865 fights. The boss row is noisy, because each stage has far fewer boss fights.

### Buy-in invariance

Taken from the full runs above. Each cell is stage-1 clear / stage-3 clear / mean cash.

| Bot | 100 | 1000 |
|---|---|---|
| sensible | 0.662 / 0.269 / 0.732 | 0.690 / 0.288 / 0.743 |
| coasting | 0.233 / 0.011 / 0.872 | 0.215 / 0.010 / 0.887 |
| leave1 | 0.655 / 0 / 0.941 | 0.684 / 0 / 0.953 |
| minSkipFail | 0.092 / 0 / 0.857 | 0.092 / 0 / 0.870 |
| minBossMaxLeave1 | 0.349 / 0 / 0.930 | 0.349 / 0 / 0.938 |
| firstAllInLeave1 | 0.593 / 0 / 0.941 | 0.593 / 0 / 0.944 |

### Assertions (loose)

- Sensible (buy-in 100):
  - clear rates: S1 in [0.58, 0.78], S3 in [0.22, 0.42], S5 in [0.06, 0.20];
  - median run length in [8, 20];
  - rolls: normal in [3, 6], boss in [5, 9], boss above normal.
- Every bot at both buy-ins: runs over 60 fights below 2%.
- Stage-return curve (stages with at least 500 fights):
  - stage 1 in [0.90, 1.00);
  - every step at most 0.12;
  - never rising by more than 0.03;
  - stage 5 at least 0.03 below stage 1 (relaxed from 0.05; the gentler late ramp puts it 0.05 below).
- Other bots:
  - timid, coasting and allIn stage-1 clear below 0.25;
  - sensible stage-1 clear above fixedMedium, coasting, allIn and timid;
  - timid P/W below 0.5 and cash below sensible.
- House return, at buy-in 100 and at 1000:
  - every bot's mean cash below 1.0, the best in [0.90, 0.97];
  - the best low-risk bot (coasting, minSkipFail, minSkipWalk, fixed10) below 0.90, within 0.18 of sensible, and below leave1.
- Broke and pawn: allIn goes broke in over 20% of runs, pawns in over 20%, and cashes out under 0.05.
- Buy-in: |S1@100 - S1@1000| <= 0.07 and |cash@100 - cash@1000| <= 0.05 for sensible.
- Upgrade gains per copy: stage 1 in [0.06, 0.18], stage 2 in [0.03, 0.18].

Rerun `npx vitest run src/core/__tests__/balance.test.ts` (about 35 s) after any tuning change.

## Known gaps and proposals

- **The sensible never-leave bettor still earns less than the low-risk styles** (0.732 against 0.872). The gap narrowed from 0.21 to 0.14 but did not close. A never-leave player always ends on a failed checkpoint and pays the fee, and every stage returns below 1.0 per fight, so the longer a run goes, the more it costs. The best-paying style is now "play a sensible stage, then leave" (0.941), which does engage with the game. The smallest further change within the current rule shapes would be a higher fee (simulated at 15%: coasting 0.824, sensible 0.691, leave1 0.930, a gap of 0.133), but it barely narrows the gap and punishes every run; I did not apply it.
- **Stage-5 clear is 8.1% at buy-in 100** (9.0% at 1000), just inside the 8-18% target. A gentler ramp raises it further, but sensible cash then rises steeply: `enemyBonusCurveMicro` 4500 gave S5 0.118 but a stage curve that rises above 1.0 by stage 4, and 5000 gave sensible cash 1.16. 4000 gave S5 0.084 but put stage 5 only 0.04 below stage 1. 3950 keeps the curve declining with stage 5 0.05 below stage 1. On a second block of seeds, 3950 gave S5 0.085 but a noisier curve (0.94 0.95 0.92 0.92 0.93), so the late-stage curve is flat within sampling noise.
- **Stage-1 return is 0.96.** Leaving after a passed checkpoint is free, so any stage worth more than 1.0 would let "play one stage, then leave" beat the house.
- **Some stage-2+ upgrade gains fall below +0.08**, because the base return per fight is lower there. They are proportionally similar.
- **Coasting clears stage 1 23% of the time**, close to the 25% ceiling.
- **A broke player can swap upgrades.** At 0 coins, picking a new upgrade and pawning an older one pays the same as skipping, but it keeps the newer upgrade. It never pays more coins than skipping.
- **A bankroll of 1 to 10 on a failed checkpoint pays a 1-coin fee**, so a 1-coin bankroll returns 0.
