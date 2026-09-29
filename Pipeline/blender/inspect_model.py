"""
inspect_model.py - look at a NEW Tripo character before rigging it.

    blender -b -P inspect_model.py -- input/some+character.zip

Prints: mesh count, triangle count, size, loose-part count (Tripo segmentation is not needed if this is > 20),
and writes out/<zipname>_grid_front.png and _grid_side.png: renders with a labelled metre grid so the ~14 landmark
points for the unit JSON can be read straight off the image (X across in red, Z up in blue, units = metres).
"""
import bpy, bmesh, sys, os, math, zipfile, glob
import numpy as np
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:]
zpath = os.path.abspath(ARGS[0]); base = os.path.splitext(os.path.basename(zpath))[0].replace('+', '_')
OUT = os.path.join(os.path.dirname(os.path.dirname(zpath)), 'out'); os.makedirs(OUT, exist_ok=True)
work = os.path.join(OUT, '_work_inspect_' + base); os.makedirs(work, exist_ok=True)
with zipfile.ZipFile(zpath) as z: z.extractall(work)
fbx = glob.glob(os.path.join(work, '*.fbx'))[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=fbx)
ms = [o for o in bpy.data.objects if o.type == 'MESH']
allv, tris, loose = [], 0, 0
for o in ms:
    o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles); allv += [o.matrix_world @ v.co for v in o.data.vertices]
    bm = bmesh.new(); bm.from_mesh(o.data); seen = set()
    for v in bm.verts:
        if v.index in seen: continue
        loose += 1; st = [v]; seen.add(v.index)
        while st:
            c = st.pop()
            for e in c.link_edges:
                w = e.other_vert(c)
                if w.index not in seen: seen.add(w.index); st.append(w)
    bm.free()
mn = Vector((min(v.x for v in allv), min(v.y for v in allv), min(v.z for v in allv))); mx = Vector((max(v.x for v in allv), max(v.y for v in allv), max(v.z for v in allv)))
print('[inspect]', base, 'meshes', len(ms), 'tris', tris, 'size(x,y,z)', tuple(round(a, 3) for a in (mx - mn)), 'min z', round(mn.z, 3), 'loose parts', loose)
print('[inspect] hint: feet should sit at z=0 and the model should face -Y; if not, fix it in Tripo/Blender before rigging')

DIG = {'0': "111101101101111", '1': "010110010010111", '2': "111001111100111", '3': "111001111001111", '4': "101101111001001", '5': "111100111001111", '6': "111100111101111", '7': "111001001001001", '8': "111101111101111", '9': "111101111001111", '-': "000000111000000", '.': "000000000000010"}
def text(px, W, H, x, y, s, col):
    for ch in s:
        g = DIG[ch]
        for r in range(5):
            for c in range(3):
                if g[r * 3 + c] == '1':
                    for dy in range(2):
                        for dx in range(2):
                            xx, yy = x + c * 2 + dx, y + r * 2 + dy
                            if 0 <= xx < W and 0 <= yy < H: px[yy, xx, :3] = col
        x += 8

sc = bpy.context.scene; sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
W = H = 1400; sc.render.resolution_x = W; sc.render.resolution_y = H
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.85, 0.85, 0.88)
cam = bpy.data.objects.new('c', bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.type = 'ORTHO'
height = mx.z - mn.z; SCALE = max(1.2, height * 1.2); cam.data.ortho_scale = SCALE; CZ = mn.z + height / 2; CX = 0.0
step = 0.05 if SCALE <= 2 else 0.1
for name, loc, rot in (('front', (CX, -6, CZ), (90, 0, 0)), ('side', (6, CX, CZ), (90, 0, 90))):
    cam.location = loc; cam.rotation_euler = [math.radians(r) for r in rot]
    p = os.path.join(OUT, f'{base}_grid_{name}.png'); sc.render.filepath = p; bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(p); px = np.array(im.pixels[:]).reshape(H, W, 4).copy()[::-1]; ppm = W / SCALE
    X = lambda u: int(W / 2 + (u - CX) * ppm); Z = lambda v: int(H / 2 - (v - CZ) * ppm)
    n = int(SCALE / step / 2) + 1
    for k in range(-n, n + 1):
        u = k * step; x = X(u); major = (k % 2 == 0)
        if 0 <= x < W: px[:, x, :3] = (0.9, 0.2, 0.2) if major else px[:, x, :3] * 0.75 + np.array((0.95, 0.6, 0.6)) * 0.25
    for k in range(int((CZ - SCALE / 2) / step) - 1, int((CZ + SCALE / 2) / step) + 2):
        v = k * step; y = Z(v); major = (k % 2 == 0)
        if 0 <= y < H: px[y, :, :3] = (0.2, 0.3, 0.9) if major else px[y, :, :3] * 0.75 + np.array((0.6, 0.65, 0.95)) * 0.25
    for k in range(-n // 2, n // 2 + 1):
        u = k * step * 2; text(px, W, H, X(u) - 10, H - 24, '%.1f' % u if step == 0.05 else '%.0f' % u, (0.8, 0, 0))
    for k in range(int(mn.z / (step * 2)), int(mx.z / (step * 2)) + 2):
        v = k * step * 2; text(px, W, H, 6, Z(v) - 5, '%.1f' % v if step == 0.05 else '%.0f' % v, (0, 0, 0.8))
    px = px[::-1]; im2 = bpy.data.images.new('g' + name, W, H, alpha=True); im2.pixels = px.ravel().tolist(); im2.filepath_raw = p; im2.file_format = 'PNG'; im2.save()
    print('[inspect] wrote', p)
