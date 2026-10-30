# Art Direction

**One line:** a quiet, tangible railway world that looks understandable until it is not —
dark teal, storm grey and soil browns, strong silhouettes in haze, one warm flame.

## Palette
| Role | Values (approx.) | Use |
| --- | --- | --- |
| Air / sky | blue-grey 0.07–0.13 | fog and clear colour, by zone |
| Ground | soil 0.19/0.155/0.115, moss, dead grass, ballast grey | terrain vertex colour |
| Built matter | concrete, white stone (pale), timber, rusted steel | shared materials only |
| Warm accent | amber 1.0/0.6–0.86/0.27–0.62 | palm fire, signal lamp, moving light, one lit window — nothing else |
| Cold accent | chalk-cyan 0.55/0.78/0.88 | Void spans, phase residue, Void edges (dim) |
| Deranged | greenish grey 0.085/0.10/0.094 | fog only; light comes from below |
| Void | absolute black 0/0/0 beyond the flame; white 0.95 ground and dark 0.045 silhouettes inside its fragment | fog, sky and clear colour |

## Shape language and scales
- **Monumental:** the floating landmass (stepped rock, village on top, inverted village and garden beneath, white tower into haze) — still, never animated except a sideways river and four tiny travelling lights. The white wall (38 m) is taller than the camera ever shows.
- **Traversable:** railway bed, shoulders, wall face; flat walkable ground with vaultable low obstacles.
- **Collisions of environments:** a forest edge village beside the line; a river running sideways off a landmass; an interior deeper than its wall; a garden on an underside.
- **Unobservable distance:** fog, far tree lines rising out of the fog floor, station silhouettes, poles continuing past the end of the world, the moving light.

## Materials (three levels)
1. Form and silhouette first (stepped terrain plateaus, slab architecture, thin poles and wires).
2. Material identity: procedural timber grain, rust blooms, concrete streaks, fabric weave, bark fissures; normal maps derived from the same height as colour.
3. Selective detail: fasteners, fish plates, shards, footprints, ballast — never full-surface grunge.

> The binding standard is now [VISUAL_BIBLE.md](VISUAL_BIBLE.md) (pass 13); this file keeps the earlier notes.

## Reality grammar
| | Normal | Void | Deranged |
| --- | --- | --- | --- |
| Matter | complete | objects ~70 % removed in irregular sections (ground and grass stay whole); within the flame's radius it stays | complete, but bands slide out of agreement |
| Image | as lit | **black beyond the flame's white fragment** (ragged edge, radius 6.4 m full → 1.8 m empty, edge shakes and detail thins as fuel falls); ground white, objects dark silhouettes, the flame deep amber and blended over the white; bloom and grading fall away | as lit |
| Light | sky + moon | sky nearly gone; flame is the light | sky from below; moon moves (shadows disagree) |
| Sound | wind, creaks | near silence | larger space |
| Distance | haze | nothing: no horizon, sky, vista, fog or mist; wires and ropes go; the Void's own traces stay as dark residue | the landmass appears twice; the light gains an echo moving backward |

## Camera and composition
Iso follow (pitch ≈ 41°, 17 m) for readable traversal. Three authored vantages lower the
camera and turn it down the line where the horizon carries the story (first sight of the
light, across the gap, toward the end). Two scripted shots: the landmass reveal (real
dolly back and around, camera looking up past the protagonist) and the finale.

## Post
Standard tone mapping, cool shadows / warm highlights, −8 saturation, vignette, light
grain, restrained bloom (threshold 0.62). No permanent distortion; one radial split from
the flame when phasing.

## Known art debt (as of pass 5, 2026-10-30)
- Everything is procedural geometry built in code: no authored textures, imported models
  or skinned rigs. No asset-generation tool was available.
- Protagonist: an articulated procedural figure (shaped limbs, lathed torso, hood shell,
  open coat panels) on a transform hierarchy. Reads as a hooded, slender figure at the
  play distance; up close the joints are visibly simple shapes. Not a production character.
- Creatures: rebuilt from shaped parts (pass 5): the Hound (hunched torso, ribs, spines,
  eyeless snout, two-joint legs), the Watcher (over-long tapered limbs, tilted narrow
  head), Drifters (dark shard cores with trailing threads). Still primitive up close.
- Terrain is a voxel heightfield: the cutting's cliff reads as stepped courses, not rock.
- Void edge cells can read as confetti when realities oscillate (finale).
- Water exists only in the cutting's stream and fall (scrolling normal map, alpha sheet);
  no reflections beyond the specular highlight.
