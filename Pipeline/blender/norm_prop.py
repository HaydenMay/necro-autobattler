# Centre a prop (shield, bracer...) on its bounding-box centre and scale it to a height in metres; orientation is kept (faces -Y, upright).
#   blender -b -P norm_prop.py -- in.glb out.glb height_m
import bpy, sys
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a[0])
ms = [o for o in bpy.context.scene.objects if o.type == 'MESH']; o = ms[0]; o.parent = None
bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o; bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
co = [v.co.copy() for v in o.data.vertices]; lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co))); hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
ctr = (lo + hi) / 2; k = float(a[2]) / (hi.z - lo.z)
for v in o.data.vertices: v.co = (v.co - ctr) * k
o.data.update()
bpy.ops.export_scene.gltf(filepath=a[1], export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=90)
print('[norm] wrote', a[1], 'size', tuple(round(x * k, 3) for x in (hi - lo)))
