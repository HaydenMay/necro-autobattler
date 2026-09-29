import bpy, sys
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
for o in bpy.context.scene.objects: print('[p]', o.type, o.name, [round(x,2) for x in o.dimensions], [round(x,2) for x in o.location])
for ac in bpy.data.actions: print('[p] action', ac.name, [int(x) for x in ac.frame_range])
