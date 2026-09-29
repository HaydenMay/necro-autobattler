# List every object in the Tripo arena FBX: triangles, size, position.   blender -b -P arena_inspect.py -- file.fbx
import bpy, sys
path = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=path)
for o in sorted(bpy.context.scene.objects, key=lambda o: o.name):
    if o.type != 'MESH': print('[arena]', o.type, o.name, list(o.location)); continue
    me = o.data; me.calc_loop_triangles(); d = o.dimensions
    print('[arena]', o.name, 'tris', len(me.loop_triangles), 'dim %.2f %.2f %.2f' % tuple(d), 'loc %.2f %.2f %.2f' % tuple(o.location), 'mats', len(me.materials), 'uv', len(me.uv_layers))
