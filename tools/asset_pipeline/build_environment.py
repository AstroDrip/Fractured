"""
Builds environment assets in Blender (headless):

    blender --background --factory-startup --python tools/asset_pipeline/build_environment.py -- <out_dir> [<out.blend>]

Writes:
  fallen_pole.glb  the fallen telegraph pole: a tapered, slightly bowed, faceted shaft
                   with a snapped, splintered base; a bevelled crossarm and two insulators.
                   Origin at the shaft's centre; shaft along +X, 9.6 m long.
  rocks.glb        three rock variants (rockA/B/C): noise-displaced, flattened masses cut by
                   two or three fracture planes (sharp faces), ~1 m across, origin at the base.
All seeded, so a rebuild gives the same shapes. Materials are named for the game to swap
(timber, insulator, stone). Blender Z-up; the glTF exporter converts to Y-up.
"""
import bpy, bmesh, math, sys, random
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '.'
OUT_BLEND = argv[1] if len(argv) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def mat(name, rgb, rough=0.9):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    return m
M_TIMBER = mat('timber', (0.30, 0.24, 0.18))
M_INSUL = mat('insulator', (0.22, 0.26, 0.25), 0.4)
M_STONE = mat('stone', (0.36, 0.36, 0.37))

def obj_from_bm(bm, name, m):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    o.data.materials.append(m)
    return o

def shade(o, angle=0.6):
    for p in o.data.polygons: p.use_smooth = True
    # Sharp where faces meet at a hard angle (fracture planes, splinters), smooth elsewhere
    mod = o.modifiers.new('sharp', 'EDGE_SPLIT'); mod.split_angle = angle

def apply_all(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    o.modifiers.clear(); old = o.data; o.data = me; bpy.data.meshes.remove(old)

# --- Fallen telegraph pole ----------------------------------------------------------
rng = random.Random(86)
L, SEG, RINGS = 9.6, 9, 22
bm = bmesh.new()
rings = []
for r in range(RINGS + 1):
    t = r / RINGS
    x = -L / 2 + L * t
    rad = 0.135 - 0.03 * t                       # tapers toward the top
    bow = -math.sin(t * math.pi) * 0.06          # a slight sag along its length
    ring = []
    for s in range(SEG):
        a = (s / SEG) * math.pi * 2
        wob = 1 + (rng.random() - 0.5) * 0.08    # hand-cut, not lathe-turned
        y = math.cos(a) * rad * wob
        z = math.sin(a) * rad * wob + bow
        ring.append(bm.verts.new((x, y, z)))
    rings.append(ring)
for r in range(RINGS):
    for s in range(SEG):
        bm.faces.new((rings[r][s], rings[r][(s + 1) % SEG], rings[r + 1][(s + 1) % SEG], rings[r + 1][s]))
# Top: a flat cut with a small chamfer
top = bm.faces.new(rings[-1])
# Base: snapped. Each base vertex is pushed out to a different length -> splinters
for v in rings[0]:
    v.co.x -= rng.random() * 0.45
centre = bm.verts.new((-L / 2 - 0.15, 0, 0))
for s in range(SEG):
    bm.faces.new((rings[0][(s + 1) % SEG], rings[0][s], centre))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
pole = obj_from_bm(bm, 'fallenPole', M_TIMBER)
shade(pole, 0.9)

def bevel_box(name, size, loc, rot, m, off=0.012):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=off, segments=2, affect='EDGES')
    o = obj_from_bm(bm, name, m); o.location = loc; o.rotation_euler = rot
    return o

# Crossarm near the top, knocked askew; two insulators on it
arm = bevel_box('crossarm', (0.1, 1.5, 0.11), (L / 2 - 0.55, 0, 0.16), (0.25, 0, 0.08), M_TIMBER)
insuls = []
for k, yy in enumerate((-0.55, 0.55)):
    bm = bmesh.new()
    prof = [(0.0, 0.0), (0.045, 0.0), (0.05, 0.03), (0.035, 0.05), (0.05, 0.08), (0.03, 0.11), (0.0, 0.12)]
    verts_prev = None
    seg = 10
    rings_i = []
    for (rr, zz) in prof:
        ring = [bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, zz)) for a in [i / seg * math.pi * 2 for i in range(seg)]]
        rings_i.append(ring)
    for i in range(len(rings_i) - 1):
        for s in range(seg):
            bm.faces.new((rings_i[i][s], rings_i[i][(s + 1) % seg], rings_i[i + 1][(s + 1) % seg], rings_i[i + 1][s]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(bm, f'insulator{k}', M_INSUL)
    o.location = (L / 2 - 0.55, yy, 0.22); o.rotation_euler = (0.25, 0, 0)
    for p in o.data.polygons: p.use_smooth = True
    insuls.append(o)

for o in [pole, arm] + insuls:
    bpy.context.view_layer.objects.active = o; apply_all(o)
for o in scene.objects: o.select_set(False)
for o in [pole, arm] + insuls: o.select_set(True)
bpy.context.view_layer.objects.active = pole
bpy.ops.object.join()
pole.name = 'fallenPole'
tris = sum(len(p.vertices) - 2 for p in pole.data.polygons)
print(f'[env] fallenPole triangles={tris}')
bpy.ops.export_scene.gltf(filepath=f'{OUT}/fallen_pole.glb', export_format='GLB', use_selection=True, export_yup=True)

# --- Rocks ---------------------------------------------------------------------------
rock_objs = []
for k, seed in enumerate((11, 23, 37)):
    r = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.5)
    off = Vector((r.random() * 10, r.random() * 10, r.random() * 10))
    for v in bm.verts:
        n = noise.noise(v.co * 2.2 + off) * 0.18 + noise.noise(v.co * 5.0 + off) * 0.05
        v.co *= 1 + n
        v.co.x *= 1.0 + 0.4 * k * 0.5; v.co.z *= 0.62 - k * 0.06   # flattened, each a different mass
        v.co.z += 0.28
    # Fracture planes: hard cuts through the mass
    for c in range(2 + k % 2):
        nrm = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(0.2, 1))).normalized()
        co = nrm * r.uniform(0.18, 0.3) + Vector((0, 0, 0.28))
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=nrm, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.edgeloop_fill(bm, edges=edges)
    # Sit it on the ground
    zmin = min(v.co.z for v in bm.verts)
    for v in bm.verts: v.co.z -= zmin + 0.04
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(bm, 'rock' + 'ABC'[k], M_STONE)
    shade(o, 0.7)
    bpy.context.view_layer.objects.active = o; apply_all(o)
    o.location = (k * 1.6, 0, 0)
    rock_objs.append(o)
    print(f'[env] rock{"ABC"[k]} triangles={sum(len(p.vertices) - 2 for p in o.data.polygons)}')
for o in scene.objects: o.select_set(False)
for o in rock_objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=f'{OUT}/rocks.glb', export_format='GLB', use_selection=True, export_yup=True)

if OUT_BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print('[env] exported to', OUT)
