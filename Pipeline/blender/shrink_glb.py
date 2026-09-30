# Re-export a GLB with its textures scaled down (a tiny prop does not need a 2048 px colour map).
#   blender -b -P shrink_glb.py -- in.glb out.glb texture_px
import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a[0])
for im in bpy.data.images:
    if im.size[0] > int(a[2]): im.scale(int(a[2]), int(a[2]))
bpy.ops.export_scene.gltf(filepath=a[1], export_format='GLB', export_image_format='JPEG', export_jpeg_quality=85)
print('[shrink] wrote', a[1])
