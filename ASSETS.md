# Assets

How 3D art gets from Blender into the game. The same layout works for any three.js project: copy `tools/assets.mjs`, `src/stage/` and this file.

## Folders

| Folder | What goes in it | In git? |
| --- | --- | --- |
| `assets-src/<place>/` | `.blend` sources, plain `.glb` exports, `scene.json` manifests, loose textures | Yes (`.blend` through Git LFS) |
| `public/assets/<place>/` | What the game loads: optimized `.glb`s and copied manifests and textures, made by `npm run assets` | Yes, so the GitHub Pages build needs no Blender step |

Never edit `public/assets/` by hand: it is rebuilt from `assets-src/`.

## The loop

1. Model and bake in Blender (below).
2. File → Export → glTF 2.0 into `assets-src/<place>/`, with the settings below.
3. `npm run assets` (or `npm run assets -- pub` for one folder): meshes are deduplicated, welded and meshopt-compressed (usually a fifth of the size) into `public/assets/`. It prints triangles, meshes and clips for each file.
4. `npm run dev`, pick the scene in the game's setup, look.
5. `npm test` checks every manifest: the files exist, the environment has `spot_runway`, every actor's node, spots and clips are there, and the triangle budget holds.
6. Commit both `assets-src/` and `public/assets/`.

`npm run blockout` regenerates the grey-box pub in `assets-src/pub/` from code (`tools/make-blockout.mjs`). It is a reference for the conventions, and a stand-in until the real models replace it.

## Units and axes

- 1 Blender unit = 1 metre. Apply scale (Ctrl+A → Scale) before exporting.
- Blender's Z-up becomes three.js's Y-up on export ("+Y Up", on by default).
- The runway runs away from the player along Blender's **+Y** (three.js −Z): the player stands at the −Y end, with `spot_runway` on the hit line and its axes left unrotated. The game places the environment so `spot_runway` sits on the hit line, and scales it by the manifest's `scale` (runway units per metre: the runway is 8.6 units wide, so `scale: 2` makes it 4.3 m).
- Keep the strip within about ±2.2 m of `spot_runway`'s line clear: the runway is drawn over everything there.
- Characters face **−Y** in Blender (three.js +Z, toward the player when unrotated) with their origin at the feet, or at the seat for seated ones.

## Names

| Prefix | What | How the game treats it |
| --- | --- | --- |
| `env_` | The room and everything fixed in it | Drawn unlit, exactly as baked |
| `prop_` | Small things placed at spots (pints, instruments) | Lit by the scene's lights |
| `char_` | People: the root object of a character | Lit; cloned per spot; animated |
| `spot_` | Empties marking where things go: `spot_runway`, `spot_player`, `spot_musician_1`, `spot_crowd_3`, `spot_pint_2` | Positions only; the empty's rotation turns what's placed there |

Number spots from 1. Manifests pick spots with a wildcard (`spot_crowd_*`).

## Baked lighting (straight into the colour texture)

The room's lighting is baked into its colour textures, so the game draws `env_` meshes with no lights at all: cheap on phones, and the lighting looks exactly as it did in Blender.

1. UV-unwrap each `env_` object onto a lightmap-friendly layout (Smart UV Project with some island margin, or pack several objects into one atlas). Use the UV map the texture uses.
2. Cycles → Bake → **Combined** (or Diffuse with Direct, Indirect and Color), into a new image per atlas: 1024–2048 px for the room, 512 px for small fixed things.
3. Before saving the baked image, set the view transform to **Standard** (Render Properties → Color Management), so the image holds the colours you see rather than raw light values. Save it as WebP or PNG.
4. Replace the material's node tree with an Image Texture of the bake → Principled BSDF Base Color (that's all glTF needs). Vertex colours work too and are multiplied in.
5. Leave lamps as emissive geometry baked in; don't export Blender lights.

Characters and props are not baked: they move, so they are lit live by the manifest's lights (and, later, an environment map rendered from inside the pub). Keep their materials simple: Principled BSDF with a base colour texture, roughness and metalness.

## Export settings (glTF 2.0)

- Format: glTF Binary (`.glb`)
- Include: Selected Objects (export the room, the people and the props as separate files), Custom Properties off
- Transform: +Y Up
- Mesh: Apply Modifiers, UVs, Normals; Vertex Colors only if used
- Material: Export; Images: **WebP** (or "Automatic" for PNG)
- Compression: off (the pipeline compresses with meshopt; Draco would make it decompress twice)
- Animation: on; Mode: Actions (each action becomes a clip); Sampling on; Optimize Animation Size

## Animation

- One clip per action, named for what it does: `idle`, `play`, `cheer`, `drink`. With several characters in one file, `char_musician|play` style names are fine; the game matches the part after `|`.
- **`play` clips last one second per beat** (or a whole number of beats: 2 s for a two-beat loop). The game doesn't run them on a clock; it sets them to the music's beat, so they stay in time at any tempo.
- `idle` and other loops run on their own; copies start at different points so a crowd doesn't move in step.
- `cheer` plays (twice) when the player's combo reaches a multiple of `cheerEvery`, then the loop comes back.
- Skinned characters: one armature per `char_`, root bone at the origin, Limit Total Vertex Weights to 4.

## The manifest (`scene.json`)

```json
{
  "name": "The pub (blockout)",
  "environment": "blockout-env.glb",
  "scale": 2,
  "background": "#1a120c",
  "fog": { "color": "#1a120c", "near": 30, "far": 60 },
  "toneMapping": "AgX",
  "exposure": 1,
  "hdri": null,
  "lights": { "hemisphere": { "sky": "#ffd9a8", "ground": "#3a2414", "intensity": 1.6 } },
  "runway": { "spot": "spot_runway", "opacity": 0.85 },
  "actors": [
    { "model": "blockout-people.glb", "node": "char_musician", "at": "spot_musician_*", "clip": "play", "onCombo": "cheer" },
    { "model": "blockout-props.glb", "node": "prop_pint", "at": "spot_pint_*" }
  ],
  "cheerEvery": 25
}
```

- `environment`, `model`: files in the same folder.
- `toneMapping` (`AgX`, `ACES`, `Neutral` or `none`) and `exposure` apply to the lit things only; baked `env_` meshes and the runway are drawn as they are.
- `lights.points`: optional `[{ "at": [x, y, z], "color", "intensity", "distance" }]`, in runway units.
- `runway.opacity`: below 1 lets the floor show through the road.
- `hdri`: reserved for an environment map for the lit things (render a panorama from inside the pub).

Add a scene to the game's "Scene" menu in `play.html` once its manifest exists.

## Budget

For phones: under 100k triangles and 100 draw calls for the whole scene, textures at 2048 px at most, a few MB in all. Each `env_` mesh with its own material is a draw call, so join fixed things that share an atlas into one object. `npm test` fails an environment over 100k triangles.

Later: KTX2 texture compression (smaller in GPU memory) once there are real textures.

## Git LFS for .blend files

`.blend` files are large and change wholesale, so `.gitattributes` sends them through Git LFS. Once per machine: `git lfs install` (install `git-lfs` from your package manager first). The `.glb` files stay in plain git: they're small after optimizing.
