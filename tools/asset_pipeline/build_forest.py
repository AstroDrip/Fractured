"""
Builds the forest asset family in Blender (headless, seeded):

    blender --background --factory-startup --python tools/asset_pipeline/build_forest.py -- <out_dir> [<out.blend>]

forest.glb meshes (origin at the base, +Z up in Blender -> +Y in glTF):
  treeTall0/1     tall, narrow, slightly curved trunks with sparse high branching
  treeTwisted0/1  old, uneven trunks leaning and turning, heavy asymmetric limbs, root flare
  treeDead0/1     broken trunks with splintered tops, few stubs, pale wood
  roots0          a lattice of exposed roots arching out of the ground
  fallen0/1       fallen trunks: one with a torn root plate, one snapped in two
  stump0          a broken stump with splinters
Trunks and limbs are tubes along bent paths with tapering, slightly irregular rings
(7–9 sides): low-poly but shaped. Splinters and breaks are hard-edged.
"""
import bpy, bmesh, math, sys, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '.'
OUT_BLEND = argv[1] if len(argv) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def mat(name, rgb):
    m = bpy.data.materials.new(name); m.diffuse_color = (*rgb, 1); return m
M_BARK = mat('bark', (0.2, 0.18, 0.16))
M_DEAD = mat('deadwood', (0.52, 0.48, 0.42))

def tube(bm, path, radii, sides, rng, jag_end=False, rough=0.12):
    """A tapered tube along `path` (list of Vector), ring radius per point."""
    rings = []
    for i, p in enumerate(path):
        if i < len(path) - 1: d = (path[i + 1] - p).normalized()
        else: d = (p - path[i - 1]).normalized()
        a = d.orthogonal().normalized(); b = d.cross(a).normalized()
        ring = []
        for s in range(sides):
            t = s / sides * math.pi * 2
            r = radii[i] * (1 + (rng.random() - 0.5) * rough)
            ring.append(bm.verts.new(p + a * math.cos(t) * r + b * math.sin(t) * r))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(sides):
            bm.faces.new((rings[i][s], rings[i][(s + 1) % sides], rings[i + 1][(s + 1) % sides], rings[i + 1][s]))
    # Ends: a splintered point for breaks, otherwise a small cap
    end = rings[-1]
    tip = path[-1] + (path[-1] - path[-2]).normalized() * (radii[-1] * (2.5 if jag_end else 0.6))
    if jag_end:
        for v in end:
            v.co += (path[-1] - path[-2]).normalized() * rng.random() * radii[-1] * 3
    c = bm.verts.new(tip)
    for s in range(sides): bm.faces.new((end[s], end[(s + 1) % sides], c))
    return rings

def bent_path(base, direction, length, n, bend, rng, wander=0.15):
    path = [Vector(base)]
    d = Vector(direction).normalized()
    side = d.orthogonal().normalized()
    for i in range(1, n + 1):
        t = i / n
        d = (d + Vector((rng.uniform(-wander, wander), rng.uniform(-wander, wander), rng.uniform(-wander * 0.4, wander * 0.4))) + side * bend * 0.12).normalized()
        path.append(path[-1] + d * (length / n))
    return path

def branch(bm, start, direction, length, r0, depth, rng, max_depth, spread, sides=6):
    path = bent_path(start, direction, length, 4, rng.uniform(-1, 1), rng, 0.22)
    radii = [r0 * (1 - 0.75 * (i / 4)) for i in range(5)]
    tube(bm, path, radii, sides, rng, jag_end=(depth == max_depth and rng.random() < 0.3))
    if depth >= max_depth: return
    for k in range(rng.randint(1, 3)):
        i = rng.randint(2, 4)
        p = path[i]
        d0 = (path[i] - path[i - 1]).normalized()
        out = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.1, 0.6))).normalized()
        nd = (d0 * 0.6 + out * spread).normalized()
        branch(bm, p, nd, length * rng.uniform(0.45, 0.7), radii[i] * 0.7, depth + 1, rng, max_depth, spread, max(5, sides - 1))

def tree(name, seed, kind):
    rng = random.Random(seed)
    bm = bmesh.new()
    if kind == 'tall':
        H = rng.uniform(9, 12)
        trunk = bent_path((0, 0, -0.2), (rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 1), H, 10, rng.uniform(-0.3, 0.3), rng, 0.04)
        radii = [0.24 * (1 - 0.78 * (i / 10)) + (0.08 if i == 0 else 0) for i in range(11)]
        tube(bm, trunk, radii, 8, rng)
        for i in range(6, 10):                      # sparse, high, short limbs
            if rng.random() < 0.75:
                out = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.3, 0.9))).normalized()
                branch(bm, trunk[i], out, rng.uniform(1.2, 2.4), radii[i] * 0.6, 1, rng, 2, 0.6, 6)
        m = M_BARK
    elif kind == 'twisted':
        H = rng.uniform(5.5, 7.5)
        trunk = bent_path((0, 0, -0.2), (rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), 1), H, 9, rng.uniform(-0.9, 0.9), rng, 0.16)
        radii = [0.42 * (1 - 0.6 * (i / 9)) * (1 + 0.18 * math.sin(i * 1.7)) for i in range(10)]
        tube(bm, trunk, radii, 9, rng, rough=0.22)
        for i in (3, 5, 6, 8):                      # heavy, low, asymmetric limbs
            out = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.2, 0.5))).normalized()
            branch(bm, trunk[i], out, rng.uniform(2.2, 3.6), radii[i] * 0.62, 1, rng, 3, 0.9, 7)
        for k in range(5):                          # root flare
            a = k / 5 * math.pi * 2 + rng.random()
            path = [Vector((math.cos(a) * 0.15, math.sin(a) * 0.15, 0.5))]
            for j in range(1, 5):
                path.append(Vector((math.cos(a) * (0.15 + j * 0.35), math.sin(a) * (0.15 + j * 0.35), 0.5 - j * 0.17 - (0.08 if j == 4 else 0))))
            tube(bm, path, [0.18, 0.14, 0.1, 0.07, 0.04], 6, rng)
        m = M_BARK
    else:  # dead
        H = rng.uniform(4.5, 7)
        trunk = bent_path((0, 0, -0.2), (rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.2), 1), H, 7, rng.uniform(-0.8, 0.8), rng, 0.12)
        radii = [0.3 * (1 - 0.45 * (i / 7)) for i in range(8)]
        tube(bm, trunk, radii, 7, rng, jag_end=True, rough=0.18)
        for i in (2, 4, 5):
            if rng.random() < 0.7:
                out = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.0, 0.5))).normalized()
                p = bent_path(trunk[i], out, rng.uniform(0.6, 1.4), 2, 0, rng, 0.1)
                tube(bm, p, [radii[i] * 0.45, radii[i] * 0.35, radii[i] * 0.25], 5, rng, jag_end=True)
        m = M_DEAD
    return finish(bm, name, m)

def finish(bm, name, m):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = True
    mod = o.modifiers.new('sharp', 'EDGE_SPLIT'); mod.split_angle = math.radians(55)
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg)); o.modifiers.clear(); o.data = me2
    print(f'[forest] {name} triangles={sum(len(p.vertices) - 2 for p in o.data.polygons)}')
    return o

objs = []
objs += [tree('treeTall0', 3, 'tall'), tree('treeTall1', 17, 'tall')]
objs += [tree('treeTwisted0', 5, 'twisted'), tree('treeTwisted1', 29, 'twisted')]
objs += [tree('treeDead0', 7, 'dead'), tree('treeDead1', 41, 'dead')]

# Root lattice: roots arching out of the ground and back into it, interlocked
rng = random.Random(99)
bm = bmesh.new()
for k in range(11):
    x0 = rng.uniform(-3.5, 3.5); x1 = x0 + rng.uniform(-2.5, 2.5)
    y0 = rng.uniform(-0.8, 0.8); hgt = rng.uniform(0.8, 2.0)
    path = []
    for j in range(9):
        t = j / 8
        path.append(Vector((x0 + (x1 - x0) * t, y0 + math.sin(t * 3 + k) * 0.35, -0.2 + math.sin(t * math.pi) * hgt)))
    r = rng.uniform(0.07, 0.16)
    tube(bm, path, [r * (0.6 + 0.4 * math.sin(j / 8 * math.pi)) + 0.02 for j in range(9)], 6, rng)
objs.append(finish(bm, 'roots0', M_BARK))

# Fallen trunks
for k, seed in enumerate((61, 73)):
    rng = random.Random(seed)
    bm = bmesh.new()
    L = rng.uniform(7, 9)
    path = bent_path((-L / 2, 0, 0.35), (1, 0, rng.uniform(-0.03, 0.03)), L * (0.55 if k == 1 else 1), 8, rng.uniform(-0.5, 0.5), rng, 0.05)
    radii = [0.38 * (1 - 0.4 * (i / 8)) for i in range(9)]
    tube(bm, path, radii, 8, rng, jag_end=(k == 1))
    if k == 0:   # torn root plate at the base
        for a in range(9):
            ang = a / 9 * math.pi * 2
            rp = [Vector((-L / 2, 0, 0.35)) + Vector((-0.1, math.cos(ang) * j * 0.32, math.sin(ang) * j * 0.32)) for j in range(4)]
            tube(bm, rp, [0.12, 0.09, 0.06, 0.03], 5, rng)
    else:        # the other half, lying askew
        p2 = bent_path((L * 0.12, 0.6, 0.3), (0.8, 0.5, 0), L * 0.4, 5, 0.3, rng, 0.05)
        tube(bm, p2, [0.27 * (1 - 0.3 * i / 5) for i in range(6)], 8, rng, jag_end=True)
    objs.append(finish(bm, f'fallen{k}', M_BARK))

# Stump
rng = random.Random(81)
bm = bmesh.new()
path = [Vector((0, 0, -0.1)), Vector((0, 0, 0.35)), Vector((0.02, 0, 0.7))]
tube(bm, path, [0.42, 0.34, 0.3], 9, rng, jag_end=True, rough=0.25)
objs.append(finish(bm, 'stump0', M_DEAD))

# Lay them out apart (export keeps object transforms; origins stay at each base)
for i, o in enumerate(objs): o.location = (0, 0, 0)
for o in scene.objects: o.select_set(False)
for o in objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=f'{OUT}/forest.glb', export_format='GLB', use_selection=True, export_yup=True)
if OUT_BLEND: bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print('[forest] exported')
