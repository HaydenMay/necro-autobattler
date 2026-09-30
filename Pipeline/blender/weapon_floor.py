# Lowest point of the held weapon per clip (0 = the floor): does a slam actually reach the ground?   blender -b Unit.blend -P weapon_floor.py -- Clip [step]
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]; clips = a[0].split(','); step = int(a[1]) if len(a) > 1 else 2
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == 'ARMATURE'); arm.animation_data_create()
w = next(o for o in sc.objects if o.type == 'MESH' and o.name.endswith('_Weapon'))
for c in clips:
    act = bpy.data.actions[c]; arm.animation_data.action = act; f0, f1 = int(act.frame_range[0]), int(act.frame_range[1]); out = []
    for fr in range(f0, f1 + 1, step):
        sc.frame_set(fr); bpy.context.view_layer.update(); dg = bpy.context.evaluated_depsgraph_get(); ev = w.evaluated_get(dg); m = ev.to_mesh()
        P = np.array([w.matrix_world @ v.co for v in m.vertices]); ev.to_mesh_clear(); lo = P[P[:, 2].argmin()]; out.append('%d:z%.2f,y%.2f' % (fr, lo[2], lo[1]))
    print('[floor]', c, ' '.join(out))
