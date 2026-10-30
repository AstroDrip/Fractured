"""
Deformation check: poses the rig (rest, stride, deep crouch, arm raised) and renders
each with the Workbench engine to PNGs, front-three-quarter view.

    blender --background <asset.blend> --python tools/asset_pipeline/render_pose_check.py -- <out_dir>
"""
import bpy, math, sys, os
from mathutils import Vector, Euler

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '.'
os.makedirs(out, exist_ok=True)
scene = bpy.context.scene
rig = bpy.data.objects['rig']

cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 50
cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam)
scene.camera = cam
scene.render.engine = 'BLENDER_WORKBENCH'
scene.display.shading.light = 'STUDIO'
scene.display.shading.color_type = 'MATERIAL'
scene.render.resolution_x = 480; scene.render.resolution_y = 640
scene.world = bpy.data.worlds.new('w') if not scene.world else scene.world

def look(at, frm):
    cam.location = frm
    d = Vector(at) - Vector(frm)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

POSES = {
    'rest': {},
    'stride': {'thigh.L': (-0.6, 0, 0), 'shin.L': (0.3, 0, 0), 'thigh.R': (0.45, 0, 0), 'shin.R': (0.9, 0, 0),
               'upperarm.L': (0.4, 0, 0), 'upperarm.R': (-0.4, 0, 0), 'forearm.R': (-0.5, 0, 0)},
    'crouch': {'thigh.L': (-1.3, 0, 0), 'shin.L': (2.0, 0, 0), 'thigh.R': (-1.1, 0, 0), 'shin.R': (1.9, 0, 0), 'spine': (0.35, 0, 0)},
    'reach': {'upperarm.R': (-2.6, 0, 0), 'forearm.R': (-0.3, 0, 0), 'upperarm.L': (0, 0, 1.2), 'head': (-0.3, 0.4, 0)},
}
for name, pose in POSES.items():
    for pb in rig.pose.bones:
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = Euler(pose.get(pb.name, (0, 0, 0)))
    if name == 'crouch':
        rig.pose.bones['hips'].location = (0, 0, 0)
    bpy.context.view_layer.update()
    look((0, 0, 0.9), (1.4, -2.2, 1.3))
    scene.render.filepath = os.path.join(out, f'pose_{name}.png')
    bpy.ops.render.render(write_still=True)
    print('[pose-check] wrote', scene.render.filepath)
