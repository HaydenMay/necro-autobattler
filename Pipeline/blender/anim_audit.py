# Audit every clip of a rigged unit: worst skin stretch and how close the two hands come, sampled every few frames.
#   blender -b Unit.blend -P anim_audit.py -- [step]
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]; step = int(a[0]) if a else 3
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == 'ARMATURE'); arm.animation_data_create()
body = next(o for o in sc.objects if o.type == 'MESH' and o.name.endswith('_Body'))
E = np.array([[e.vertices[0], e.vertices[1]] for e in body.data.edges])
names = [g.name for g in body.vertex_groups]
def verts():
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); m = ev.to_mesh()
    P = np.array([body.matrix_world @ v.co for v in m.vertices]); ev.to_mesh_clear(); return P
hands = [b.name for b in arm.pose.bones if 'hand' in b.name.lower() and 'ik' not in b.name.lower() and 'ctrl' not in b.name.lower()]
L = next((h for h in hands if h.endswith('L') or h.endswith('.L') or '_L' in h), None); R = next((h for h in hands if h.endswith('R') or h.endswith('.R') or '_R' in h), None)
def hpos(n): return np.array(arm.matrix_world @ arm.pose.bones[n].tail)
arm.animation_data.action = None
for pb in arm.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
sc.frame_set(0); bpy.context.view_layer.update(); Rv = verts(); rest = np.linalg.norm(Rv[E[:, 0]] - Rv[E[:, 1]], axis=1) + 1e-6
rest_gap = float(np.linalg.norm(hpos(L) - hpos(R))) if L and R else 0
print('[audit]', body.name.replace('_Body', ''), 'hand bones', L, R, 'rest hand gap %.2f m' % rest_gap)
for act in sorted(bpy.data.actions, key=lambda x: x.name):
    arm.animation_data.action = act; f0, f1 = int(act.frame_range[0]), int(act.frame_range[1]); worst = 0; bad_max = 0; bad_frame = f0; gap_min = 9; gap_frame = f0
    for fr in range(f0, f1 + 1, step):
        sc.frame_set(fr); bpy.context.view_layer.update(); P = verts(); ratio = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1) / rest
        pose = ratio * rest; n = int(((ratio > 2.2) & (pose > 0.03)).sum()); worst = max(worst, float(ratio.max()))
        if n > bad_max: bad_max, bad_frame = n, fr
        if L and R:
            g = float(np.linalg.norm(hpos(L) - hpos(R)))
            if g < gap_min: gap_min, gap_frame = g, fr
    print('[audit] %-12s frames %d-%d  stretched edges (max) %3d @%d   worst ratio %.1f   hands closest %.2f m @%d' % (act.name, f0, f1, bad_max, bad_frame, worst, gap_min, gap_frame))
