# Necromancer merge autobattler (working title) - playable prototype

A PvE merge autobattler about raising an undead army. Summon cards within a Dominion budget, merge duplicates into stronger
units, place them on a 4x3 formation, press **Battle**, and watch both armies fight automatically. Clear waves to raise your
Dominion cap. Lose a wave and you lose a heart, get a card, and must try a different team.

This is an early prototype: 3 waves, two real 3D units (Skeleton Warrior, Skeleton Archer) and stand-in figures for the rest of the roster.

## Play it

Open the GitHub Pages link for this repository (Settings -> Pages shows the address). It is built for **landscape phones and desktop**.

* Tap a card, then a green tile to summon it. Tap a glowing purple unit to merge the card into it (same Soul, 1 star).
* Tap a unit to select it: **Merge** with a matching unit, move it to a free tile, or **Remove** it (the card is gone for the stage).
* **Swap** (once per round): discard a card or sell a unit you did not summon this round; you draw a *different* Soul.
* Archer, Knight and Ogre have a **skill** that runs on a mana bar (blue, under the health bar): basic attacks and damage taken fill it, a full bar fires the skill (Split Arrow, Taunt, Smash) on the next attack and resets. Warrior, Goblin and Barbarian are passive-only.
* **Sound:** music and sound effects are synthesized in the browser (no audio files). Each has its own on/off switch: the 🎵 / 🔊 buttons in the battle screen, or the **Settings** tab. Choices are saved on the device. Phones only allow sound after the first tap.
* The **gear** button opens the debug panel: live star multipliers and unit stats, difficulty (easy / normal / hard), "Test odds",
  a copy-paste state report and a "last tap" line for diagnosing touch problems. Add `?seed=7` to the link to replay the same draws.
* **Home-screen app (iPhone):** Share -> Add to Home Screen. After an update, delete the old icon and add it again so the phone loads the new version.

## Run it on your own machine

```
cd NecroAutobattler
node serve.cjs 8081        # then open http://localhost:8081/   (it also prints a phone URL for your Wi-Fi)
```

Rebuild after editing: `./build_all.ps1` builds both the game bundle (`game/*.ts` -> `docs/game.js`) and the navigation shell (`shell/` -> `docs/index.html` etc). `./build_game.ps1` alone rebuilds just the game. Run `npm install` once in `NecroAutobattler` and once in `NecroAutobattler/shell`.

## Project layout

| Folder | What |
|---|---|
| `NecroAutobattler/core` | Pure game logic: rules (cards, Dominion, merge, waves, hearts), battle engine, unit stats, enemy waves. No graphics. |
| `NecroAutobattler/shell` | The Angular navigation shell: tab rail (Battle, Campaign, Souls, Shop) and the pages. The 3D game is mounted once inside it and paused when another tab is open. Builds into `docs/`. |
| `NecroAutobattler/game` | The Babylon.js game screen: visuals, star looks, UI, camera, debug panel. |
| `NecroAutobattler/sim` | Simulations used for balance (`node sim/run.ts`, `campaign.ts`, `tune_waves.ts`, `inflow.ts`). |
| `NecroAutobattler/tests` | `node --test tests/battle.test.ts tests/rules.test.ts` |
| `NecroAutobattler/docs` | The website that GitHub Pages serves (index.html, game.js, vendor, assets). |
| `Pipeline` | Blender scripts that turn a Tripo character + weapons into a rigged, animated GLB. See `Pipeline/README_WORKFLOW.md`. |

All balance numbers live in one file: `NecroAutobattler/core/balance.ts`.

## Assets

The two 3D characters were generated with Tripo from concept art and rigged with the scripts in `Pipeline`. Third-party code:
Babylon.js (Apache-2.0), included as `docs/vendor/babylon.js`.
