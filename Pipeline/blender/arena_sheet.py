# Render every part of the arena FBX side by side, labelled, so we can tell what each one is.   blender -b -P arena_sheet.py -- in.fbx out.png
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=a[0])
parts = sorted([o for o in bpy.context.scene.objects if o.type == 'MESH'], key=lambda o: int(o.name.split('_')[-1]))
sp = 0.6
for i, o in enumerate(parts):
    o.parent = None; o.rotation_euler = (0, 0, 0)
    bb = [o.matrix_world @ Vector(c) for c in o.bound_box]
    c = sum(bb, Vector()) / 8; lo = min(v.z for v in bb)
    col, row = i % 6, i // 6
    o.location = Vector((col * sp - 1.5 - (c.x - o.location.x), 0 - (c.y - o.location.y) * 0, 0)) + Vector((0, 0, -lo + o.location.z - row * 0.7))
    t = bpy.data.curves.new('t%d' % i, 'FONT'); t.body = str(i); t.size = 0.08
    to = bpy.data.objects.new('t%d' % i, t); bpy.context.collection.objects.link(to)
    to.location = (col * sp - 1.5, 0, -row * 0.7 - 0.06); to.rotation_euler = (math.pi / 2, 0, 0)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); bpy.context.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 4.3; cam.location = (0, -5, -0.05); cam.rotation_euler = (math.pi / 2, 0, 0)
bpy.context.scene.camera = cam
s = bpy.context.scene; s.render.engine = 'BLENDER_WORKBENCH'; s.render.resolution_x = 1800; s.render.resolution_y = 1000
s.display.shading.light = 'FLAT'; s.display.shading.color_type = 'TEXTURE'
s.world = bpy.data.worlds.new('w'); s.world.color = (0.25, 0.25, 0.28)
s.render.filepath = a[1]; bpy.ops.render.render(write_still=True)
