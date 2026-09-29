# Where does a rigged mesh get stretched? Compares every edge's length in a pose with its rest length and reports the worst clusters.
#   blender -b Unit.blend -P stretch_check.py -- Clip:frame [Clip:frame ...]
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
sc = bpy.context.scene; arm = next(o for o in sc.objects if o.type == 'ARMATURE'); arm.animation_data_create()
body = next(o for o in sc.objects if o.type == 'MESH' and o.name.endswith('_Body'))
E = np.array([[e.vertices[0], e.vertices[1]] for e in body.data.edges])
def verts():
    dg = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(dg); m = ev.to_mesh()
    P = np.array([body.matrix_world @ v.co for v in m.vertices]); ev.to_mesh_clear(); return P
arm.animation_data.action = None
for pb in arm.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
sc.frame_set(0); bpy.context.view_layer.update(); R = verts()
rest = np.linalg.norm(R[E[:, 0]] - R[E[:, 1]], axis=1) + 1e-6
names = [g.name for g in body.vertex_groups]
def dom(vi):
    ws = sorted(((g.weight, names[g.group]) for g in body.data.vertices[vi].groups), reverse=True)[:3]; return ' '.join('%s%.2f' % (n.replace('UpperArm', 'UA').replace('LowerArm', 'LA'), w) for w, n in ws)
for spec in a:
    name, fr = spec.split(':'); arm.animation_data.action = bpy.data.actions[name]; sc.frame_set(int(fr)); bpy.context.view_layer.update()
    Pp = verts(); pose = np.linalg.norm(Pp[E[:, 0]] - Pp[E[:, 1]], axis=1); ratio = pose / rest
    bad = np.where((ratio > 2.2) & (pose > 0.03))[0]
    print('[stretch]', spec, 'edges over 2.2x:', len(bad), 'of', len(E), ' worst ratio %.1f' % ratio.max())
    for k in bad[np.argsort(-pose[bad])][:6]:
        v0, v1 = E[k]; print('   edge %.2f m (rest %.3f)  at rest (%.2f %.2f %.2f) | %s || %s' % (pose[k], rest[k], *R[v0], dom(v0), dom(v1)))
