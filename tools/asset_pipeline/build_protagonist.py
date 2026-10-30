"""
Builds the protagonist in Blender (run headless):

    blender --background --factory-startup --python tools/asset_pipeline/build_protagonist.py -- <out.glb> [<out.blend>]

One continuous body from a Skin-modifier joint graph (tapered limbs, shaped torso,
hands, feet) smoothed by one subdivision level; a hood shell with real thickness and a
dark opening; an open long coat; belt, strap and satchel. A real armature whose joints
sit exactly where the game's procedural pose rig has its pivots (see Player.ts), so the
runtime can drive the skeleton from that rig and its leg IK. Body weights are Blender's
automatic (heat) weights; hood, coat and accessories are weighted explicitly.

Blender is Z-up and the figure faces -Y; the glTF exporter converts to Y-up / +Z forward.
"""
import bpy, bmesh, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT_GLB = argv[0] if argv else 'protagonist.glb'
OUT_BLEND = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- Joint layout (metres). Must match src/entities/Player.ts -----------------------
HIP_Y = 0.93
CHEST = HIP_Y + 0.06          # chest pivot
SHOULDER_Z = CHEST + 0.45     # upper arm pivots
NECK_Z = CHEST + 0.55
HIP_JOINT = (0.078, HIP_Y - 0.05)
THIGH, SHIN = 0.44, 0.42
KNEE_Z = HIP_JOINT[1] - THIGH
ANKLE_Z = KNEE_Z - SHIN
UPPER, FORE = 0.29, 0.27
SH_X = 0.172

def mat(name, rgb, rough=0.85):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    return m

M_COAT = mat('coat', (0.13, 0.15, 0.18))
M_TROUSERS = mat('trousers', (0.075, 0.08, 0.095))
M_SKIN = mat('skin', (0.5, 0.45, 0.42), 0.7)
M_SHOES = mat('shoes', (0.06, 0.055, 0.05), 0.6)
M_INNER = mat('hoodInner', (0.012, 0.012, 0.016), 1.0)

def link(obj):
    scene.collection.objects.link(obj)
    return obj

def evaluated_copy(obj, name):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    out = link(bpy.data.objects.new(name, me))
    bpy.data.objects.remove(obj)
    return out

# --- Body: skin-modifier joint graph ----------------------------------------------
# (name, position, radius x, radius y)
J = {}
order = []
def jv(name, p, rx, ry=None):
    J[name] = (Vector(p), rx, ry if ry is not None else rx)
    order.append(name)

jv('pelvis', (0, 0, HIP_Y - 0.02), 0.125, 0.082)
jv('waist', (0, 0, CHEST + 0.04), 0.112, 0.072)
jv('chest', (0, 0.005, CHEST + 0.28), 0.14, 0.085)
jv('upper', (0, 0.008, SHOULDER_Z - 0.02), 0.125, 0.075)
jv('neck', (0, 0.004, NECK_Z + 0.03), 0.038)
jv('head', (0, 0.016, NECK_Z + 0.13), 0.074, 0.08)
jv('crown', (0, 0, NECK_Z + 0.21), 0.05)
for s, sx in (('L', 1), ('R', -1)):
    jv('shoulder' + s, (sx * SH_X, 0.006, SHOULDER_Z), 0.05)
    jv('elbow' + s, (sx * (SH_X + 0.018), 0.006, SHOULDER_Z - UPPER), 0.037)
    jv('wrist' + s, (sx * (SH_X + 0.033), 0.0, SHOULDER_Z - UPPER - FORE), 0.028, 0.022)
    jv('hand' + s, (sx * (SH_X + 0.038), -0.006, SHOULDER_Z - UPPER - FORE - 0.085), 0.034, 0.018)
    jv('hip' + s, (sx * HIP_JOINT[0], 0, HIP_JOINT[1]), 0.084)
    jv('thighMid' + s, (sx * HIP_JOINT[0], -0.004, HIP_JOINT[1] - THIGH * 0.5), 0.07)
    jv('knee' + s, (sx * HIP_JOINT[0], -0.006, KNEE_Z), 0.057)
    jv('calf' + s, (sx * HIP_JOINT[0], 0.008, KNEE_Z - SHIN * 0.35), 0.054)
    jv('ankle' + s, (sx * HIP_JOINT[0], 0.0, ANKLE_Z + 0.045), 0.042)
    jv('heel' + s, (sx * HIP_JOINT[0], 0.03, 0.035), 0.036, 0.034)
    jv('toe' + s, (sx * HIP_JOINT[0], -0.15, 0.03), 0.044, 0.03)
edges = [('pelvis', 'waist'), ('waist', 'chest'), ('chest', 'upper'), ('upper', 'neck'), ('neck', 'head'), ('head', 'crown')]
for s in 'LR':
    edges += [('upper', 'shoulder' + s), ('shoulder' + s, 'elbow' + s), ('elbow' + s, 'wrist' + s), ('wrist' + s, 'hand' + s),
              ('pelvis', 'hip' + s), ('hip' + s, 'thighMid' + s), ('thighMid' + s, 'knee' + s), ('knee' + s, 'calf' + s), ('calf' + s, 'ankle' + s), ('ankle' + s, 'heel' + s), ('heel' + s, 'toe' + s)]

me = bpy.data.meshes.new('bodyGraph')
idx = {n: i for i, n in enumerate(order)}
me.from_pydata([J[n][0] for n in order], [(idx[a], idx[b]) for a, b in edges], [])
body = link(bpy.data.objects.new('body', me))
sk = body.modifiers.new('skin', 'SKIN')
sk.use_smooth_shade = True
sv = me.skin_vertices[0].data
for n, i in idx.items():
    sv[i].radius = (J[n][1], J[n][2])
sv[idx['pelvis']].use_root = True
sub = body.modifiers.new('sub', 'SUBSURF')
sub.levels = 1
body = evaluated_copy(body, 'body')

# Materials on the body by region
body.data.materials.append(M_COAT)      # 0
body.data.materials.append(M_TROUSERS)  # 1
body.data.materials.append(M_SKIN)      # 2
body.data.materials.append(M_SHOES)     # 3
for f in body.data.polygons:
    c = f.center
    if c.z < 0.11:
        f.material_index = 3
    elif c.z < HIP_Y + 0.02 and abs(c.x) < 0.16:
        f.material_index = 1
    elif abs(c.x) > SH_X + 0.005 and c.z < SHOULDER_Z - UPPER - FORE + 0.01:
        f.material_index = 2
    elif c.z > NECK_Z - 0.005:
        f.material_index = 2
    else:
        f.material_index = 0

# --- Hood: a thick shell with a forward opening -----------------------------------
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=0.122)
head_c = Vector((0, 0.012, NECK_Z + 0.13))
for v in bm.verts:
    v.co.x *= 1.0; v.co.y *= 1.12; v.co.z *= 1.08
    # The hood drops lower at the back and falls in a soft point
    if v.co.y > 0.04 and v.co.z > 0.02:
        v.co.y += (v.co.z * 0.35) * (v.co.y / 0.13)
    v.co += head_c
open_dir = Vector((0, -1, -0.15)).normalized()
kill = [f for f in bm.faces if (f.calc_center_median() - head_c).normalized().dot(open_dir) > 0.6]
bmesh.ops.delete(bm, geom=kill, context='FACES')
# Lower edge below the jaw opens too (the neck passes through)
kill = [f for f in bm.faces if (f.calc_center_median() - head_c).z < -0.1]
bmesh.ops.delete(bm, geom=kill, context='FACES')
hme = bpy.data.meshes.new('hood')
bm.to_mesh(hme); bm.free()
hood = link(bpy.data.objects.new('hood', hme))
sol = hood.modifiers.new('thick', 'SOLIDIFY'); sol.thickness = 0.018; sol.offset = 1
hood.modifiers.new('sub', 'SUBSURF').levels = 1
hood = evaluated_copy(hood, 'hood')
hood.data.materials.append(M_COAT)
for p in hood.data.polygons: p.use_smooth = True

# The dark of the opening: a flat oval in front of the face, behind the hood's rim, so
# the face is never seen
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, segments=20, radius=1.0)
for v in bm.verts:
    v.co = Vector((v.co.x * 0.078, -0.098, NECK_Z + 0.125 + v.co.y * 0.092))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    if f.normal.y > 0: f.normal_flip()      # face out of the hood (-Y), toward the viewer
ime = bpy.data.meshes.new('hoodInner'); bm.to_mesh(ime); bm.free()
inner = link(bpy.data.objects.new('hoodInner', ime))
inner.data.materials.append(M_INNER)

# --- Coat skirt: open at the front, flared, longer at the back ---------------------
bm = bmesh.new()
SEG, RINGS = 24, 7
top_z, bot_z = CHEST + 0.05, 0.36
rings = []
for r in range(RINGS):
    t = r / (RINGS - 1)
    z = top_z + (bot_z - top_z) * t
    ring = []
    for s in range(SEG + 1):
        a = -math.pi * 0.86 + (math.pi * 1.72) * (s / SEG)   # gap of ~50° at the front (-Y)
        rx = 0.128 + 0.085 * t; ry = 0.082 + 0.07 * t
        back = max(0.0, math.cos(a)) * 0.04 * t              # hangs lower behind
        ring.append(bm.verts.new((math.sin(a) * rx, math.cos(a) * ry, z - back)))
    rings.append(ring)
for r in range(RINGS - 1):
    for s in range(SEG):
        bm.faces.new((rings[r][s], rings[r][s + 1], rings[r + 1][s + 1], rings[r + 1][s]))
cme = bpy.data.meshes.new('coat'); bm.to_mesh(cme); bm.free()
coat = link(bpy.data.objects.new('coatSkirt', cme))
cs = coat.modifiers.new('thick', 'SOLIDIFY'); cs.thickness = 0.012
coat.modifiers.new('sub', 'SUBSURF').levels = 1
coat = evaluated_copy(coat, 'coatSkirt')
coat.data.materials.append(M_COAT)
for p in coat.data.polygons: p.use_smooth = True

# --- Belt, strap, satchel ------------------------------------------------------------
def box(name, size, loc, rot=(0, 0, 0), m=M_SHOES, bevel=0.006):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=bevel, segments=2, affect='EDGES')
    mm = bpy.data.meshes.new(name); bm.to_mesh(mm); bm.free()
    o = link(bpy.data.objects.new(name, mm))
    o.location = loc; o.rotation_euler = rot
    o.data.materials.append(m)
    return o

belt_bm = bmesh.new()
bmesh.ops.create_cone(belt_bm, cap_ends=False, segments=20, radius1=0.124, radius2=0.122, depth=0.04)
for v in belt_bm.verts: v.co.y *= 0.66; v.co.z += CHEST + 0.06
bme = bpy.data.meshes.new('belt'); belt_bm.to_mesh(bme); belt_bm.free()
belt = link(bpy.data.objects.new('belt', bme)); belt.data.materials.append(M_SHOES)
satchel = box('satchel', (0.06, 0.16, 0.13), (0.17, 0.015, HIP_Y - 0.06), (0, 0, math.radians(-12)))
strap = box('strap', (0.03, 0.012, 0.5), (0.02, -0.088, CHEST + 0.24), (0, math.radians(36), 0), bevel=0.003)
strap_b = box('strapBack', (0.03, 0.012, 0.48), (0.02, 0.088, CHEST + 0.24), (0, math.radians(36), 0), bevel=0.003)

# --- Armature ----------------------------------------------------------------------
arm_data = bpy.data.armatures.new('rig')
rig = link(bpy.data.objects.new('rig', arm_data))
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None, connect=False):
    b = eb.new(name); b.head = head; b.tail = tail; b.roll = 0
    if parent: b.parent = eb[parent]; b.use_connect = connect
    return b
bone('hips', (0, 0, HIP_Y), (0, 0, CHEST))
bone('spine', (0, 0, CHEST), (0, 0, SHOULDER_Z), 'hips')
bone('neck', (0, 0.004, NECK_Z), (0, 0.0, NECK_Z + 0.1), 'spine')
bone('head', (0, 0.0, NECK_Z + 0.1), (0, 0.0, NECK_Z + 0.24), 'neck', True)
for s, sx in (('L', 1), ('R', -1)):
    bone('upperarm.' + s, (sx * SH_X, 0.006, SHOULDER_Z), (sx * (SH_X + 0.018), 0.006, SHOULDER_Z - UPPER), 'spine')
    bone('forearm.' + s, (sx * (SH_X + 0.018), 0.006, SHOULDER_Z - UPPER), (sx * (SH_X + 0.033), 0.0, SHOULDER_Z - UPPER - FORE), 'upperarm.' + s, True)
    bone('hand.' + s, (sx * (SH_X + 0.033), 0.0, SHOULDER_Z - UPPER - FORE), (sx * (SH_X + 0.038), -0.006, SHOULDER_Z - UPPER - FORE - 0.1), 'forearm.' + s, True)
    bone('thigh.' + s, (sx * HIP_JOINT[0], 0, HIP_JOINT[1]), (sx * HIP_JOINT[0], 0, KNEE_Z), 'hips')
    bone('shin.' + s, (sx * HIP_JOINT[0], 0, KNEE_Z), (sx * HIP_JOINT[0], 0, ANKLE_Z), 'thigh.' + s, True)
    bone('foot.' + s, (sx * HIP_JOINT[0], 0, ANKLE_Z), (sx * HIP_JOINT[0], -0.15, ANKLE_Z), 'shin.' + s, True)
bone('coat.B', (0, 0.07, CHEST + 0.04), (0, 0.12, 0.36), 'spine')
bone('coat.L', (0.085, -0.04, CHEST + 0.04), (0.13, -0.09, 0.36), 'spine')
bone('coat.R', (-0.085, -0.04, CHEST + 0.04), (-0.13, -0.09, 0.36), 'spine')
bpy.ops.object.mode_set(mode='OBJECT')

def select_only(objs, active):
    for o in scene.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active

# Body: automatic (heat) weights, coat bones excluded from deforming it
for n in ('coat.B', 'coat.L', 'coat.R'): arm_data.bones[n].use_deform = False
select_only([body, rig], rig)
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for n in ('coat.B', 'coat.L', 'coat.R'): arm_data.bones[n].use_deform = True

def weight_all(obj, bone_weights):
    for bn in bone_weights:
        if bn not in obj.vertex_groups: obj.vertex_groups.new(name=bn)
    for v in obj.data.vertices:
        for bn, fn in bone_weights.items():
            w = fn(v.co)
            if w > 0.001: obj.vertex_groups[bn].add([v.index], w, 'REPLACE')

def smooth01(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)

weight_all(hood, {'head': lambda c: 1.0})
weight_all(inner, {'head': lambda c: 1.0})
# Coat: the top stays with the spine; lower down each vertex follows the panel bone of its side
def panel_w(name):
    def f(c):
        t = smooth01(CHEST + 0.02, 0.6, c.z) if False else smooth01(0.0, 1.0, (CHEST + 0.05 - c.z) / (CHEST + 0.05 - 0.36))
        a = math.atan2(c.x, c.y)       # 0 at the back (+Y), ±pi at the front
        side = 'coat.B' if abs(a) < math.pi * 0.42 else ('coat.L' if a > 0 else 'coat.R')
        return t if side == name else 0.0
    return f
weight_all(coat, {'spine': lambda c: 1.0 - smooth01(0.0, 1.0, (CHEST + 0.05 - c.z) / (CHEST + 0.05 - 0.36)),
                  'coat.B': panel_w('coat.B'), 'coat.L': panel_w('coat.L'), 'coat.R': panel_w('coat.R')})
for o in (belt, strap, strap_b):
    o.data.transform(o.matrix_world); o.matrix_world.identity()
    weight_all(o, {'spine': lambda c: 1.0})
satchel.data.transform(satchel.matrix_world); satchel.matrix_world.identity()
weight_all(satchel, {'hips': lambda c: 1.0})

for o in (hood, inner, coat, belt, strap, strap_b, satchel):
    mod = o.modifiers.new('rig', 'ARMATURE'); mod.object = rig
    o.parent = rig

# One mesh: join everything into the body
select_only([body, hood, inner, coat, belt, strap, strap_b, satchel], body)
bpy.ops.object.join()
body.name = 'protagonist'
bpy.ops.object.shade_smooth()

tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
print(f'[protagonist] vertices={len(body.data.vertices)} triangles={tris} bones={len(arm_data.bones)} materials={len(body.data.materials)}')

if OUT_BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
select_only([body, rig], rig)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True,
                          export_skins=True, export_animations=False, export_yup=True, export_apply=False)
print('[protagonist] exported', OUT_GLB)
