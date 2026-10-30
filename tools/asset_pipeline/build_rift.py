"""
Builds the rift's landmark pieces in Blender (headless, seeded):

    blender --background --factory-startup --python tools/asset_pipeline/build_rift.py -- <out_dir> [<out.blend>]

rift.glb:
  riftSlab   a slab of land ~16 x 9 m, 2.4 m thick: an earth top, a broken underside cut by
             fracture planes, and roots hanging from one long edge (two materials: earth, bark).
             Origin at its centre; it is posed (tilted nearly upright) in the game.
  riftMass   a held mass of rock ~4 m: flat fractured top, tapering broken underside.
"""
import bpy, bmesh, math, sys, random
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '.'
OUT_BLEND = argv[1] if len(argv) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
def mat(n, c):
    m = bpy.data.materials.new(n); m.diffuse_color = (*c, 1); return m
M_EARTH = mat('earth', (0.3, 0.27, 0.24)); M_BARK = mat('bark', (0.2, 0.18, 0.16))

def finish(bm, name, materials):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    for m in materials: o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = True
    mod = o.modifiers.new('sharp', 'EDGE_SPLIT'); mod.split_angle = math.radians(45)
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg)); o.modifiers.clear(); o.data = me2
    print(f'[rift] {name} triangles={sum(len(p.vertices) - 2 for p in o.data.polygons)}')
    return o

# --- Slab ------------------------------------------------------------------------
rng = random.Random(404)
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1)
for v in bm.verts: v.co = Vector((v.co.x * 16, v.co.y * 9, v.co.z * 2.4))
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=5, use_grid_fill=True)
off = Vector((3.1, 7.7, 1.9))
for v in bm.verts:
    top = v.co.z > 1.1
    n = noise.noise(v.co * 0.35 + off)
    if top: v.co.z += n * 0.25                      # the old ground surface: gentle
    else: v.co.z -= abs(n) * 1.6 + 0.2              # the broken underside: deep, uneven
    v.co.x += noise.noise(v.co * 0.5 + off * 2) * 0.35
# Fracture planes through the underside and one corner: hard cuts
for k in range(3):
    nrm = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), -rng.uniform(0.6, 1))).normalized()
    co = Vector((rng.uniform(-5, 5), rng.uniform(-3, 3), -1.6))
    res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=nrm, clear_outer=True)
    edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
    if edges: bmesh.ops.edgeloop_fill(bm, edges=edges)
for f in bm.faces: f.material_index = 0
# Roots hanging from one long edge (the edge that ends up lowest in the game's pose)
for k in range(10):
    x0 = -7 + k * 1.5 + rng.uniform(-0.4, 0.4)
    base = Vector((x0, 4.3, rng.uniform(-0.6, 0.8)))
    pts = [base]
    for j in range(1, 7):
        pts.append(pts[-1] + Vector((rng.uniform(-0.25, 0.25), 0.55 + rng.uniform(0, 0.25), rng.uniform(-0.2, 0.2))))
    rings = []
    for i, p in enumerate(pts):
        r = 0.12 * (1 - i / 7) + 0.02
        d = (pts[min(i + 1, 6)] - pts[max(i - 1, 0)]).normalized()
        a = d.orthogonal().normalized(); b = d.cross(a)
        ring = [bm.verts.new(p + (a * math.cos(t) + b * math.sin(t)) * r) for t in [s / 5 * math.pi * 2 for s in range(5)]]
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(5):
            f = bm.faces.new((rings[i][s], rings[i][(s + 1) % 5], rings[i + 1][(s + 1) % 5], rings[i + 1][s])); f.material_index = 1
slab = finish(bm, 'riftSlab', [M_EARTH, M_BARK])

# --- Held mass -----------------------------------------------------------------------
rng = random.Random(505)
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=3, radius=2.0)
for v in bm.verts:
    v.co *= 1 + noise.noise(v.co * 0.8 + Vector((9, 1, 4))) * 0.18
    if v.co.z < 0: v.co.z *= 1.8; v.co.x *= 1 + v.co.z * 0.12; v.co.y *= 1 + v.co.z * 0.12   # tapering broken underside
res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=Vector((0, 0, 0.9)), plane_no=Vector((0.12, 0.05, 1)).normalized(), clear_outer=True)
edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
if edges: bmesh.ops.edgeloop_fill(bm, edges=edges)
mass = finish(bm, 'riftMass', [M_EARTH])

for o in scene.objects: o.select_set(o in (slab, mass))
bpy.ops.export_scene.gltf(filepath=f'{OUT}/rift.glb', export_format='GLB', use_selection=True, export_yup=True)
if OUT_BLEND: bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print('[rift] exported')
