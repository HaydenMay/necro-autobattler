# Tripo → game-ready unit: the repeatable workflow

Goal: a new character costs **one Tripo generation + ~2 chat messages + ~15 seconds of compute**, not a long session.

## 0. Rules of thumb (these save Tripo credits AND chat tokens)

| Do | Don't |
|---|---|
| Export the **body unsegmented** (single mesh). `rig_unit.py` finds the loose parts itself (66 on the archer). | Don't use Tripo's segmentation. It costs an extra step, cut the bow from 10,052 to 2,573 triangles, and gave a jagged fletching. |
| Generate **weapons as their own model**, also unsegmented (bow + arrow in one file is fine; the pipeline splits bow / string / arrow automatically). | Don't try to bake a weapon into the character if it needs to animate (bow draw, sheathing, swapping). |
| Ask Tripo for a **standing A-pose or T-pose, arms slightly away from the body, feet flat on the floor, facing the camera**. | Don't accept a dramatic hero pose as the model: it can't be rigged cleanly. Keep hero poses for concept art only. |
| Keep the **same Tripo settings** for every unit so the pipeline assumptions (metres, feet on z=0, facing -Y) hold. | |

## 1. Per new character (the whole loop)

1. **Tripo**: generate body (+ weapon file if any). Download the FBX zips.
2. Drop the zips in `Pipeline\input\`.
3. Look at it (5 seconds):
   `.\run_inspect.ps1 input\<body>.zip`
   It prints triangle count / loose parts and writes two grid images (`out\*_grid_front.png`, `*_grid_side.png`).
4. **Landmarks** (the only step that needs eyes): copy `units\skeleton_archer.json`, then read ~14 points off the grid images
   (pelvis, spine, chest, neck, head, head_top, shoulder, elbow, wrist, hand_end, hip, knee, ankle, toe; left side = +X plus the centre line).
   *Chat shortcut:* send me the two grid images and the zip names and I fill in the JSON.
5. **Run it**: `.\run_unit.ps1 units\<unit>.json` → about 11 seconds.
6. Check `out\<Name>_qa.png` (all clips as contact sheet) and open `BabylonTest\unit.html?unit=<Name>` (copy the outputs into `BabylonTest\assets\`).

Outputs in `out\`:

| File | What |
|---|---|
| `<Name>.glb` | body + props, 20 bones, all clips baked to plain bone keys (no IK left in the file) |
| `<Name>_arrow.glb` | separate projectile (points +Z in the engine) |
| `<Name>_enemy.png` | same texture with the purple eyes recoloured amber. **Same mesh**, swap the texture at runtime for enemy team |
| `<Name>_qa.png` | contact sheet of every clip |
| `<Name>.blend` | the rig, for hand-tweaks in Blender |

## 2. What the pipeline does automatically

* unzips + imports, joins parts, splits props by loose parts (string = long+thin on the bow side; arrow = far side)
* builds armature + IK controllers from landmarks; **auto-picks the IK pole angles** (no trial and error)
* skins: loose parts smaller than `rigid_island_max` (default 0.30 m) bind rigidly to the nearest bone; bigger ones blend between the two nearest bones
* bow on the hand, **string bones that follow the drawing hand**, **nocked arrow that appears only while drawing** (bone scale)
* clips (archer set): Idle, Walk, Run, Shoot, Flex, Hit, Death, Spawn; baked so any engine can play them
* enemy-eye texture variant, GLB export, QA sheet

## 3. Adding another character type

* Humanoid with a **bow**: reuse `"clips": "archer"` as is.
* Humanoid with **sword/axe/mace/shield**: needs a melee clip set (Attack, Block). The old skeleton-warrior clips are the template; porting them into `CLIPSETS` in `rig_unit.py` is a one-time job (say so and I'll do it once for all melee units).
* Non-humanoid (bat, etc.) is outside the v1 roster.

## 4. Known limits (all fixable, none blocking)

* Torso pieces of cloth/quiver can look messy in extreme poses (Shoot, Death): tune `weights.rigid_island_max` / `power` in the JSON.
* Body is ~10k triangles. Fine for 24 units on desktop; for phones decimate to ~5–6k (a `decimate_ratio` option is the next small addition).
* `<Name>_enemy.png` is 4.9 MB as PNG. Convert to a 1024px JPG for shipping.
* Purple eyes are painted into the texture, so the enemy variant is a recolour, not a different eye shape. Expressions would need swappable eye pieces (not built).
* Clip timing is a first pass; stat/animation speed is meant to be tuned in the game with the debug panel.

## 5. What to send me for the next character (copy/paste)

> New unit: `<zip names>`. Holds `<weapon>` in `<left/right>` hand. Clip set: `<archer|melee>`. Grid images attached.

That is all the context needed; no need to re-explain the pipeline.

## 6. Triangle budgets (tested, not guessed)

Tested on the archer: body 10,115 -> 6,000 triangles, bow 6,191 -> 2,499, arrow 3,733 -> 799 looked identical, close up and posed
(the painted texture carries the look; the camera is far away in play).

| Asset | Set this face limit in Tripo | Why |
|---|---|---|
| Character body incl. worn gear (chibi) | **6,000 - 8,000** (big units like the Ogre up to 9,000) | more is invisible at gameplay distance |
| One weapon (sword, axe, mace, shield) | **2,000 - 3,000** | simple shapes need very little |
| Bow + arrow in ONE file | **about 4,000 total** | the limit is shared: my test file spent 3,733 triangles on a plain arrow |
| Small props (buckler, quiver if separate) | 800 - 1,500 | |

* The face limit covers the WHOLE generation. Two pieces in one file share it (5,000 total = about 2,500 each), so a simple item that
  sits beside a detailed one wastes the budget. Generate weapons one per file where you can.
* One unit costs about 6,000 + 2,500 + 800 = roughly 9,000 triangles, so a 12 v 12 board is about 220,000 triangles: comfortable.
* **Free safety net:** if you are unsure, generate a little high and let the pipeline shrink it. Add to the unit JSON:
  `"decimate": { "body": 6000, "bow": 2500, "arrow": 800 }`  (see `units\skeleton_archer_lo.json`). Shrinking is free; adding detail later is not.
* Arrows and other trivial shapes do not need Tripo at all; the viewer can build a procedural arrow for free.

## 7. Update (Ogre, Sep 2026): the recommended path for every new Soul

1. **Generate with Tripo, Smart Mesh, low-poly, a fixed triangle count (about 6,000-12,000), triangles not quads.** Same relaxed A-pose, empty hands, weapon as its own generation. A clean retopo is what makes skinning good. (A raw Hunyuan mesh, 500k triangles, could not be skinned: decimating it tore the texture and the waist/vest stretched; Blender's automatic weights found no solution on it. `blender/decimate_body.py` is the fallback for a heavy mesh: it welds seam duplicates, decimates, re-bakes the colour, and can stand a weapon upright.)
2. Put the GLB in `input/<unit>/`. Look at it: `blender -b -P blender/inspect_model.py -- input/<unit>/body.glb` (writes the labelled grids in `out/`). Fill the landmarks in `units/<unit>.json` (copy `units/ogre.json`).
3. `"body_glb"` instead of `"body_zip"`; `"weapon": {"glb", "hand", "rotate_deg", "offset"}` for a held item; `"weights": {"method": "auto"}` uses Blender bone-heat weights. **The rig welds vertices that image-to-3D duplicated along texture seams first** (otherwise bone heat fails with zero weights).
4. `blender -b -P blender/rig_unit.py -- units/<unit>.json` (about 12 s). Textures above 2048 px are shrunk (`"texture_px"`).
5. **Check the skinning with numbers, not just eyes:** `blender -b out/<Name>.blend -P blender/stretch_check.py -- Idle:10 Attack:16 ...` counts edges stretched past 2.2x (the Ogre went from 259-756 to 0-6). Look at frames: `blender -b out/<Name>.blend -P blender/clip_frames.py -- out/frames.png Idle:0 Attack:16 ...`.
6. Copy `out/<Name>.glb` and `out/<Name>_enemy.jpg` to `docs/assets/`, add one line to `game/visuals.ts` (clip names) and a portrait: `blender -b -P blender/render_portrait.py -- docs/assets/<Name>.glb out/portraits/x_head.png Idle 10 22 head` (add to `ui/portraits.ts`).
