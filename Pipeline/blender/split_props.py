# Split one GLB that holds several separate props (a sword AND a shield in one Tripo model) into one GLB each, by spatial clustering of the vertices.
#   blender -b -P split_props.py -- in.glb out_a.glb out_b.glb
import bpy, sys, bmesh, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=a[0])
sc = bpy.context.scene; ms = [o for o in sc.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in ms: o.select_set(True)
bpy.context.view_layer.objects.active = ms[0]
for o in ms: o.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(ms) > 1: bpy.ops.object.join()
src = bpy.context.view_layer.objects.active
P = np.array([v.co[:] for v in src.data.vertices]); m = P.mean(0); w, V = np.linalg.eigh(np.cov((P - m).T)); ax = V[:, np.argmax(w)]; t = (P - m) @ ax
c = np.array([P[t.argmin()], P[t.argmax()]])
for _ in range(30):
    lab = np.argmin(((P[:, None, :] - c[None]) ** 2).sum(-1), axis=1); c = np.array([P[lab == k].mean(0) if (lab == k).any() else c[k] for k in range(2)])
print('[split] clusters', (lab == 0).sum(), (lab == 1).sum(), 'centres', c.tolist())
for k in range(2):
    o = src.copy(); o.data = src.data.copy(); o.name = 'prop%d' % k; sc.collection.objects.link(o)
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    kill = [bm.verts[i] for i in range(len(bm.verts)) if lab[i] != k]; bmesh.ops.delete(bm, geom=kill, context='VERTS'); bm.to_mesh(o.data); bm.free()
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=a[1 + k], export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=90)
    print('[split] wrote', a[1 + k], 'tris', len(o.data.polygons))
