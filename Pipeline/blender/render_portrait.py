# Render a card portrait (transparent PNG) of a rigged Soul from its game GLB.
#   blender -b -P render_portrait.py -- model.glb out.png [action|REST] [frame] [yaw_degrees] [full|head]
import bpy, sys, math, os
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
glb, out = a[0], a[1]; action = a[2] if len(a) > 2 else 'Idle'; frame = int(a[3]) if len(a) > 3 else 10; yaw = float(a[4]) if len(a) > 4 else 28
HEAD = len(a) > 5 and a[5] == 'head'
W, H = (512, 512) if HEAD else (480, 600)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
for o in list(sc.objects):
    if o.name.startswith('Icosphere'): bpy.data.objects.remove(o, do_unlink=True)          # the blob-shadow helper, not part of the character
if os.environ.get('HIDE_PROPS'):                       # weapons and shields in front of the face: leave them out of the portrait
    for o in list(sc.objects):
        if o.type == 'MESH' and 'Weapon' in o.name: bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in sc.objects if o.type == 'ARMATURE')
arm.animation_data_create(); arm.animation_data.action = None if action == 'REST' else bpy.data.actions[action]     # REST = the unposed model (no stretching from the rig)
if os.environ.get('HEAD_ROT'):                        # tilt the head (degrees x,y,z; negative x looks up) to show more of the face
    hr_ = [math.radians(float(v)) for v in os.environ['HEAD_ROT'].split(',')]; pb_ = arm.pose.bones['Head']; pb_.rotation_mode = 'XYZ'; pb_.rotation_euler = hr_
sc.frame_set(frame); bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get(); lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in sc.objects:
    if o.type != 'MESH' or max(o.dimensions) < 0.02: o.hide_render = o.type == 'MESH' and max(o.dimensions) < 0.02; continue
    ev = o.evaluated_get(dg)
    for c in ev.bound_box:
        w = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
ctr = (lo + hi) / 2; size = hi - lo
if HEAD:                                              # head and shoulders: same-size window centred on the skull, so every Soul's face lands in the same place
    hp = arm.matrix_world @ arm.pose.bones['Head'].head; k_ = float(os.environ.get('PORT_SCALE', 1.0)); size = Vector((0.3, 0.3, 0.58)) * k_; ctr = Vector((hp.x, hp.y, hp.z + 0.075 + float(os.environ.get('PORT_DZ', 0.0))))
# camera: long lens (almost flat), in front of the character, turned a little for a three-quarter look
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.lens = 85; cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24
fov = 2 * math.atan(12 / 85); need = max(size.z, max(size.x, size.y) * 1.25 / (W / H)) * 1.12
dist = (need / 2) / math.tan(fov / 2)
ang = math.radians(yaw); d = Vector((math.sin(ang), -math.cos(ang), 0.06)).normalized()
cam.location = ctr + d * dist + Vector((0, 0, 0)); cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
def light(name, kind, energy, loc, color):
    l = bpy.data.objects.new(name, bpy.data.lights.new(name, kind)); sc.collection.objects.link(l); l.data.energy = energy; l.data.color = color
    l.location = ctr + Vector(loc); l.rotation_euler = (ctr + Vector((0, 0, 0)) - l.location).to_track_quat('-Z', 'Y').to_euler(); return l
light('key', 'SUN', 3.0, (-2, -3, 3), (1.0, 0.93, 0.82))
light('rim', 'SUN', 4.0, (3, 3, 1.5), (0.25, 1.0, 0.8))
light('fill', 'SUN', 0.7, (3, -2, 0.5), (0.55, 0.6, 1.0))
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True; sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.08, 0.12, 0.14, 1)
sc.world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
sc.render.engine = 'BLENDER_EEVEE'; sc.render.film_transparent = True
sc.render.resolution_x, sc.render.resolution_y = W, H; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Standard'
sc.render.filepath = out; bpy.ops.render.render(write_still=True); print('[p] wrote', out, 'size', [round(x, 2) for x in size])
