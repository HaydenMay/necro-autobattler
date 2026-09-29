# Turn the Tripo arena FBX into one light GLB: the six real props (parts 0-5), decimated, one shared 2048 texture, Y-up, origin at the base centre.
#   blender -b -P arena_props.py -- in.fbx out.glb
import bpy, sys, math
from mathutils import Vector
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=a[0])
NAMES = {0: ('pillar', 6000), 1: ('bones', 3000), 2: ('arch', 9000), 3: ('brazier', 5000), 4: ('wall', 5000), 5: ('fence', 3000)}
SCALE = 5.0
objs = {int(o.name.split('_')[-1]): o for o in bpy.context.scene.objects if o.type == 'MESH'}
for i, o in list(objs.items()):
    if i not in NAMES: bpy.data.objects.remove(o, do_unlink=True); del objs[i]
# one shared material with the base-colour atlas shrunk to 2048
src = next(im for im in bpy.data.images if 'basecolor' in im.name.lower())
src.scale(2048, 2048)
mat = bpy.data.materials.new('arena'); mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = src
bsdf.inputs['Roughness'].default_value = 0.85; bsdf.inputs['Metallic'].default_value = 0.0
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color']); nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
bpy.ops.object.select_all(action='DESELECT')
for i, o in objs.items():
    name, target = NAMES[i]
    o.parent = None; bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = o.data; me.calc_loop_triangles(); n = len(me.loop_triangles)
    m = o.modifiers.new('d', 'DECIMATE'); m.ratio = min(1.0, target / n); bpy.ops.object.modifier_apply(modifier='d')
    for v in me.vertices: v.co *= SCALE
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2; lo = min(zs)
    for v in me.vertices: v.co -= Vector((cx, cy, lo))
    o.location = (0, 0, 0); o.name = name; me.name = name
    me.materials.clear(); me.materials.append(mat)
    me.shade_smooth() if hasattr(me, 'shade_smooth') else None
    me.update(); me.calc_loop_triangles()
    print('[props]', name, 'tris', len(me.loop_triangles), 'size %.2f x %.2f x %.2f (w d h)' % (max(xs) - min(xs), max(ys) - min(ys), max(zs) - lo))
for o in [o for o in bpy.context.scene.objects if o.type != 'MESH']: bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=a[1], export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=85, export_yup=True, export_apply=True)
print('[props] wrote', a[1])
