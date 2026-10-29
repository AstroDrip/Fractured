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
| Void | near-black 0.024/0.028/0.036 | fog; sky light −65 % |

## Shape language and scales
- **Monumental:** the floating landmass (stepped rock, village on top, inverted village and garden beneath, white tower into haze) — still, never animated except a sideways river and four tiny travelling lights. The white wall (38 m) is taller than the camera ever shows.
- **Traversable:** railway bed, shoulders, wall face; flat walkable ground with vaultable low obstacles.
- **Collisions of environments:** a forest edge village beside the line; a river running sideways off a landmass; an interior deeper than its wall; a garden on an underside.
- **Unobservable distance:** fog, far tree lines rising out of the fog floor, station silhouettes, poles continuing past the end of the world, the moving light.

## Materials (three levels)
1. Form and silhouette first (stepped terrain plateaus, slab architecture, thin poles and wires).
2. Material identity: procedural timber grain, rust blooms, concrete streaks, fabric weave, bark fissures; normal maps derived from the same height as colour.
3. Selective detail: fasteners, fish plates, shards, footprints, ballast — never full-surface grunge.

## Reality grammar
| | Normal | Void | Deranged |
| --- | --- | --- | --- |
| Matter | complete | ~70 % removed in irregular world-space sections; within the flame's radius it stays; faint cold edges; shadows of removed matter remain | complete, but bands slide out of agreement |
| Light | sky + moon | sky nearly gone; flame is the light | sky from below; moon moves (shadows disagree) |
| Sound | wind, creaks | near silence | larger space |
| Distance | haze | silhouettes remain where the world is gone | the landmass appears twice; the light gains an echo moving backward |

## Camera and composition
Iso follow (pitch ≈ 41°, 17 m) for readable traversal. Three authored vantages lower the
camera and turn it down the line where the horizon carries the story (first sight of the
light, across the gap, toward the end). Two scripted shots: the landmass reveal (real
dolly back and around, camera looking up past the protagonist) and the finale.

## Post
Standard tone mapping, cool shadows / warm highlights, −8 saturation, vignette, light
grain, restrained bloom (threshold 0.62). No permanent distortion; one radial split from
the flame when phasing.

## Known art debt
Blocky procedural forms throughout; no authored textures, models or rig; the protagonist
is a box figure; Void edge cells can read as confetti when realities oscillate (finale).
