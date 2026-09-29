# Quick look at a GLB: a full-body view and a face close-up, flat-lit with the colour texture.
#   blender -b -P preview_model.py -- model.glb out_prefix [face_height_fraction]
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
src, prefix = a[0], a[1]; face = float(a[2]) if len(a) > 2 else 0.86
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
ms = [o for o in sc.objects if o.type == 'MESH']
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in ms:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
ctr = (lo + hi) / 2; h = hi.z - lo.z
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
sc.render.resolution_x = 700; sc.render.resolution_y = 700; sc.render.film_transparent = False
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.55, 0.6)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.rotation_euler = (math.pi / 2, 0, 0)
def shot(name, scale, cz):
    cam.data.ortho_scale = scale; cam.location = (ctr.x, ctr.y - 5, cz)
    sc.render.filepath = prefix + name + '.png'; bpy.ops.render.render(write_still=True)
shot('_full', h * 1.15, lo.z + h / 2)
shot('_face', h * 0.5, lo.z + h * face)
cam.rotation_euler = (math.pi / 2, 0, math.pi / 2); cam.data.ortho_scale = h * 1.15; cam.location = (ctr.x + 5, ctr.y, lo.z + h / 2)
sc.render.filepath = prefix + '_side.png'; bpy.ops.render.render(write_still=True)
print('[prev] height %.2f' % h)
