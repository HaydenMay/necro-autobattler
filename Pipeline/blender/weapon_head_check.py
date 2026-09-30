# Does a held weapon sink into the head? For every clip, sample frames and count weapon vertices inside an ellipsoid fitted to the head (skull + hood/hair).
#   blender -b Unit.blend -P weapon_head_check.py -- [step] [shrink]
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]; step = int(a[0]) if a else 2; shrink = float(a[1]) if len(a) > 1 else 0.85
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == 'ARMATURE'); arm.animation_data_create()
body = next(o for o in sc.objects if o.type == 'MESH' and o.name.endswith('_Body'))
weps = [o for o in sc.objects if o.type == 'MESH' and '_Weapon' in o.name or o.type == 'MESH' and o.name.endswith(('_Bow', '_Staff'))]
hg = body.vertex_groups.get('Head'); hidx = [v.index for v in body.data.vertices if hg and any(g.group == hg.index and g.weight > 0.6 for g in v.groups)]
def cloud(o, idx=None):
    dg = bpy.context.evaluated_depsgraph_get(); ev = o.evaluated_get(dg); m = ev.to_mesh()
    P = np.array([o.matrix_world @ v.co for v in m.vertices]); ev.to_mesh_clear(); return P if idx is None else P[idx]
print('[whc]', body.name.replace('_Body', ''), 'weapons', [w.name for w in weps], 'head verts', len(hidx))
for act in sorted(bpy.data.actions, key=lambda x: x.name):
    arm.animation_data.action = act; f0, f1 = int(act.frame_range[0]), int(act.frame_range[1]); worst = 0; wf = f0
    for fr in range(f0, f1 + 1, step):
        sc.frame_set(fr); bpy.context.view_layer.update(); H = cloud(body, hidx)
        if len(H) < 20: continue
        c = (H.min(0) + H.max(0)) / 2; r = (H.max(0) - H.min(0)) / 2 * shrink + 1e-6; n = 0
        for w in weps:
            W = cloud(w); n += int((((W - c) / r) ** 2).sum(1) < 1.0).__int__() if False else int(((((W - c) / r) ** 2).sum(1) < 1.0).sum())
        if n > worst: worst, wf = n, fr
    print('[whc] %-12s weapon verts inside head (max) %5d @%d' % (act.name, worst, wf))
