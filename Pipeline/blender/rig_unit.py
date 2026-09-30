"""
rig_unit.py - turn a Tripo character (+ optional bow/arrow props) into a rigged, animated GLB.

    blender -b -P rig_unit.py -- units/skeleton_archer.json

Stages (all automatic, driven by the JSON config):
  1. unzip + import the UNSEGMENTED Tripo body (no Tripo segmentation needed; loose parts are found here)
  2. split the prop file (bow / arrow / string) by loose parts and place it on the hand
  3. build a humanoid armature from ~14 landmark points, IK controllers, sockets, string-pull + nocked-arrow bones
  4. skin: small loose parts bind rigidly to the nearest bone, big parts blend between the two nearest bones
  5. author clips with IK, bake them to plain bone keys, strip the controllers
  6. export GLB (+ separate flying-arrow GLB), QA contact sheets, and an enemy-eye texture variant
"""
import bpy, bmesh, json, sys, os, math, zipfile, glob, time
import numpy as np
from mathutils import Vector, Matrix, Euler

T0 = time.time()
ARGS = sys.argv[sys.argv.index('--') + 1:]
CFG_PATH = os.path.abspath(ARGS[0]); CFG = json.load(open(CFG_PATH, encoding='utf-8-sig'))   # utf-8-sig tolerates the BOM that Windows editors add
BASE = os.path.dirname(CFG_PATH)
def P(p): return p if os.path.isabs(p) else os.path.normpath(os.path.join(BASE, p))
NAME = CFG['name']; OUT = P(CFG.get('out', '../out')); WORK = os.path.join(OUT, '_work_' + NAME)
os.makedirs(WORK, exist_ok=True)
LM = {k: Vector(v) for k, v in CFG['landmarks'].items()}
def mir(v): return Vector((-v.x, v.y, v.z))
def log(*a): print('[rig]', *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
FPS = 30; sc.render.fps = FPS

# ----------------------------------------------------------------------------------------------- helpers
def unzip_fbx(zpath):
    d = os.path.join(WORK, os.path.splitext(os.path.basename(zpath))[0].replace('+', '_')); os.makedirs(d, exist_ok=True)
    with zipfile.ZipFile(zpath) as z: z.extractall(d)
    return glob.glob(os.path.join(d, '*.fbx'))[0]

def import_fbx(path):
    before = set(bpy.data.objects)
    if path.lower().endswith(('.glb', '.gltf')): bpy.ops.import_scene.gltf(filepath=path)     # Hunyuan / pre-processed models come as GLB
    else: bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type == 'MESH':
            mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world = Matrix.Identity(4)
    meshes = [o for o in new if o.type == 'MESH']
    for o in new:
        if o.type != 'MESH': bpy.data.objects.remove(o)
    return meshes

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active; o.name = o.data.name = name; return o

def verts_np(o): return np.array([v.co[:] for v in o.data.vertices], dtype=np.float64)

def island_ids(o):
    """connected pieces of the mesh. Vertices that sit at the same spot (duplicated along texture seams) count as ONE, otherwise every UV island looks like a separate piece."""
    co = np.round(verts_np(o) / 1e-5).astype(np.int64); canon = {}; cid = np.zeros(len(co), dtype=np.int64)
    for i, c in enumerate(map(tuple, co)): cid[i] = canon.setdefault(c, len(canon))
    nc = len(canon); adj = [[] for _ in range(nc)]
    for e in o.data.edges:
        u, w = int(cid[e.vertices[0]]), int(cid[e.vertices[1]])
        if u != w: adj[u].append(w); adj[w].append(u)
    comp = np.full(nc, -1, dtype=np.int64); n = 0
    for s0 in range(nc):
        if comp[s0] >= 0: continue
        comp[s0] = n; stack = [s0]
        while stack:
            c = stack.pop()
            for w in adj[c]:
                if comp[w] < 0: comp[w] = n; stack.append(w)
        n += 1
    return comp[cid], n

def extract(o, mask, name):
    """new object holding only the vertices where mask is True (keeps UVs + material)"""
    me = o.data.copy(); bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not mask[v.index]], context='VERTS')
    bm.to_mesh(me); bm.free()
    n = bpy.data.objects.new(name, me); sc.collection.objects.link(n); return n

def T(v): return Matrix.Translation(Vector(v))
def Rz(d): return Matrix.Rotation(math.radians(d), 4, 'Z')
def Rx(d): return Matrix.Rotation(math.radians(d), 4, 'X')
def S(s): return Matrix.Scale(s, 4)

# ----------------------------------------------------------------------------------------------- 1. body
def tri_count(o): o.data.calc_loop_triangles(); return len(o.data.loop_triangles)
def decimate_to(o, target):
    """free triangle reduction in Blender (keeps UV borders so the painted texture still lines up)"""
    cur = tri_count(o)
    if not target or cur <= target: return cur
    md = o.modifiers.new('Dec', 'DECIMATE'); md.decimate_type = 'COLLAPSE'; md.ratio = target / cur; md.delimit = {'UV'}; md.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='Dec'); return tri_count(o)
DEC = CFG.get('decimate', {})
body_fbx = P(CFG['body_glb']) if CFG.get('body_glb') else unzip_fbx(P(CFG['body_zip']))
parts = import_fbx(body_fbx)
body = join(parts, NAME + '_Body')
if DEC.get('body'): n0 = tri_count(body); n1 = decimate_to(body, DEC['body']); log('body triangles', n0, '->', n1)
body_img = None
for m in body.data.materials:
    if m and m.use_nodes:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image: body_img = n.image
if body_img and max(body_img.size) > CFG.get('texture_px', 2048):     # a 4096 px colour map is 3+ MB; 2048 is plenty at game distance
    body_img.scale(CFG.get('texture_px', 2048), CFG.get('texture_px', 2048))
log('body verts', len(body.data.vertices), 'material image', body_img.name if body_img else None)

# ----------------------------------------------------------------------------------------------- 2. props (bow / string / arrow)
props = {}
BOW = CFG.get('bow')
hand_side = 1 if (BOW or {}).get('hand', 'L') == 'L' else -1
handL = (LM['wrist'] + LM['hand_end']) / 2
def hand_center(side): return handL if side == 1 else mir(handL)
# a single held weapon (mace, sword, axe...) as its own GLB: upright, grip at the origin, head up +Z (blender/decimate_body.py does that)
WEAP = CFG.get('weapon')
if WEAP:
    hand_side = 1 if WEAP.get('hand', 'R') == 'L' else -1
    w_o = join(import_fbx(P(WEAP['glb'])), NAME + '_Weapon')
    target = hand_center(hand_side) + Vector(WEAP.get('offset', [0, 0, 0]))
    w_o.data.transform(T(target) @ Euler([math.radians(a_) for a_ in WEAP.get('rotate_deg', [0, 0, 0])], 'XYZ').to_matrix().to_4x4() @ S(WEAP.get('scale', 1.0)))
    props = dict(weapon=w_o, grip=target)
    log('weapon', tri_count(w_o), 'triangles on the', 'left' if hand_side == 1 else 'right', 'hand')
WEAP2 = CFG.get('weapon2')
if WEAP2:
    hand_side2 = 1 if WEAP2.get('hand', 'L') == 'L' else -1
    w2 = join(import_fbx(P(WEAP2['glb'])), NAME + '_Weapon2')
    if WEAP2.get('mirror', True): w2.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0)))); w2.data.flip_normals()
    target2 = hand_center(hand_side2) + Vector(WEAP2.get('offset', [0, 0, 0]))
    w2.data.transform(T(target2) @ Euler([math.radians(a_) for a_ in WEAP2.get('rotate_deg', [0, 0, 0])], 'XYZ').to_matrix().to_4x4() @ S(WEAP2.get('scale', 1.0)))
    props['weapon2'] = w2; props['grip2'] = target2
    log('second weapon', tri_count(w2), 'triangles on the', 'left' if hand_side2 == 1 else 'right', 'hand')
if BOW:
    bow_fbx = unzip_fbx(P(BOW['zip']))
    bparts = import_fbx(bow_fbx); raw = join(bparts, 'PropRaw')
    co = verts_np(raw); ids, nisl = island_ids(raw)
    H = co[:, 2].max() - co[:, 2].min()
    grp = np.zeros(nisl, dtype=np.int64)   # 0 bow, 1 string, 2 arrow
    for i in range(nisl):
        c = co[ids == i]; mn, mx = c.min(0), c.max(0); d = mx - mn; cen = (mn + mx) / 2
        on_arrow_side = cen[0] >= BOW.get('arrow_x_min', 0.12)
        if not on_arrow_side and d[2] >= 0.55 * H and d[0] <= 0.06 and d[1] <= 0.06: grp[i] = 1   # bowstring: long + thin + on the bow side
        elif on_arrow_side: grp[i] = 2
    log('prop islands', nisl, 'bow', int((grp == 0).sum()), 'string', int((grp == 1).sum()), 'arrow', int((grp == 2).sum()))
    gv = grp[ids]
    bow_o = extract(raw, gv == 0, NAME + '_Bow')
    str_o = extract(raw, gv == 1, NAME + '_String') if (gv == 1).any() else None
    arr_o = extract(raw, gv == 2, NAME + '_Arrow')
    bpy.data.objects.remove(raw)
    for key_, o_ in (('bow', bow_o), ('arrow', arr_o)):
        if DEC.get(key_): n0 = tri_count(o_); log(key_, 'triangles', n0, '->', decimate_to(o_, DEC[key_]))
    bc = verts_np(bow_o); zc = (bc[:, 2].min() + bc[:, 2].max()) / 2; hb = bc[:, 2].max() - bc[:, 2].min()
    near = bc[np.abs(bc[:, 2] - zc) < 0.06 * hb]
    grip = Vector((near[:, 0].max(), 0.0, zc))
    s_bow = BOW['height'] / hb
    target = hand_center(hand_side) + Vector(BOW.get('grip_offset', [0, 0, 0]))
    M_bow = T(target) @ Rz(BOW.get('rotate_z_deg', -90)) @ S(s_bow) @ T(-grip)
    for o in (bow_o, str_o):
        if o: o.data.transform(M_bow)
    ac = verts_np(arr_o); a_min, a_max = ac.min(0), ac.max(0); a_cen = (a_min + a_max) / 2
    s_arr = BOW['arrow_length'] / (a_max[2] - a_min[2])
    free_o = arr_o.copy(); free_o.data = arr_o.data.copy(); free_o.name = NAME + '_ArrowFree'; sc.collection.objects.link(free_o)
    free_o.data.transform(Rx(90) @ S(s_arr) @ T(-a_cen))                     # projectile: centred, points -Y (glTF +Z)
    nock = hand_center(-hand_side) + Vector((0, -0.01, 0))
    arr_o.data.transform(T(nock) @ Rx(90) @ S(s_arr) @ T(-Vector((a_cen[0], a_cen[1], a_min[2]))))   # tail at the hand, points -Y
    props = dict(bow=bow_o, string=str_o, arrow=arr_o, free=free_o, nock=nock, grip=target)
    if str_o:
        sv = verts_np(str_o); props['str_top'] = Vector((sv[:, 0].mean(), sv[:, 1].mean(), sv[:, 2].max()))
        props['str_bot'] = Vector((sv[:, 0].mean(), sv[:, 1].mean(), sv[:, 2].min()))
        props['str_mid'] = (props['str_top'] + props['str_bot']) / 2

# ----------------------------------------------------------------------------------------------- 3. armature
B = {}
def bone(name, head, tail, parent=None, deform=True):
    B[name] = dict(head=Vector(head), tail=Vector(tail), parent=parent, deform=deform)

bone('Root', (0, 0, 0), (0, 0, 0.08), None, False)
bone('Hips', LM['pelvis'], LM['spine'], 'Root')
bone('Spine', LM['spine'], LM['chest'], 'Hips')
bone('Chest', LM['chest'], LM['neck'], 'Spine')
bone('Neck', LM['neck'], LM['head'], 'Chest')
bone('Head', LM['head'], LM['head_top'], 'Neck')
for s, sx in (('L', 1), ('R', -1)):
    f = (lambda v: v) if sx == 1 else mir
    bone(f'UpperArm.{s}', f(LM['shoulder']), f(LM['elbow']), 'Chest')
    bone(f'LowerArm.{s}', f(LM['elbow']), f(LM['wrist']), f'UpperArm.{s}')
    bone(f'Hand.{s}', f(LM['wrist']), f(LM['hand_end']), f'LowerArm.{s}')
    bone(f'UpperLeg.{s}', f(LM['hip']), f(LM['knee']), 'Hips')
    bone(f'LowerLeg.{s}', f(LM['knee']), f(LM['ankle']), f'UpperLeg.{s}')
    bone(f'Foot.{s}', f(LM['ankle']), f(LM['toe']), f'LowerLeg.{s}')
    bone(f'IK_Hand.{s}', f(LM['wrist']), f(LM['hand_end']), 'Root', False)
    bone(f'IK_Foot.{s}', f(LM['ankle']), f(LM['toe']), 'Root', False)
    el, kn = f(LM['elbow']), f(LM['knee'])
    bone(f'Pole_Elbow.{s}', (el.x, el.y + 0.45, el.z), (el.x, el.y + 0.55, el.z), 'Root', False)
    bone(f'Pole_Knee.{s}', (kn.x, kn.y - 0.45, kn.z), (kn.x, kn.y - 0.55, kn.z), 'Root', False)
BODY_BONES = [n for n, d in B.items() if d['deform']]
if props.get('weapon'):
    hc = props['grip']; bone('Socket_Weapon', hc, hc + Vector((0, 0, 0.06)), f'Hand.{"L" if hand_side == 1 else "R"}')
if props.get('weapon2'):
    hc = props['grip2']; bone('Socket_Weapon2', hc, hc + Vector((0, 0, 0.06)), f'Hand.{"L" if hand_side2 == 1 else "R"}')
if props.get('bow'):
    hc = props['grip']; bone('Socket_Bow', hc, hc + Vector((0, 0, 0.06)), f'Hand.{"L" if hand_side == 1 else "R"}')
    nk = props['nock']; bone('Nock_Arrow', nk, nk + Vector((0, -0.1, 0)), f'Hand.{"R" if hand_side == 1 else "L"}')
    if props.get('string'):
        for nm, pt in (('StringTop', props['str_top']), ('StringNock', props['str_mid']), ('StringBot', props['str_bot'])):
            d = 0.04 if nm != 'StringNock' else 0.0
            tail = pt + Vector((0, -0.03, 0)) if nm == 'StringNock' else (pt + Vector((0, 0, -d)) if nm == 'StringTop' else pt + Vector((0, 0, d)))
            bone(nm, pt, tail, 'Socket_Bow')

arm_data = bpy.data.armatures.new(NAME + '_Armature'); arm = bpy.data.objects.new(NAME + '_Armature', arm_data)
sc.collection.objects.link(arm); bpy.context.view_layer.objects.active = arm; arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); eb = {}
for n, d in B.items():
    b = arm_data.edit_bones.new(n); b.head, b.tail = d['head'], d['tail']; b.use_deform = d['deform']; eb[n] = b
for n, d in B.items():
    if d['parent']:
        eb[n].parent = eb[d['parent']]
        if (eb[d['parent']].tail - eb[n].head).length < 1e-5: eb[n].use_connect = True
bpy.ops.object.mode_set(mode='OBJECT')

# ----------------------------------------------------------------------------------------------- 4. skinning
def seg_dist(P_, A, Bb):
    AB = Bb - A; L2 = (AB ** 2).sum(-1) + 1e-12
    t = np.clip(((P_[:, None, :] - A[None]) * AB[None]).sum(-1) / L2[None], 0, 1)
    C = A[None] + t[..., None] * AB[None]
    return np.linalg.norm(P_[:, None, :] - C, axis=-1)

AUTO = CFG.get('weights', {}).get('method') == 'auto'      # Blender's bone-heat weights: they follow the body's volume, so an arm hanging next to the hip does not drag the waist
if AUTO:
    # glTF import splits vertices along texture seams; weld them (UVs are kept per corner) so the surface is one connected piece, or bone heat finds no solution
    bpy.ops.object.mode_set(mode='OBJECT'); bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=0.00002); bpy.ops.object.mode_set(mode='OBJECT')
    log('welded body: verts', len(body.data.vertices))
    bpy.ops.object.mode_set(mode='OBJECT'); bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    log('bone-heat weights on', len(body.vertex_groups), 'groups')
    if CFG.get('weights', {}).get('spatial'):
        # a mesh made of thousands of overlapping fragments (fur, hair) gets a different bone-heat answer on each fragment, so neighbours tear apart in motion:
        # replace it with weights that depend only on POSITION (blend of the nearest bones), which every fragment agrees on
        WS_ = CFG['weights']; nbS_ = [n_ for n_, d_ in B.items() if d_['deform'] and not n_.startswith('Socket_') and n_ in body.vertex_groups]
        AS_ = np.array([B[n_]['head'][:] for n_ in nbS_]); BS_ = np.array([B[n_]['tail'][:] for n_ in nbS_]); cS_ = verts_np(body); DS_ = seg_dist(cS_, AS_, BS_)
        rawS_ = 1.0 / (DS_ + WS_.get('spatial_eps', 0.02)) ** WS_.get('spatial_power', 2.0); topS_ = np.argsort(-rawS_, axis=1)[:, :WS_.get('spatial_top', 3)]
        for g_ in body.vertex_groups: g_.remove(list(range(len(cS_))))
        for vi_ in range(len(cS_)):
            w_ = rawS_[vi_, topS_[vi_]]; w_ = w_ / w_.sum()
            for k_, wv_ in zip(topS_[vi_], w_): body.vertex_groups[nbS_[int(k_)]].add([vi_], float(wv_), 'REPLACE')
        log('spatial weights on', len(cS_), 'vertices')
    # bone heat also hands body vertices to the prop sockets sitting in the palms: give that weight back to the hand bone the socket hangs from
    for v in body.data.vertices:
        gs = {body.vertex_groups[g_.group].name: g_.weight for g_ in v.groups}; soc = [n_ for n_ in gs if n_.startswith('Socket_')]
        if not soc: continue
        for n_ in soc:
            par = arm.data.bones[n_].parent.name; body.vertex_groups[n_].remove([v.index])
            body.vertex_groups[par].add([v.index], gs[n_], 'ADD')
    WC_ = CFG.get('weights', {}); HZ_ = WC_.get('head_z')
    if HZ_ is not None and body.vertex_groups.get('Head'):
        # the head (hood, ears) follows the Head bone; a cloak hanging down the back (y > back_y) follows head -> chest -> spine by height, never the arms
        BL_ = WC_.get('head_blend', 0.07); BY_ = WC_.get('back_y'); vgs = {g_.index: g_.name for g_ in body.vertex_groups}; hd = body.vertex_groups['Head']; nh = 0
        AY_ = WC_.get('arm_y', 0.06); AR_ = WC_.get('arm_r', 0.12); ARM_SEGS = []
        for sd_ in (1, -1):
            pts_ = [Vector((LM[k_].x * sd_, AY_, LM[k_].z)) for k_ in ('shoulder', 'elbow', 'wrist', 'hand_end')]; ARM_SEGS += list(zip(pts_[:-1], pts_[1:]))
        def arm_zone(c_):
            for a0, a1 in ARM_SEGS:
                ab = a1 - a0; t_ = max(0.0, min(1.0, (c_ - a0).dot(ab) / (ab.dot(ab) + 1e-9)))
                if (c_ - (a0 + ab * t_)).length < AR_: return True
            return False
        ARMS_ = tuple(n_ for n_ in vgs.values() if n_.startswith(('UpperArm', 'LowerArm', 'Hand')))
        for v in body.data.vertices:
            z_ = v.co.z; back = BY_ is not None and v.co.y > BY_ and abs(v.co.x) < WC_.get('back_x', 0.5) and not arm_zone(v.co)   # cloak down the back; anything within reach of an arm keeps its arm weights
            t_ = max(0.0, min(1.0, (z_ - (HZ_ - BL_)) / BL_)) if BL_ > 0 else (1.0 if z_ > HZ_ else 0.0)
            if t_ <= 0 and not back: continue
            cur = {vgs[g_.group]: g_.weight for g_ in v.groups}
            if back:
                for n_ in list(cur):
                    if n_.startswith(ARMS_): cur.pop(n_)
                if not cur: cur = {'Chest': 1.0}
            tot = sum(cur.values()) or 1.0
            for n_ in cur: cur[n_] = cur[n_] / tot * (1 - t_)
            cur['Head'] = cur.get('Head', 0.0) + t_
            for g_ in body.vertex_groups: g_.remove([v.index])
            for n_, w_ in cur.items():
                if w_ > 1e-3: body.vertex_groups[n_].add([v.index], w_, 'REPLACE')
            nh += 1
        log('head_z: reweighted', nh, 'vertices around the head / back cloak')
    # bone heat leaves whole loose pieces (hair, fur tufts, tassels) with no weights at all, so they would stay behind when the body moves.
    # Give each such piece to the bone nearest its centre if it is small (it moves rigidly), or blend its vertices between their two nearest bones if it is big.
    vgn = {g_.index: g_.name for g_ in body.vertex_groups}; nb_ = [n_ for n_, d_ in B.items() if d_['deform'] and not n_.startswith('Socket_') and n_ in body.vertex_groups]
    A_ = np.array([B[n_]['head'][:] for n_ in nb_]); Bb_ = np.array([B[n_]['tail'][:] for n_ in nb_]); co_ = verts_np(body); ids_, nisl_ = island_ids(body)
    tot_ = np.zeros(len(co_))
    for v in body.data.vertices: tot_[v.index] = sum(g_.weight for g_ in v.groups)
    RG_ = CFG.get('weights', {}).get('rigid_island_max', 0.30); nz_ = 0
    for i_ in range(nisl_):
        m_ = ids_ == i_; bad_ = m_ & (tot_ < 1e-3)
        if not bad_.any(): continue
        c_ = co_[m_]; ext_ = (c_.max(0) - c_.min(0)).max()
        if False:   # (a rigid piece next to its neighbours tears the surface apart when they follow different bones: always blend per vertex)
            d_ = seg_dist(c_.mean(0, keepdims=True), A_, Bb_)[0]; tgt_ = [(vi_, {nb_[int(np.argmin(d_))]: 1.0}) for vi_ in np.nonzero(bad_)[0]]
        else:
            D_ = seg_dist(co_[bad_], A_, Bb_); raw_ = 1.0 / (D_ + 0.02) ** 2; top_ = np.argsort(-raw_, axis=1)[:, :3]; tgt_ = []
            for k_, vi_ in enumerate(np.nonzero(bad_)[0]):
                w_ = raw_[k_, top_[k_]]; tgt_.append((vi_, {nb_[int(top_[k_][q_])]: float(w_[q_] / w_.sum()) for q_ in range(3)}))
        for vi_, ws_ in tgt_:
            for n_, w_ in ws_.items(): body.vertex_groups[n_].add([int(vi_)], w_, 'REPLACE')
            nz_ += 1
    log('unweighted vertices given bones by piece:', nz_)
else:
    names = BODY_BONES
    A = np.array([B[n]['head'][:] for n in names]); Bb = np.array([B[n]['tail'][:] for n in names])
    co = verts_np(body); D = seg_dist(co, A, Bb)
    ids, nisl = island_ids(body)
    RIGID = CFG.get('weights', {}).get('rigid_island_max', 0.30); POW = CFG.get('weights', {}).get('power', 3.0)
    W = np.zeros((len(co), len(names)))
    # weights: each vertex blends its nearest bones (default 2). Config: weights.top = how many bones may share a vertex, weights.bias = {bone: multiplier}
    # (a multiplier above 1 makes that bone win more often: e.g. the Chest and Spine, so cloth that hangs from the shoulders stays with the torso when the arms move)
    TOPN = int(CFG.get('weights', {}).get('top', 2)); BIAS = np.array([float(CFG.get('weights', {}).get('bias', {}).get(n, 1.0)) for n in names])
    raw = BIAS[None, :] / (D + 0.01) ** POW; top = np.argsort(-raw, axis=1)[:, :TOPN]
    for vi in range(len(co)):
        w_ = raw[vi, top[vi]]; W[vi, top[vi]] = w_ / w_.sum()
    rigid_count = 0
    for i in range(nisl):
        m = ids == i; c = co[m]; ext = (c.max(0) - c.min(0)).max()
        if ext <= RIGID:
            cen = c.mean(0, keepdims=True); d = seg_dist(cen, A, Bb)[0]; W[m, :] = 0; W[m, int(np.argmin(d))] = 1.0; rigid_count += 1
    HZ = CFG.get('weights', {}).get('head_z')      # everything above this height is the head (a big helmet must not be dragged by the arms beside it)
    if HZ is not None and 'Head' in names: W[co[:, 2] > HZ, :] = 0; W[co[:, 2] > HZ, names.index('Head')] = 1.0
    log('islands', nisl, 'rigid', rigid_count, 'blended', nisl - rigid_count)
    for j, n in enumerate(names):
        vg = body.vertex_groups.new(name=n)
        for vi in np.nonzero(W[:, j] > 1e-3)[0]: vg.add([int(vi)], float(W[vi, j]), 'REPLACE')


def rigid_group(o, bone_name):
    vg = o.vertex_groups.new(name=bone_name); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
if props.get('weapon'):
    sc.collection.objects.link(props['weapon']) if props['weapon'].name not in sc.collection.objects else None
    rigid_group(props['weapon'], 'Socket_Weapon')
if props.get('weapon2'):
    sc.collection.objects.link(props['weapon2']) if props['weapon2'].name not in sc.collection.objects else None
    rigid_group(props['weapon2'], 'Socket_Weapon2')
if props.get('bow'):
    for key in ('bow', 'arrow', 'string'):
        o = props.get(key)
        if o is None: continue
        sc.collection.objects.link(o) if o.name not in sc.collection.objects else None
    rigid_group(props['bow'], 'Socket_Bow'); rigid_group(props['arrow'], 'Nock_Arrow')
    if props.get('string'):
        so = props['string']; sv = verts_np(so); z0, z1 = props['str_bot'].z, props['str_top'].z
        gT, gN, gB = (so.vertex_groups.new(name=n) for n in ('StringTop', 'StringNock', 'StringBot'))
        for vi, v in enumerate(sv):
            t = float(np.clip((v[2] - z0) / (z1 - z0 + 1e-9), 0, 1))
            wt, wn, wb = (max(0, 2 * t - 1), 1 - abs(2 * t - 1), max(0, 1 - 2 * t))
            if wt > 1e-3: gT.add([vi], wt, 'REPLACE')
            if wn > 1e-3: gN.add([vi], wn, 'REPLACE')
            if wb > 1e-3: gB.add([vi], wb, 'REPLACE')
skinned = [body] + [props[k] for k in ('weapon', 'weapon2', 'bow', 'arrow', 'string') if props.get(k)]
for o in skinned:
    if AUTO and o is body: continue
    o.parent = arm; md = o.modifiers.new('Armature', 'ARMATURE'); md.object = arm

# ----------------------------------------------------------------------------------------------- IK + constraints
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
PB = arm.pose.bones
for p in PB: p.rotation_mode = 'QUATERNION'
for s in ('L', 'R'):
    ik = PB[f'LowerLeg.{s}'].constraints.new('IK'); ik.name = 'IK'
    ik.target, ik.subtarget = arm, f'IK_Foot.{s}'; ik.pole_target, ik.pole_subtarget = arm, f'Pole_Knee.{s}'; ik.chain_count = 2
    cr = PB[f'Foot.{s}'].constraints.new('COPY_ROTATION'); cr.target, cr.subtarget = arm, f'IK_Foot.{s}'; cr.target_space = cr.owner_space = 'WORLD'
    ik = PB[f'LowerArm.{s}'].constraints.new('IK'); ik.name = 'IK'
    ik.target, ik.subtarget = arm, f'IK_Hand.{s}'; ik.pole_target, ik.pole_subtarget = arm, f'Pole_Elbow.{s}'; ik.chain_count = 2
    cr = PB[f'Hand.{s}'].constraints.new('COPY_ROTATION'); cr.target, cr.subtarget = arm, f'IK_Hand.{s}'; cr.target_space = cr.owner_space = 'WORLD'
if props and props.get('string'):
    cl = PB['StringNock'].constraints.new('COPY_LOCATION'); cl.name = 'StringPull'
    cl.target, cl.subtarget = arm, f'Hand.{"R" if hand_side == 1 else "L"}'; cl.head_tail = 0.5; cl.influence = 0.0

def world_mid_joint(lower_name):   # position of the elbow/knee = head of the lower bone
    bpy.context.view_layer.update()
    ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get()); return ev.pose.bones[lower_name].head.copy()

def place_ctrl(name, off):
    pb = PB[name]; rest = pb.bone.matrix_local.copy(); m = rest.copy(); m.translation = rest.translation + Vector(off); pb.matrix = m; bpy.context.view_layer.update()

# choose the IK pole angle automatically: the one that puts the elbow/knee closest to its pole
for s in ('L', 'R'):
    for lower, ctrl, pole, bend in ((f'LowerArm.{s}', f'IK_Hand.{s}', f'Pole_Elbow.{s}', (0.0, -0.10, 0.10)), (f'LowerLeg.{s}', f'IK_Foot.{s}', f'Pole_Knee.{s}', (0.0, 0.0, 0.07))):
        con = PB[lower].constraints['IK']; pole_pos = B[pole]['head']; best = (1e9, 0)
        place_ctrl(ctrl, bend)
        for deg in range(-180, 181, 45):
            con.pole_angle = math.radians(deg); j = world_mid_joint(lower); dist = (j - pole_pos).length
            if dist < best[0]: best = (dist, deg)
        con.pole_angle = math.radians(best[1]); PB[ctrl].location = (0, 0, 0); PB[ctrl].rotation_quaternion = (1, 0, 0, 0); bpy.context.view_layer.update()
        log('pole angle', lower, best[1])

# ----------------------------------------------------------------------------------------------- 5. clips
def set_pose(name, off=(0, 0, 0), rot=(0, 0, 0)):
    pb = PB[name]; bone = pb.bone; rest = bone.matrix_local; head = rest.translation
    m = T(off) @ T(head) @ Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4() @ T(-head) @ rest
    if bone.parent: m = (PB[bone.parent.name].matrix @ bone.parent.matrix_local.inverted()) @ m
    pb.matrix = m; bpy.context.view_layer.update()

WRIST_L, WRIST_R = LM['wrist'], mir(LM['wrist'])
def apply(p):
    d = dict(root_off=(0, 0, 0), root_rot=(0, 0, 0), hips_off=(0, 0, 0), hips_rot=(0, 0, 0), spine_rot=(0, 0, 0), chest_rot=(0, 0, 0), neck_rot=(0, 0, 0), head_rot=(0, 0, 0),
             hand_L=tuple(WRIST_L), hand_R=tuple(WRIST_R), rot_L=(0, 0, 0), rot_R=(0, 0, 0), foot_L=(0, 0, 0), foot_R=(0, 0, 0), pull=0.0, nock=0.0)
    d.update(p)
    set_pose('Root', d['root_off'], d['root_rot']); set_pose('Hips', d['hips_off'], d['hips_rot'])
    set_pose('Spine', (0, 0, 0), d['spine_rot']); set_pose('Chest', (0, 0, 0), d['chest_rot']); set_pose('Neck', (0, 0, 0), d['neck_rot']); set_pose('Head', (0, 0, 0), d['head_rot'])
    set_pose('IK_Hand.L', Vector(d['hand_L']) - WRIST_L, d['rot_L']); set_pose('IK_Hand.R', Vector(d['hand_R']) - WRIST_R, d['rot_R'])
    set_pose('IK_Foot.L', d['foot_L']); set_pose('IK_Foot.R', d['foot_R'])
    if 'Nock_Arrow' in PB:
        s = 1.0 if d['nock'] > 0.5 else 0.001; PB['Nock_Arrow'].scale = (s, s, s)
    if 'StringNock' in PB: PB['StringNock'].constraints['StringPull'].influence = d['pull']
CTRL = ['IK_Hand.L', 'IK_Hand.R', 'IK_Foot.L', 'IK_Foot.R']; POLES = [f'Pole_{k}.{s}' for k in ('Elbow', 'Knee') for s in 'LR']
ORDER = ['Root', 'Hips', 'Spine', 'Chest', 'Neck', 'Head'] + CTRL
EXPORT_BONES = [b.name for b in arm.data.bones if not b.name.startswith(('IK_', 'Pole_'))]
def key(f):
    for n in ORDER:
        PB[n].keyframe_insert('location', frame=f); PB[n].keyframe_insert('rotation_quaternion', frame=f)
    if 'Nock_Arrow' in PB: PB['Nock_Arrow'].keyframe_insert('scale', frame=f)
    if 'StringNock' in PB: PB['StringNock'].constraints['StringPull'].keyframe_insert('influence', frame=f)

sm = lambda t: (lambda u: u * u * (3 - 2 * u))(max(0.0, min(1.0, t)))
seg = lambda t, a, b: sm((t - a) / (b - a))
lerp = lambda a, b, t: a + (b - a) * t
def vl(a, b, t): return tuple(lerp(x, y, t) for x, y in zip(a, b))
def va(a, b): return tuple(x + y for x, y in zip(a, b))
V = lambda *a: tuple(a)

# absolute hand targets (metres, character space, faces -Y)
GL, GR = V(0.20, -0.12, 0.40), V(-0.15, -0.10, 0.40)          # guard: bow hand low in front of the hip, draw hand at the belt
def idle(f, n=60):
    w = 2 * math.pi * f / n
    return dict(hips_off=(0, 0, 0.006 * math.sin(w)), chest_rot=(1.5 * math.sin(w - 0.6), 0, 1.5 * math.sin(w)), head_rot=(-1.0 * math.sin(w - 1.0), 0, 2.5 * math.sin(w * 0.5)),
                hand_L=va(GL, (0, 0, 0.006 * math.sin(w - 0.4))), hand_R=va(GR, (0, 0, 0.006 * math.sin(w - 0.8))))
def walk(f, n=30, stride=0.07, lift=0.04, bob=0.010, lean=3, arm=0.03, run=False):
    w = 2 * math.pi * f / n
    foot = lambda ph: (0, -stride * math.sin(w + ph), lift * max(0, math.cos(w + ph)))
    return dict(hips_off=(0.004 * math.sin(w), -0.008 if run else 0, bob * math.cos(2 * w) - (0.02 if run else 0)), hips_rot=(lean, 0, 3 * math.sin(w)),
                chest_rot=(lean * 0.5, 0, -5 * math.sin(w)), head_rot=(-lean * 0.6, 0, 2 * math.sin(w)), foot_L=foot(0), foot_R=foot(math.pi),
                hand_L=va(GL, (0, arm * math.sin(w), 0.02 * math.cos(2 * w))), hand_R=va(GR, (0, -arm * math.sin(w), 0.01 * math.cos(2 * w))))
def run(f, n=20):
    d = walk(f, n, stride=0.115, lift=0.07, bob=0.016, lean=11, arm=0.07, run=True)
    w = 2 * math.pi * f / n; d['hand_L'] = V(0.17, -0.20, 0.47 + 0.02 * math.sin(w)); d['hand_R'] = V(-0.19, -0.06 - 0.10 * math.sin(w), 0.38); return d
def shoot(f, n=45):
    p = f / n; raise_ = seg(p, 0, .18); pull = seg(p, .20, .60); rel = seg(p, .78, .84); aim = raise_ * (1 - seg(p, .90, 1.0))
    bowh = V(0.10, -0.27, 0.58); nockp = V(0.06, -0.25, 0.57); cheek = V(-0.05, -0.12, 0.66)
    hl = vl(GL, bowh, aim); hr = vl(GR, nockp, raise_); hr = vl(hr, cheek, pull); hr = vl(hr, nockp, rel); hr = vl(hr, GR, seg(p, .90, 1.0))
    return dict(hand_L=hl, hand_R=hr, chest_rot=(-3 * aim, 0, 12 * aim), head_rot=(-6, 0, -14 * aim), hips_off=(0, 0, -0.02 * aim),
                foot_L=(0, -0.05 * aim, 0), foot_R=(0, 0.04 * aim, 0), pull=(pull * (1 - rel)) if 0.10 < p < 0.80 else 0.0, nock=1.0 if 0.10 < p < 0.80 else 0.0)
def flex(f, n=72):
    p = f / n; w = p * 2 * math.pi * 2; up = seg(p, .05, .22) * (1 - seg(p, .86, 1.0)); pulse = max(0, math.sin(w)) * 0.5
    return dict(hand_L=vl(GL, V(0.22, -0.07 - 0.02 * pulse, 0.66), up), hand_R=vl(GR, V(-0.22, -0.07 - 0.02 * pulse, 0.66), up),
                chest_rot=(-10 * up, 0, 0), head_rot=(-14 * up, 0, 4 * math.sin(w * .5) * up), hips_off=(0, 0, 0.012 * math.sin(w) * up - 0.01 * up))
def hit(f, n=18):
    k = math.sin(max(0, min(1, f / n)) * math.pi)
    return dict(hand_L=va(GL, (0.03, 0.03, 0.10 * k)), hand_R=va(GR, (-0.03, 0.05, 0.10 * k)), chest_rot=(-22 * k, 0, 5 * k), head_rot=(-16 * k, 0, -8 * k), hips_off=(0, 0.05 * k, -0.02 * k))
DEATH_LEN = 35
def death(f):
    stag = seg(f, 0, 5); stagger = dict(hand_L=va(GL, (0.03, 0.03, 0.10)), hand_R=va(GR, (-0.03, 0.05, 0.10)), chest_rot=(-15, 0, 5), head_rot=(-12, 0, -8), hips_off=(0, 0.05, -0.02))
    if f <= 5:
        k = f / 5; return {kk: (tuple(lerp(0, x, k) for x in v) if kk.endswith(('_rot', '_off')) else vl(GL if kk == 'hand_L' else GR, v, k)) for kk, v in stagger.items()}
    t = min(1.0, (f - 5) / 22); e = t * t * (3 - 2 * t); d = dict(stagger)
    d['root_rot'] = (-88 * e, 0, 0); d['root_off'] = (0, 0.03 * e, 0.17 * e); d['hips_off'] = vl(stagger['hips_off'], (0, 0.02, 0), e)
    d['chest_rot'] = vl(stagger['chest_rot'], (0, 0, 0), e); d['head_rot'] = vl(stagger['head_rot'], (-8, 0, 12), e)
    d['hand_L'] = vl(va(GL, (0.03, 0.03, 0.10)), (0.34, 0.06, 0.30), e); d['hand_R'] = vl(va(GR, (-0.03, 0.05, 0.10)), (-0.34, 0.06, 0.30), e)
    d['foot_L'] = vl((0, 0, 0), (0.03, 0.02, 0.03), e); d['foot_R'] = vl((0, 0, 0), (-0.03, 0.05, 0.02), e)
    if f > 27: s = min(1.0, (f - 27) / 6); d['root_off'] = va(d['root_off'], (0, 0, 0.012 * math.sin(s * math.pi) * (1 - s)))
    return d
def spawn(f): return death(DEATH_LEN - f)
# ---- Ogre: heavy, slow, grumpy. Wrist targets are in metres from the rest pose; rot_R (degrees about X) swings the mace, + = head forward/down.
RL, RR = tuple(WRIST_L), tuple(WRIST_R)
ROT0 = 115   # how the mace hangs at rest: head forward and down, resting near the ground (0 = head straight up)
def o_idle(f, n=60):
    w = 2 * math.pi * f / n; br = math.sin(w)
    return dict(hips_off=(0, 0, 0.008 * br), chest_rot=(2.0 * br, 0, 1.2 * math.sin(w * 0.5)), head_rot=(-1.0 * math.sin(w - 1.0), 0, 3 * math.sin(w * 0.5)),
                hand_L=va(RL, (0, -0.02, 0.006 * math.sin(w - 0.4))), hand_R=va(RR, (0.02, -0.06, 0.006 * math.sin(w - 0.8))), rot_R=(ROT0 + 2 * br, 0, 0))
def o_walk(f, n=36, stride=0.06, lift=0.035, bob=0.014, lean=2, run=False):
    w = 2 * math.pi * f / n
    foot = lambda ph: (0, -stride * math.sin(w + ph), lift * max(0, math.cos(w + ph)))
    return dict(hips_off=(0.012 * math.sin(w), -0.006 if run else 0, bob * math.cos(2 * w) - (0.02 if run else 0)), hips_rot=(lean, 0, 4 * math.sin(w)), chest_rot=(lean * 0.5, 0, -6 * math.sin(w)),
                head_rot=(-lean * 0.6, 0, 2 * math.sin(w)), foot_L=foot(0), foot_R=foot(math.pi),
                hand_L=va(RL, (0, 0.04 * math.sin(w) - 0.02, 0.015 * math.cos(2 * w))), hand_R=va(RR, (0.02, -0.06 - 0.03 * math.sin(w), 0.012 * math.cos(2 * w))), rot_R=(ROT0 - 6 + 8 * math.sin(w), 0, 0))
def o_run(f, n=24):
    d = o_walk(f, n, stride=0.09, lift=0.055, bob=0.02, lean=9, run=True); w = 2 * math.pi * f / n
    d['hand_L'] = va(RL, (-0.02, -0.10 + 0.05 * math.sin(w), 0.04)); d['hand_R'] = va(RR, (0.03, -0.10, 0.05 + 0.02 * math.sin(w))); d['rot_R'] = (ROT0 - 45 + 10 * math.sin(w), 0, 0); return d
def o_attack(f, n=40):
    p = f / n; wind = seg(p, 0, .34); slam = seg(p, .44, .56); rec = seg(p, .70, 1.0)
    hr = vl(RR, V(-0.31, -0.02, 0.80), wind); hr = vl(hr, V(-0.31, -0.24, 0.47), slam); hr = vl(hr, RR, rec)
    rot = lerp(ROT0, -50, wind); rot = lerp(rot, 150, slam); rot = lerp(rot, -10, rec)
    hl = vl(RL, V(0.28, -0.05, 0.74), wind); hl = vl(hl, V(0.29, -0.20, 0.50), slam); hl = vl(hl, RL, rec)
    lean = lerp(lerp(-22 * wind, 32, slam), 0, rec)
    return dict(hand_R=hr, hand_L=hl, rot_R=(rot, 0, 0), chest_rot=(lean, 0, 4 * slam), head_rot=(lerp(-8 * wind, 14, slam) * (1 - rec), 0, 0),
                hips_off=(0, -0.06 * slam * (1 - rec), -0.03 * slam * (1 - rec)), foot_R=(0, -0.05 * slam * (1 - rec), 0))
def o_hit(f, n=18):
    k = math.sin(max(0, min(1, f / n)) * math.pi)
    return dict(chest_rot=(-20 * k, 0, 5 * k), head_rot=(-14 * k, 0, -6 * k), hips_off=(0, 0.05 * k, -0.02 * k),
                hand_R=va(RR, (0.02, -0.06 + 0.05 * k, 0.02 * k)), hand_L=va(RL, (0, 0.04 * k, 0.03 * k)), rot_R=(ROT0 - 14 * k, 0, 0))
def o_death(f):
    stag = dict(chest_rot=(-15, 0, 5), head_rot=(-12, 0, -8), hips_off=(0, 0.05, -0.02), hand_R=va(RR, (0.02, -0.01, 0.02)), hand_L=va(RL, (0, 0.04, 0.03)), rot_R=(ROT0 + 12, 0, 0))
    if f <= 5:
        k = f / 5; return dict(chest_rot=vl((0, 0, 0), stag['chest_rot'], k), head_rot=vl((0, 0, 0), stag['head_rot'], k), hips_off=vl((0, 0, 0), stag['hips_off'], k),
                               hand_R=vl(va(RR, (0.02, -0.06, 0)), stag['hand_R'], k), hand_L=vl(RL, stag['hand_L'], k), rot_R=(lerp(ROT0, ROT0 + 12, k), 0, 0))
    t = min(1.0, (f - 5) / 22); e = t * t * (3 - 2 * t); d = dict(stag)
    d['root_rot'] = (-88 * e, 0, 0); d['root_off'] = (0, 0.03 * e, 0.20 * e); d['hips_off'] = vl(stag['hips_off'], (0, 0.02, 0), e)
    d['chest_rot'] = vl(stag['chest_rot'], (0, 0, 0), e); d['head_rot'] = vl(stag['head_rot'], (-8, 0, 12), e)
    d['hand_L'] = vl(stag['hand_L'], V(0.40, 0.06, 0.28), e); d['hand_R'] = vl(stag['hand_R'], V(-0.40, 0.06, 0.28), e); d['rot_R'] = (lerp(ROT0 + 12, 150, e), 0, 0)
    d['foot_L'] = vl((0, 0, 0), (0.03, 0.02, 0.03), e); d['foot_R'] = vl((0, 0, 0), (-0.03, 0.05, 0.02), e)
    if f > 27: s_ = min(1.0, (f - 27) / 6); d['root_off'] = va(d['root_off'], (0, 0, 0.012 * math.sin(s_ * math.pi) * (1 - s_)))
    return d
def o_spawn(f, n=50):   # still asleep, slowly wakes up, grabs the mace, ready to fight
    p = f / n; asleep = 1 - seg(p, .40, .62); jerk = seg(p, .30, .38) * (1 - seg(p, .38, .46)) * math.sin(f * 2.2)
    stretch = seg(p, .55, .74) * (1 - seg(p, .74, .92)); grab = seg(p, .64, .86)
    hr = vl(V(-0.33, -0.16, 0.20), va(RR, (0.02, -0.06, 0)), grab); rot = lerp(100, ROT0, grab)
    hl = va(vl(V(0.30, -0.12, 0.20), RL, seg(p, .5, .8)), (0.06 * stretch, 0, 0.12 * stretch))
    return dict(hips_off=(0, 0.02 * asleep, -0.09 * asleep), chest_rot=(24 * asleep - 10 * stretch, 0, 0), head_rot=(30 * asleep - 8 * stretch, 0, 7 * jerk),
                hand_R=hr, hand_L=hl, rot_R=(rot, 0, 0))
def o_yawn(f, n=70):
    p = f / n; up = seg(p, .12, .40) * (1 - seg(p, .72, .94)); sh = math.sin(p * 2 * math.pi * 3) * up
    return dict(chest_rot=(-12 * up, 0, 0), head_rot=(-22 * up, 0, 2 * sh), hips_off=(0, 0, 0.01 * up),
                hand_L=vl(va(RL, (0, -0.02, 0)), V(0.30, -0.06, 0.72), up), hand_R=vl(va(RR, (0.02, -0.06, 0)), V(-0.30, -0.06, 0.72), up), rot_R=(lerp(ROT0, 60, up), 0, 0))
def o_cheer(f, n=60):
    p = f / n; up = seg(p, 0, .2) * (1 - seg(p, .85, 1.0)); pump = max(0, math.sin(p * 2 * math.pi * 3)) * up
    return dict(chest_rot=(-14 * up, 0, 0), head_rot=(-12 * up - 5 * pump, 0, 0), hips_off=(0, 0, 0.03 * pump),
                hand_L=vl(RL, V(0.30, -0.02 - 0.04 * pump, 0.80 + 0.03 * pump), up), hand_R=vl(va(RR, (0.02, -0.06, 0)), V(-0.31, -0.02 - 0.04 * pump, 0.80 + 0.03 * pump), up), rot_R=(lerp(ROT0, -30, up), 0, 0))
def dbl(f, n=90):   # double biceps: both arms up, chest out, alternating pump, proud head turns
    p = f / n; up = seg(p, .06, .22) * (1 - seg(p, .88, 1.0)); w = p * 2 * math.pi * 3; pa = max(0, math.sin(w)) * up; pb = max(0, -math.sin(w)) * up
    return dict(hand_L=vl(GL, V(0.30, -0.02 - 0.03 * pa, 0.72 + 0.03 * pa), up), hand_R=vl(GR, V(-0.30, -0.02 - 0.03 * pb, 0.72 + 0.03 * pb), up),
                chest_rot=(-12 * up, 0, 5 * math.sin(w) * up), head_rot=(-12 * up, 0, 14 * math.sin(w / 3) * up), hips_off=(0, 0, -0.03 * up + 0.01 * (pa + pb)),
                foot_L=(0.03 * up, 0, 0), foot_R=(-0.03 * up, 0, 0))
def crack(f, n=80):   # neck crack: hands to the jaw, head snaps to each side
    p = f / n; up = seg(p, .05, .2) * (1 - seg(p, .86, 1.0)); s1 = seg(p, .30, .34) - seg(p, .48, .52); s2 = seg(p, .56, .60) - seg(p, .74, .78)
    return dict(hand_L=vl(GL, V(0.10, -0.16, 0.64), up), hand_R=vl(GR, V(-0.10, -0.16, 0.64), up), chest_rot=(-4 * up, 0, 0),
                head_rot=(-6 * up, 0, 26 * s1 - 24 * s2), neck_rot=(0, 0, 8 * s1 - 8 * s2), hips_off=(0, 0, 0.006 * (s1 + s2)))
def twirl(f, n=70):   # spin the bow on the fingers, catch it, tip the head
    p = f / n; up = seg(p, .05, .18) * (1 - seg(p, .90, 1.0)); spin = seg(p, .20, .66)
    return dict(hand_L=vl(GL, V(0.20, -0.20, 0.52), up), rot_L=(720 * spin, 0, 0),
                chest_rot=(-3 * up, 0, 8 * math.sin(spin * math.pi) * up), head_rot=(-6 * up + 8 * seg(p, .70, .80) * (1 - seg(p, .84, 1.0)), 0, 0), hips_off=(0, 0, 0.012 * math.sin(spin * math.pi * 2)))
# ---- Warrior: small, brave, clumsy. Sword in the right hand (rot_R: degrees about X, 0 = blade straight up, + = tip forward/down); left fist guards.
WL, WR = V(0.13, -0.13, 0.34), V(-0.12, -0.15, 0.36)
WR0 = 38
def w_idle(f, n=60):
    w = 2 * math.pi * f / n; br = math.sin(w)
    return dict(hips_off=(0, 0, 0.006 * br), chest_rot=(1.5 * br, 0, 1.5 * math.sin(w * 0.5)), head_rot=(-1.0 * math.sin(w - 1.0), 0, 3 * math.sin(w * 0.5)),
                hand_L=va(WL, (0, 0, 0.006 * math.sin(w - 0.4))), hand_R=va(WR, (0, 0, 0.006 * math.sin(w - 0.8))), rot_R=(WR0 + 3 * br, 0, 0))
def w_walk(f, n=32, stride=0.065, lift=0.04, bob=0.012, lean=3, arm=0.03, run=False):
    w = 2 * math.pi * f / n
    foot = lambda ph: (0, -stride * math.sin(w + ph), lift * max(0, math.cos(w + ph)))
    return dict(hips_off=(0.006 * math.sin(w), -0.008 if run else 0, bob * math.cos(2 * w) - (0.02 if run else 0)), hips_rot=(lean, 0, 4 * math.sin(w)), chest_rot=(lean * 0.5, 0, -5 * math.sin(w)),
                head_rot=(-lean * 0.6, 0, 2 * math.sin(w)), foot_L=foot(0), foot_R=foot(math.pi),
                hand_L=va(WL, (0, arm * math.sin(w), 0.02 * math.cos(2 * w))), hand_R=va(WR, (0, -arm * math.sin(w), 0.012 * math.cos(2 * w))), rot_R=(WR0 + 6 * math.sin(w), 0, 0))
def w_run(f, n=20):
    d = w_walk(f, n, stride=0.11, lift=0.07, bob=0.018, lean=11, arm=0.07, run=True); w = 2 * math.pi * f / n
    d['hand_L'] = V(0.14, -0.16 - 0.06 * math.sin(w), 0.42); d['hand_R'] = V(-0.13, -0.20 + 0.06 * math.sin(w), 0.42); d['rot_R'] = (WR0 + 25, 0, 0); return d
def w_attack(f, n=36):
    p = f / n; wind = seg(p, 0, .32); slash = seg(p, .40, .52); rec = seg(p, .68, 1.0)
    hr = vl(WR, V(-0.14, -0.02, 0.80), wind); hr = vl(hr, V(-0.14, -0.28, 0.40), slash); hr = vl(hr, WR, rec)
    rot = lerp(WR0, -25, wind); rot = lerp(rot, 135, slash); rot = lerp(rot, WR0, rec)
    hl = vl(WL, V(0.20, -0.04, 0.60), wind); hl = vl(hl, V(0.16, -0.18, 0.36), slash); hl = vl(hl, WL, rec)
    lean = lerp(lerp(-16 * wind, 26, slash), 0, rec)
    return dict(hand_R=hr, hand_L=hl, rot_R=(rot, 0, 0), chest_rot=(lean, 0, 4 * slash), head_rot=(lerp(-6 * wind, 10, slash) * (1 - rec), 0, 0),
                hips_off=(0, -0.05 * slash * (1 - rec), -0.02 * slash * (1 - rec)), foot_R=(0, -0.05 * slash * (1 - rec), 0))
def w_hit(f, n=18):
    k = math.sin(max(0, min(1, f / n)) * math.pi)
    return dict(chest_rot=(-22 * k, 0, 5 * k), head_rot=(-16 * k, 0, -8 * k), hips_off=(0, 0.05 * k, -0.02 * k), hand_L=va(WL, (0.05, 0.03, 0.10 * k)), hand_R=va(WR, (-0.03, 0.05, 0.08 * k)), rot_R=(WR0 - 20 * k, 0, 0))
def w_death(f):
    stag = dict(hand_L=va(WL, (0.05, 0.03, 0.10)), hand_R=va(WR, (-0.03, 0.05, 0.08)), chest_rot=(-15, 0, 5), head_rot=(-12, 0, -8), hips_off=(0, 0.05, -0.02), rot_R=(WR0 - 20, 0, 0))
    if f <= 5:
        k = f / 5; return dict(hand_L=vl(WL, stag['hand_L'], k), hand_R=vl(WR, stag['hand_R'], k), chest_rot=vl((0, 0, 0), stag['chest_rot'], k), head_rot=vl((0, 0, 0), stag['head_rot'], k),
                               hips_off=vl((0, 0, 0), stag['hips_off'], k), rot_R=(lerp(WR0, WR0 - 20, k), 0, 0))
    t = min(1.0, (f - 5) / 22); e = t * t * (3 - 2 * t); d = dict(stag)
    d['root_rot'] = (-88 * e, 0, 0); d['root_off'] = (0, 0.03 * e, 0.17 * e); d['hips_off'] = vl(stag['hips_off'], (0, 0.02, 0), e)
    d['chest_rot'] = vl(stag['chest_rot'], (0, 0, 0), e); d['head_rot'] = vl(stag['head_rot'], (-8, 0, 12), e)
    d['hand_L'] = vl(stag['hand_L'], V(0.30, 0.06, 0.28), e); d['hand_R'] = vl(stag['hand_R'], V(-0.30, 0.06, 0.28), e); d['rot_R'] = (lerp(WR0 - 20, 100, e), 0, 0)
    d['foot_L'] = vl((0, 0, 0), (0.03, 0.02, 0.03), e); d['foot_R'] = vl((0, 0, 0), (-0.03, 0.05, 0.02), e)
    if f > 27: s_ = min(1.0, (f - 27) / 6); d['root_off'] = va(d['root_off'], (0, 0, 0.012 * math.sin(s_ * math.pi) * (1 - s_)))
    return d
def w_spawn(f): return w_death(DEATH_LEN - f)
def w_trip(f, n=80):   # catches a toe, pitches forward with flailing arms, wobbles, pops back up and pretends nothing happened
    p = f / n; step = seg(p, .08, .22) * (1 - seg(p, .22, .34)); fall = seg(p, .20, .44) * (1 - seg(p, .56, .78)); fl = math.sin(p * 2 * math.pi * 5) * fall
    hop = math.sin(seg(p, .74, .88) * math.pi) * 0.03
    return dict(root_rot=(34 * fall, 0, 0), root_off=(0, -0.04 * fall, 0.02 * fall + hop), foot_R=(0, -0.10 * step, 0.09 * step), foot_L=(0, 0.03 * fall, 0.03 * fall),
                hand_L=vl(WL, V(0.34, -0.30 + 0.06 * fl, 0.62 + 0.08 * fl), fall), hand_R=vl(WR, V(-0.34, -0.30 - 0.06 * fl, 0.62 - 0.08 * fl), fall), rot_R=(WR0 + 60 * fall * (1 + 0.4 * fl), 0, 0),
                head_rot=(-30 * fall + 6 * seg(p, .84, .92) * (1 - seg(p, .94, 1.0)), 0, 8 * fl), chest_rot=(-14 * fall, 0, 6 * fl))
def w_bonk(f, n=75):   # swings the sword up to look at it, whacks his own helmet with the pommel, sees stars
    p = f / n; up = seg(p, .06, .26) * (1 - seg(p, .74, .92)); hit = seg(p, .28, .34) * (1 - seg(p, .34, .46)); wob = math.sin(p * 2 * math.pi * 4) * seg(p, .34, .42) * (1 - seg(p, .70, .92))
    return dict(hand_R=vl(WR, V(-0.12, -0.10, 0.70 - 0.05 * hit), up), rot_R=(lerp(WR0, 170, up), 0, 0), hand_L=vl(WL, V(0.13, -0.15, 0.30), up),
                head_rot=(-6 * up + 22 * hit, 0, 10 * wob), chest_rot=(-3 * up + 6 * hit, 0, 4 * wob), hips_off=(0, 0, -0.03 * hit))
def w_wobble(f, n=90):   # balances on one leg, windmilling the arms
    p = f / n; up = seg(p, .05, .25) * (1 - seg(p, .8, 1.0)); w = p * 2 * math.pi * 4
    return dict(foot_R=(0, 0.02 * up, 0.10 * up), hips_off=(0.02 * math.sin(w) * up, 0, -0.01 * up), hips_rot=(0, 0, 6 * math.sin(w) * up), chest_rot=(0, 0, -10 * math.sin(w) * up),
                hand_L=vl(WL, V(0.34, -0.06, 0.48 + 0.14 * math.sin(w)), up), hand_R=vl(WR, V(-0.34, -0.06, 0.48 - 0.14 * math.sin(w)), up), rot_R=(lerp(WR0, 20 + 30 * math.sin(w), up), 0, 0),
                head_rot=(0, 0, 6 * math.sin(w + 1) * up))
def w_wave(f, n=64):   # shy little wave with a head tilt
    p = f / n; up = seg(p, .08, .26) * (1 - seg(p, .80, 1.0)); w = math.sin(p * 2 * math.pi * 4)
    return dict(hand_L=vl(WL, V(0.26 + 0.05 * w, -0.05, 0.74), up), hand_R=WR, rot_R=(WR0 - 10 * up, 0, 0), head_rot=(-6 * up, 0, -14 * up), chest_rot=(0, 0, 4 * up), hips_rot=(0, 0, 4 * math.sin(p * 2 * math.pi * 2) * up))
def w_cheer(f, n=60):   # sword high, little hops
    p = f / n; up = seg(p, 0, .2) * (1 - seg(p, .85, 1.0)); pump = max(0, math.sin(p * 2 * math.pi * 3)) * up
    return dict(chest_rot=(-12 * up, 0, 0), head_rot=(-10 * up, 0, 0), hips_off=(0, 0, 0.035 * pump), hand_R=vl(WR, V(-0.22, -0.06, 0.86 + 0.03 * pump), up), rot_R=(lerp(WR0, -8, up), 0, 0),
                hand_L=vl(WL, V(0.24, -0.04, 0.80 + 0.03 * pump), up), foot_L=(0, 0, 0.03 * pump), foot_R=(0, 0, 0.03 * pump))
# ---- Goblin: sneaky, mischievous kill-stealer. Twin daggers (rot_L / rot_R: degrees about X, 0 = blade straight up, + = tip forward/down).
GBL, GBR = V(0.20, -0.17, 0.30), V(-0.20, -0.17, 0.30)   # crouched guard, daggers low and forward
GR0 = 70
def g_idle(f, n=64):
    w = 2 * math.pi * f / n; br = math.sin(w)
    return dict(hips_off=(0, 0, -0.035 + 0.006 * br), chest_rot=(9 + 1.5 * br, 0, 2 * math.sin(w * 0.5)), head_rot=(-6, 0, 16 * math.sin(w * 0.5)),
                hand_L=va(GBL, (0, 0.01 * math.sin(w - 0.4), 0.008 * br)), hand_R=va(GBR, (0, 0.01 * math.sin(w - 0.9), 0.008 * math.sin(w - 0.6))), rot_L=(GR0 + 4 * br, 0, 0), rot_R=(GR0 - 4 * br, 0, 0))
def g_walk(f, n=28, stride=0.07, lift=0.04, bob=0.012, lean=10, arm=0.04, run=False):
    w = 2 * math.pi * f / n
    foot = lambda ph: (0, -stride * math.sin(w + ph), lift * max(0, math.cos(w + ph)))
    return dict(hips_off=(0.006 * math.sin(w), -0.01 if run else 0, -0.035 + bob * math.cos(2 * w) - (0.02 if run else 0)), hips_rot=(lean, 0, 5 * math.sin(w)), chest_rot=(lean * 0.6, 0, -6 * math.sin(w)),
                head_rot=(-lean * 0.7, 0, 3 * math.sin(w)), foot_L=foot(0), foot_R=foot(math.pi),
                hand_L=va(GBL, (0, arm * math.sin(w), 0.015 * math.cos(2 * w))), hand_R=va(GBR, (0, -arm * math.sin(w), 0.015 * math.cos(2 * w))), rot_L=(GR0 + 5 * math.sin(w), 0, 0), rot_R=(GR0 - 5 * math.sin(w), 0, 0))
def g_run(f, n=18):
    d = g_walk(f, n, stride=0.12, lift=0.075, bob=0.018, lean=20, arm=0.08, run=True); w = 2 * math.pi * f / n
    d['hand_L'] = V(0.19, 0.02 - 0.08 * math.sin(w), 0.30); d['hand_R'] = V(-0.19, 0.02 + 0.08 * math.sin(w), 0.30); d['rot_L'] = (-15, 0, 0); d['rot_R'] = (-15, 0, 0); return d
def g_attack(f, n=30):   # both daggers cocked back, then a crossing double slash
    p = f / n; wind = seg(p, 0, .30); slash = seg(p, .38, .52); rec = seg(p, .70, 1.0)
    hr = vl(GBR, V(-0.26, 0.04, 0.50), wind); hr = vl(hr, V(0.06, -0.30, 0.30), slash); hr = vl(hr, GBR, rec)
    hl = vl(GBL, V(0.26, 0.04, 0.50), wind); hl = vl(hl, V(-0.06, -0.30, 0.30), slash); hl = vl(hl, GBL, rec)
    rot = lerp(GR0, -30, wind); rot = lerp(rot, 130, slash); rot = lerp(rot, GR0, rec)
    lean = lerp(lerp(-8 * wind, 30, slash), 0, rec) + 9 * (1 - rec)
    return dict(hand_R=hr, hand_L=hl, rot_R=(rot, 0, 0), rot_L=(rot, 0, 0), chest_rot=(lean, 0, 8 * slash * (1 - rec)), head_rot=(lerp(-4 * wind, 8, slash) * (1 - rec) - 4, 0, 0),
                hips_off=(0, -0.06 * slash * (1 - rec), -0.035 - 0.02 * slash * (1 - rec)), foot_R=(0, -0.06 * slash * (1 - rec), 0), foot_L=(0, 0.03 * slash * (1 - rec), 0))
def g_hit(f, n=18):
    k = math.sin(max(0, min(1, f / n)) * math.pi)
    return dict(chest_rot=(9 - 24 * k, 0, 6 * k), head_rot=(-6 - 14 * k, 0, -8 * k), hips_off=(0, 0.05 * k, -0.035 - 0.02 * k), hand_L=va(GBL, (0.04, 0.05, 0.10 * k)), hand_R=va(GBR, (-0.04, 0.05, 0.10 * k)), rot_L=(GR0 - 30 * k, 0, 0), rot_R=(GR0 - 30 * k, 0, 0))
def g_death(f):
    st = dict(hand_L=va(GBL, (0.04, 0.05, 0.10)), hand_R=va(GBR, (-0.04, 0.05, 0.10)), chest_rot=(-15, 0, 5), head_rot=(-20, 0, -8), hips_off=(0, 0.05, -0.05), rot_L=(GR0 - 30, 0, 0), rot_R=(GR0 - 30, 0, 0))
    if f <= 5:
        k = f / 5; return dict(hand_L=vl(GBL, st['hand_L'], k), hand_R=vl(GBR, st['hand_R'], k), chest_rot=vl((9, 0, 0), st['chest_rot'], k), head_rot=vl((-6, 0, 0), st['head_rot'], k),
                               hips_off=vl((0, 0, -0.035), st['hips_off'], k), rot_L=(lerp(GR0, GR0 - 30, k), 0, 0), rot_R=(lerp(GR0, GR0 - 30, k), 0, 0))
    t = min(1.0, (f - 5) / 22); e = t * t * (3 - 2 * t); d = dict(st)
    d['root_rot'] = (-88 * e, 0, 0); d['root_off'] = (0, 0.03 * e, 0.17 * e); d['hips_off'] = vl(st['hips_off'], (0, 0.02, 0), e)
    d['chest_rot'] = vl(st['chest_rot'], (0, 0, 0), e); d['head_rot'] = vl(st['head_rot'], (-8, 0, 12), e)
    d['hand_L'] = vl(st['hand_L'], V(0.30, 0.06, 0.24), e); d['hand_R'] = vl(st['hand_R'], V(-0.30, 0.06, 0.24), e); d['rot_L'] = (lerp(GR0 - 30, 100, e), 0, 0); d['rot_R'] = (lerp(GR0 - 30, 100, e), 0, 0)
    d['foot_L'] = vl((0, 0, 0), (0.03, 0.02, 0.03), e); d['foot_R'] = vl((0, 0, 0), (-0.03, 0.05, 0.02), e)
    if f > 27: s_ = min(1.0, (f - 27) / 6); d['root_off'] = va(d['root_off'], (0, 0, 0.012 * math.sin(s_ * math.pi) * (1 - s_)))
    return d
def g_spawn(f): return g_death(DEATH_LEN - f)
def g_scheme(f, n=80):   # rubs his hands together, chuckling, eyes shifting
    p = f / n; up = seg(p, .08, .22) * (1 - seg(p, .84, 1.0)); w = math.sin(p * 2 * math.pi * 5) * up
    return dict(hand_L=vl(GBL, V(0.05 + 0.02 * w, -0.20, 0.40), up), hand_R=vl(GBR, V(-0.05 - 0.02 * w, -0.20, 0.40 + 0.02 * w), up), rot_L=(lerp(GR0, 20, up), 0, 0), rot_R=(lerp(GR0, 20, up), 0, 0),
                chest_rot=(9 + 6 * up, 0, 0), head_rot=(-6 - 10 * up, 0, 10 * math.sin(p * 2 * math.pi * 1.5) * up), hips_off=(0, 0, -0.035 + 0.008 * abs(w)))
def g_peek(f, n=90):   # creeps a step and looks left, then right, then behind him
    p = f / n; up = seg(p, .05, .15) * (1 - seg(p, .88, 1.0)); l = seg(p, .18, .30) - seg(p, .40, .48); r = seg(p, .50, .60) - seg(p, .74, .82)
    return dict(hips_off=(0, 0, -0.05 * up), hips_rot=(4 * up, 0, 10 * (r - l)), chest_rot=(9 + 6 * up, 0, 14 * (r - l)), head_rot=(-6, 0, 40 * (r - l) * -1 + 0),
                foot_L=(0, -0.05 * seg(p, .08, .2) * (1 - seg(p, .2, .4)), 0.03 * math.sin(seg(p, .08, .3) * math.pi)), hand_L=va(GBL, (0, 0, 0)), hand_R=va(GBR, (0, 0, 0)), rot_L=(GR0, 0, 0), rot_R=(GR0, 0, 0))
def g_spin(f, n=70):   # twirls a dagger on his fingers
    p = f / n; up = seg(p, .05, .16) * (1 - seg(p, .90, 1.0)); spin = seg(p, .18, .68)
    return dict(hand_R=vl(GBR, V(-0.16, -0.24, 0.42), up), rot_R=(lerp(GR0, 0, up) + 720 * spin, 0, 0), hand_L=va(GBL, (0, 0, 0)), rot_L=(GR0, 0, 0),
                chest_rot=(9 - 4 * up, 0, -6 * math.sin(spin * math.pi) * up), head_rot=(-6 + 6 * up, 0, 8 * up), hips_off=(0, 0, -0.035 + 0.012 * math.sin(spin * math.pi * 2)))
def g_snicker(f, n=60):   # covers his grin with a fist and shakes with laughter
    p = f / n; up = seg(p, .06, .18) * (1 - seg(p, .84, 1.0)); sh = math.sin(p * 2 * math.pi * 7) * up
    return dict(hand_L=vl(GBL, V(0.06, -0.20, 0.52), up), hand_R=va(GBR, (0, 0, 0)), rot_L=(lerp(GR0, 200, up), 0, 0), rot_R=(GR0, 0, 0),
                chest_rot=(9 - 6 * up + 3 * sh, 0, 0), head_rot=(-6 - 10 * up + 3 * sh, 0, 6 * up), hips_off=(0, 0, -0.035 + 0.012 * abs(sh)))
def g_cheer(f, n=60):   # "mine!": both daggers up, gleeful hop
    p = f / n; up = seg(p, 0, .18) * (1 - seg(p, .85, 1.0)); pump = max(0, math.sin(p * 2 * math.pi * 3)) * up
    return dict(chest_rot=(9 - 22 * up, 0, 0), head_rot=(-6 - 6 * up, 0, 0), hips_off=(0, 0, -0.035 + 0.05 * pump - 0.01 * up), hand_L=vl(GBL, V(0.24, -0.06, 0.78 + 0.03 * pump), up), hand_R=vl(GBR, V(-0.24, -0.06, 0.78 + 0.03 * pump), up),
                rot_L=(lerp(GR0, -10, up), 0, 0), rot_R=(lerp(GR0, -10, up), 0, 0), foot_L=(0, 0, 0.04 * pump), foot_R=(0, 0, 0.04 * pump))
# ---- Knight: proud, disciplined, a little vain. Sword in the right hand (rot_R: 0 = blade up, + = tip forward/down); shield rides the left hand.
KY = -0.15   # this model's body sits 15 cm behind the centre of its bounding box (the plume sticks out backwards)
KL, KR = V(0.25, KY - 0.15, 0.32), V(-0.19, KY - 0.16, 0.34)
KR0 = 28
def k_idle(f, n=72):
    w = 2 * math.pi * f / n; br = math.sin(w)
    return dict(hips_off=(0, 0, 0.005 * br), chest_rot=(-3 + 1.2 * br, 0, 1.0 * math.sin(w * 0.5)), head_rot=(-1.0 * math.sin(w - 1.0), 0, 2.0 * math.sin(w * 0.5)),
                hand_L=va(KL, (0, 0, 0.005 * math.sin(w - 0.4))), hand_R=va(KR, (0, 0, 0.005 * math.sin(w - 0.8))), rot_R=(KR0 + 2 * br, 0, 0))
def k_walk(f, n=36, stride=0.055, lift=0.03, bob=0.010, lean=2, arm=0.02, run=False):
    w = 2 * math.pi * f / n
    foot = lambda ph: (0, -stride * math.sin(w + ph), lift * max(0, math.cos(w + ph)))
    return dict(hips_off=(0.008 * math.sin(w), -0.006 if run else 0, bob * math.cos(2 * w) - (0.015 if run else 0)), hips_rot=(lean, 0, 4 * math.sin(w)), chest_rot=(lean * 0.5 - 3, 0, -5 * math.sin(w)),
                head_rot=(-lean * 0.6, 0, 1.5 * math.sin(w)), foot_L=foot(0), foot_R=foot(math.pi),
                hand_L=va(KL, (0, arm * math.sin(w), 0.01 * math.cos(2 * w))), hand_R=va(KR, (0, -arm * math.sin(w), 0.01 * math.cos(2 * w))), rot_R=(KR0 + 5 * math.sin(w), 0, 0))
def k_run(f, n=22):
    d = k_walk(f, n, stride=0.09, lift=0.05, bob=0.015, lean=8, arm=0.05, run=True); w = 2 * math.pi * f / n
    d['hand_L'] = V(0.24, KY - 0.18, 0.36 + 0.02 * math.sin(w)); d['hand_R'] = V(-0.19, KY - 0.14 - 0.05 * math.sin(w), 0.36); d['rot_R'] = (KR0 + 20, 0, 0); return d
def k_attack(f, n=40):   # sword raised high, a heavy overhead chop, shield thrust forward
    p = f / n; wind = seg(p, 0, .34); chop = seg(p, .44, .56); rec = seg(p, .70, 1.0)
    hr = vl(KR, V(-0.17, KY - 0.02, 0.80), wind); hr = vl(hr, V(-0.15, KY - 0.30, 0.34), chop); hr = vl(hr, KR, rec)
    rot = lerp(KR0, -25, wind); rot = lerp(rot, 135, chop); rot = lerp(rot, KR0, rec)
    hl = vl(KL, V(0.26, KY - 0.10, 0.36), wind); hl = vl(hl, V(0.22, KY - 0.24, 0.36), chop); hl = vl(hl, KL, rec)
    lean = lerp(lerp(-16 * wind, 26, chop), -3, rec)
    return dict(hand_R=hr, hand_L=hl, rot_R=(rot, 0, 0), chest_rot=(lean, 0, 4 * chop), head_rot=(lerp(-8 * wind, 12, chop) * (1 - rec), 0, 0),
                hips_off=(0, -0.05 * chop * (1 - rec), -0.02 * chop * (1 - rec)), foot_R=(0, -0.05 * chop * (1 - rec), 0))
def k_hit(f, n=18):
    k = math.sin(max(0, min(1, f / n)) * math.pi)
    return dict(chest_rot=(-3 - 16 * k, 0, 4 * k), head_rot=(-10 * k, 0, -6 * k), hips_off=(0, 0.04 * k, -0.015 * k), hand_L=va(KL, (0.04, 0.05, 0.06 * k)), hand_R=va(KR, (-0.02, 0.04, 0.06 * k)), rot_R=(KR0 - 15 * k, 0, 0))
def k_death(f):
    st = dict(hand_L=va(KL, (0.04, 0.05, 0.06)), hand_R=va(KR, (-0.02, 0.04, 0.06)), chest_rot=(-19, 0, 4), head_rot=(-10, 0, -6), hips_off=(0, 0.04, -0.015), rot_R=(KR0 - 15, 0, 0))
    if f <= 5:
        k = f / 5; return dict(hand_L=vl(KL, st['hand_L'], k), hand_R=vl(KR, st['hand_R'], k), chest_rot=vl((-3, 0, 0), st['chest_rot'], k), head_rot=vl((0, 0, 0), st['head_rot'], k),
                               hips_off=vl((0, 0, 0), st['hips_off'], k), rot_R=(lerp(KR0, KR0 - 15, k), 0, 0))
    t = min(1.0, (f - 5) / 22); e = t * t * (3 - 2 * t); d = dict(st)
    d['root_rot'] = (-88 * e, 0, 0); d['root_off'] = (0, 0.03 * e, 0.16 * e); d['hips_off'] = vl(st['hips_off'], (0, 0.02, 0), e)
    d['chest_rot'] = vl(st['chest_rot'], (0, 0, 0), e); d['head_rot'] = vl(st['head_rot'], (-8, 0, 12), e)
    d['hand_L'] = vl(st['hand_L'], V(0.34, KY + 0.06, 0.26), e); d['hand_R'] = vl(st['hand_R'], V(-0.34, KY + 0.06, 0.26), e); d['rot_R'] = (lerp(KR0 - 15, 100, e), 0, 0)
    d['foot_L'] = vl((0, 0, 0), (0.03, 0.02, 0.03), e); d['foot_R'] = vl((0, 0, 0), (-0.03, 0.05, 0.02), e)
    if f > 27: s_ = min(1.0, (f - 27) / 6); d['root_off'] = va(d['root_off'], (0, 0, 0.012 * math.sin(s_ * math.pi) * (1 - s_)))
    return d
def k_spawn(f): return k_death(DEATH_LEN - f)
def k_salute(f, n=70):   # snaps the sword up in front of his visor, holds, lowers
    p = f / n; up = seg(p, .08, .26) * (1 - seg(p, .72, .92))
    return dict(hand_R=vl(KR, V(-0.07, KY - 0.24, 0.66), up), rot_R=(lerp(KR0, -8, up), 0, 0), hand_L=va(KL, (0, 0, 0)), chest_rot=(-3 - 8 * up, 0, 0), head_rot=(-5 * up, 0, 0), hips_off=(0, 0, 0.004 * up))
def k_boast(f, n=80):   # thumps his chest plate with the shield fist twice, sword held out
    p = f / n; up = seg(p, .06, .18) * (1 - seg(p, .86, 1.0)); th = max(0, math.sin(p * 2 * math.pi * 2.5)) * up
    return dict(hand_L=vl(KL, V(0.05, KY - 0.20 - 0.03 * th, 0.40), up), hand_R=vl(KR, V(-0.22, KY - 0.24, 0.42), up), rot_R=(lerp(KR0, 60, up), 0, 0),
                chest_rot=(-3 - 10 * up + 4 * th, 0, 0), head_rot=(-8 * up, 0, 0), hips_off=(0, 0, -0.006 * th))
def k_admire(f, n=84):   # lifts the shield like a mirror and admires his reflection
    p = f / n; up = seg(p, .06, .24) * (1 - seg(p, .80, .96)); tilt = math.sin(p * 2 * math.pi * 2) * up
    return dict(hand_L=vl(KL, V(0.10, KY - 0.30, 0.56), up), rot_L=(lerp(0, -20, up), 0, 0), hand_R=va(KR, (0, 0, 0)), rot_R=(KR0, 0, 0),
                chest_rot=(-3 - 4 * up, 0, 0), head_rot=(-8 * up, 0, 8 * tilt), hips_off=(0, 0, 0.004 * up))
def k_pose(f, n=70):   # hero pose: sword pointed at the sky, shield out, chest proud
    p = f / n; up = seg(p, 0, .2) * (1 - seg(p, .86, 1.0)); pump = max(0, math.sin(p * 2 * math.pi * 2)) * up
    return dict(chest_rot=(-3 - 12 * up, 0, 0), head_rot=(-10 * up, 0, 0), hips_off=(0, 0, 0.02 * pump), hand_R=vl(KR, V(-0.20, KY - 0.06, 0.86 + 0.02 * pump), up), rot_R=(lerp(KR0, -5, up), 0, 0),
                hand_L=vl(KL, V(0.30, KY - 0.14, 0.44), up), rot_L=(lerp(0, 10, up), 0, 0))
# ---- Barbarian: a berserker with a huge two-handed axe. The axe is held by the right hand (rot_R: 0 = head straight up, + = head forward/down);
# the left hand is put ON THE HAFT by LH(), so both hands follow every swing without a second weapon socket.
BY = -0.07   # this model's body sits 7 cm behind the centre of its bounding box (the hair sticks out backwards)
BR = V(-0.05, BY - 0.12, 0.30)
BR0 = -35   # axe carried back over the shoulder
def LH(hr, rot, s=0.17):
    r = math.radians(rot); return (hr[0], hr[1] - s * math.sin(r), hr[2] + s * math.cos(r))
def b_idle(f, n=72):
    w = 2 * math.pi * f / n; br = math.sin(w); hr = va(BR, (0, 0, 0.006 * math.sin(w - 0.8))); rot = BR0 + 2 * br
    return dict(hips_off=(0, 0, -0.02 + 0.006 * br), chest_rot=(6 + 2 * br, 0, 2 * math.sin(w * 0.5)), head_rot=(-4, 0, 3 * math.sin(w * 0.5)), hand_R=hr, rot_R=(rot, 0, 0), hand_L=LH(hr, rot))
def b_walk(f, n=32, stride=0.065, lift=0.04, bob=0.014, lean=5, run=False):
    w = 2 * math.pi * f / n
    foot = lambda ph: (0, -stride * math.sin(w + ph), lift * max(0, math.cos(w + ph)))
    hr = va(BR, (0, 0.03 * math.sin(w), 0.012 * math.cos(2 * w))); rot = BR0 + 6 * math.sin(w) - (25 if run else 0)
    return dict(hips_off=(0.01 * math.sin(w), -0.008 if run else 0, -0.02 + bob * math.cos(2 * w) - (0.02 if run else 0)), hips_rot=(lean, 0, 5 * math.sin(w)), chest_rot=(lean + 3, 0, -6 * math.sin(w)),
                head_rot=(-4 - lean * 0.5, 0, 2 * math.sin(w)), foot_L=foot(0), foot_R=foot(math.pi), hand_R=hr, rot_R=(rot, 0, 0), hand_L=LH(hr, rot))
def b_run(f, n=20):
    return b_walk(f, n, stride=0.115, lift=0.075, bob=0.02, lean=13, run=True)
def b_attack(f, n=32):   # axe hauled back over the shoulder, then a furious overhead cleave
    p = f / n; wind = seg(p, 0, .32); chop = seg(p, .42, .54); rec = seg(p, .72, 1.0)
    hr = vl(BR, V(-0.12, BY - 0.01, 0.72), wind); hr = vl(hr, V(-0.10, BY - 0.31, 0.32), chop); hr = vl(hr, BR, rec)
    rot = lerp(BR0, -40, wind); rot = lerp(rot, 140, chop); rot = lerp(rot, BR0, rec)
    lean = lerp(lerp(-18 * wind, 34, chop), 6, rec)
    return dict(hand_R=hr, rot_R=(rot, 0, 0), hand_L=LH(hr, rot), chest_rot=(lean, 0, 5 * chop * (1 - rec)), head_rot=(lerp(-10 * wind, 14, chop) * (1 - rec) - 4, 0, 0),
                hips_off=(0, -0.06 * chop * (1 - rec), -0.02 - 0.03 * chop * (1 - rec)), foot_R=(0, -0.06 * chop * (1 - rec), 0), foot_L=(0, 0.03 * chop * (1 - rec), 0))
def b_hit(f, n=18):
    k = math.sin(max(0, min(1, f / n)) * math.pi); hr = va(BR, (0.02, 0.05, 0.05 * k)); rot = BR0 - 18 * k
    return dict(chest_rot=(6 - 22 * k, 0, 5 * k), head_rot=(-4 - 14 * k, 0, -7 * k), hips_off=(0, 0.05 * k, -0.02 - 0.02 * k), hand_R=hr, rot_R=(rot, 0, 0), hand_L=LH(hr, rot))
def b_death(f):
    hr0 = va(BR, (0.02, 0.05, 0.05)); r0 = BR0 - 18
    st = dict(chest_rot=(-16, 0, 5), head_rot=(-16, 0, -8), hips_off=(0, 0.05, -0.04), hand_R=hr0, rot_R=(r0, 0, 0), hand_L=LH(hr0, r0))
    if f <= 5:
        k = f / 5; return dict(chest_rot=vl((6, 0, 0), st['chest_rot'], k), head_rot=vl((-4, 0, 0), st['head_rot'], k), hips_off=vl((0, 0, -0.02), st['hips_off'], k),
                               hand_R=vl(BR, hr0, k), rot_R=(lerp(BR0, r0, k), 0, 0), hand_L=vl(LH(BR, BR0), st['hand_L'], k))
    t = min(1.0, (f - 5) / 22); e = t * t * (3 - 2 * t); d = dict(st)
    d['root_rot'] = (-88 * e, 0, 0); d['root_off'] = (0, 0.03 * e, 0.17 * e); d['hips_off'] = vl(st['hips_off'], (0, 0.02, 0), e)
    d['chest_rot'] = vl(st['chest_rot'], (0, 0, 0), e); d['head_rot'] = vl(st['head_rot'], (-8, 0, 12), e)
    d['hand_R'] = vl(hr0, V(-0.38, BY + 0.06, 0.28), e); d['rot_R'] = (lerp(r0, 100, e), 0, 0); d['hand_L'] = vl(st['hand_L'], V(0.38, BY + 0.06, 0.28), e)
    d['foot_L'] = vl((0, 0, 0), (0.03, 0.02, 0.03), e); d['foot_R'] = vl((0, 0, 0), (-0.03, 0.05, 0.02), e)
    if f > 27: s_ = min(1.0, (f - 27) / 6); d['root_off'] = va(d['root_off'], (0, 0, 0.012 * math.sin(s_ * math.pi) * (1 - s_)))
    return d
def b_spawn(f): return b_death(DEATH_LEN - f)
def b_roar(f, n=84):   # axe up, head thrown back, bellowing and shaking
    p = f / n; up = seg(p, .10, .30) * (1 - seg(p, .82, 1.0)); sh = math.sin(p * 2 * math.pi * 9) * up
    hr = vl(BR, V(-0.11, BY - 0.06, 0.84), up); rot = lerp(BR0, -5, up)
    return dict(hand_R=hr, rot_R=(rot, 0, 0), hand_L=LH(hr, rot), chest_rot=(6 - 28 * up + 2 * sh, 0, 0), head_rot=(-4 - 26 * up + 3 * sh, 0, 2 * sh), hips_off=(0, 0, -0.02 + 0.012 * abs(sh)))
def b_chest(f, n=90):   # axe hangs from one hand while the free fist pounds his chest
    p = f / n; up = seg(p, .06, .18) * (1 - seg(p, .86, 1.0)); beat = max(0, math.sin(p * 2 * math.pi * 3.5)) * up
    hr = vl(BR, V(-0.24, BY - 0.04, 0.30), up); rot = lerp(BR0, 100, up); hl0 = LH(BR, BR0)
    return dict(hand_R=hr, rot_R=(rot, 0, 0), hand_L=vl(hl0, V(0.06, BY - 0.22 + 0.03 * beat, 0.42), up), chest_rot=(6 - 12 * up + 5 * beat, 0, 0), head_rot=(-4 - 12 * up, 0, 0), hips_off=(0, 0, -0.02 - 0.008 * beat))
def b_stomp(f, n=72):   # tantrum: stamps each foot, shaking the axe
    p = f / n; up = seg(p, .05, .15) * (1 - seg(p, .88, 1.0)); w = p * 2 * math.pi * 3; sl = max(0, math.sin(w)); sr = max(0, -math.sin(w))
    hr = va(BR, (0.02 * math.sin(w * 2) * up, 0, 0.03 * (sl + sr) * up)); rot = BR0 + 14 * math.sin(w * 2) * up
    return dict(foot_L=(0, 0, 0.09 * sl * up), foot_R=(0, 0, 0.09 * sr * up), hips_off=(0, 0, -0.02 - 0.02 * (1 - sl) * (1 - sr) * up), hips_rot=(0, 0, 5 * math.sin(w) * up), chest_rot=(6 + 5 * up, 0, -6 * math.sin(w) * up),
                head_rot=(-4 + 6 * up, 0, 6 * math.sin(w * 2) * up), hand_R=hr, rot_R=(rot, 0, 0), hand_L=LH(hr, rot))
def b_cheer(f, n=64):   # axe overhead, victory hops
    p = f / n; up = seg(p, 0, .18) * (1 - seg(p, .86, 1.0)); pump = max(0, math.sin(p * 2 * math.pi * 3)) * up
    hr = vl(BR, V(-0.13, BY - 0.05, 0.90 + 0.03 * pump), up); rot = lerp(BR0, -8, up)
    return dict(hand_R=hr, rot_R=(rot, 0, 0), hand_L=LH(hr, rot), chest_rot=(6 - 20 * up, 0, 0), head_rot=(-4 - 16 * up, 0, 0), hips_off=(0, 0, -0.02 + 0.05 * pump), foot_L=(0, 0, 0.04 * pump), foot_R=(0, 0, 0.04 * pump))
def o_scratch(f, n=90):   # lazily scratches his belly, mace dangling, then gives it an approving pat
    p = f / n; up = seg(p, .08, .22) * (1 - seg(p, .82, .95)); rub = math.sin(p * 2 * math.pi * 4) * up
    return dict(hand_L=vl(va(RL, (0, -0.02, 0)), V(0.09 + 0.03 * rub, -0.22, 0.30 + 0.02 * rub), up), hand_R=va(RR, (0.02, -0.06, 0)), rot_R=(ROT0 + 6 * up, 0, 0), chest_rot=(6 * up, 0, 0), head_rot=(-12 * up, 0, 5 * math.sin(p * 2 * math.pi) * up), hips_off=(0, 0, 0.004 * rub))
def o_stomp(f, n=70):   # hulking tantrum: two heavy stomps that shake the whole body
    p = f / n; up = seg(p, .05, .16) * (1 - seg(p, .86, 1.0)); w = p * 2 * math.pi * 2; sl = max(0, math.sin(w)); sr = max(0, -math.sin(w))
    return dict(foot_L=(0, 0, 0.11 * sl * up), foot_R=(0, 0, 0.11 * sr * up), hips_off=(0, 0, -0.03 * (1 - sl) * (1 - sr) * up), hips_rot=(0, 0, 5 * math.sin(w) * up), chest_rot=(8 * up, 0, -5 * math.sin(w) * up),
                head_rot=(-6 * up, 0, 3 * math.sin(w) * up), hand_L=va(RL, (0, -0.02, 0.04 * (sl + sr) * up)), hand_R=va(RR, (0.02, -0.06, 0.04 * (sl + sr) * up)), rot_R=(ROT0 - 12 * up * (sl + sr), 0, 0))
def o_thump(f, n=80):   # pounds his chest with the free fist and bellows
    p = f / n; up = seg(p, .08, .20) * (1 - seg(p, .84, 1.0)); th = max(0, math.sin(p * 2 * math.pi * 3)) * up
    return dict(hand_L=vl(va(RL, (0, -0.02, 0)), V(0.05, -0.25 + 0.03 * th, 0.46), up), hand_R=va(RR, (0.02, -0.06, 0)), rot_R=(ROT0, 0, 0), chest_rot=(-10 * up + 5 * th, 0, 0), head_rot=(-16 * up, 0, 0), hips_off=(0, 0, -0.01 * th))
def k_pray(f, n=100):   # kneels, plants the sword point-down and bows his head over the pommel
    p = f / n; dn = seg(p, .08, .30) * (1 - seg(p, .76, .94)); glow = math.sin(p * 2 * math.pi * 2) * dn
    return dict(hips_off=(0, 0, -0.10 * dn), foot_L=(0, -0.05 * dn, 0), foot_R=(0, 0.10 * dn, 0.06 * dn), chest_rot=(-3 + 14 * dn, 0, 0), head_rot=(30 * dn, 0, 0),
                hand_R=vl(KR, V(-0.02, KY - 0.24, 0.40), dn), rot_R=(lerp(KR0, 180, dn), 0, 0), hand_L=vl(KL, V(0.33, KY + 0.02, 0.17), dn), rot_L=(lerp(0, -15, dn), 0, 0))
CLIPSETS = {'ogre': [('Idle', 60, o_idle, True), ('Walk', 36, o_walk, True), ('Run', 24, o_run, True), ('Attack', 40, o_attack, False), ('Hit', 18, o_hit, False),
                     ('Death', DEATH_LEN, o_death, False), ('Spawn', 50, o_spawn, False), ('Yawn', 70, o_yawn, False), ('Cheer', 60, o_cheer, False), ('Scratch', 90, o_scratch, False), ('Stomp', 70, o_stomp, False), ('Thump', 80, o_thump, False)],
            'goblin': [('Idle', 64, g_idle, True), ('Walk', 28, g_walk, True), ('Run', 18, g_run, True), ('Attack', 30, g_attack, False), ('Hit', 18, g_hit, False), ('Death', DEATH_LEN, g_death, False),
                       ('Spawn', DEATH_LEN, g_spawn, False), ('Scheme', 80, g_scheme, False), ('Peek', 90, g_peek, False), ('Spin', 70, g_spin, False), ('Snicker', 60, g_snicker, False), ('Cheer', 60, g_cheer, False)],
            'knight': [('Idle', 72, k_idle, True), ('Walk', 36, k_walk, True), ('Run', 22, k_run, True), ('Attack', 40, k_attack, False), ('Hit', 18, k_hit, False), ('Death', DEATH_LEN, k_death, False),
                       ('Spawn', DEATH_LEN, k_spawn, False), ('Salute', 70, k_salute, False), ('Boast', 80, k_boast, False), ('Admire', 84, k_admire, False), ('Pose', 70, k_pose, False), ('Pray', 100, k_pray, False)],
            'barbarian': [('Idle', 72, b_idle, True), ('Walk', 32, b_walk, True), ('Run', 20, b_run, True), ('Attack', 32, b_attack, False), ('Hit', 18, b_hit, False), ('Death', DEATH_LEN, b_death, False),
                          ('Spawn', DEATH_LEN, b_spawn, False), ('Roar', 84, b_roar, False), ('ChestBeat', 90, b_chest, False), ('Stomp', 72, b_stomp, False), ('Cheer', 64, b_cheer, False)],
            'warrior': [('Idle', 60, w_idle, True), ('Walk', 32, w_walk, True), ('Run', 20, w_run, True), ('Attack', 36, w_attack, False), ('Hit', 18, w_hit, False), ('Death', DEATH_LEN, w_death, False),
                        ('Spawn', DEATH_LEN, w_spawn, False), ('Trip', 80, w_trip, False), ('Bonk', 75, w_bonk, False), ('Wobble', 90, w_wobble, False), ('Wave', 64, w_wave, False), ('Cheer', 60, w_cheer, False)],
            'archer': [('Idle', 60, idle, True), ('Walk', 30, walk, True), ('Run', 20, run, True), ('Shoot', 45, shoot, False), ('Flex', 72, flex, False), ('DoubleBiceps', 90, dbl, False), ('BoneCrack', 80, crack, False), ('BowTwirl', 70, twirl, False),
                       ('Hit', 18, hit, False), ('Death', DEATH_LEN, death, False), ('Spawn', DEATH_LEN, spawn, False)]}
CLIPS = CLIPSETS[CFG.get('clips', 'archer')]

def basis_from_pose(name, mats):
    bn = arm.data.bones[name]
    if bn.parent:
        rel = bn.parent.matrix_local.inverted() @ bn.matrix_local; prel = mats[bn.parent.name].inverted() @ mats[name]; return rel.inverted() @ prel
    return bn.matrix_local.inverted() @ mats[name]

arm.animation_data_create(); baked = {}
for name, n, fn, loop in CLIPS:
    act = bpy.data.actions.new(name + '_src'); arm.animation_data.action = act
    for f in range(0, n + 1):
        apply(fn(f % n if loop else f)); key(f)
    frames = {}
    for f in range(0, n + 1):
        sc.frame_set(f); ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mats = {b: ev.pose.bones[b].matrix.copy() for b in EXPORT_BONES}; frames[f] = {b: basis_from_pose(b, mats) for b in EXPORT_BONES}
    baked[name] = (n, frames, loop); log('sampled', name, n)

arm.animation_data.action = None
for a in list(bpy.data.actions): bpy.data.actions.remove(a)
for p in PB:
    for c in list(p.constraints): p.constraints.remove(c)
    p.location = (0, 0, 0); p.rotation_quaternion = (1, 0, 0, 0); p.scale = (1, 1, 1)
bpy.context.view_layer.update(); bpy.ops.object.mode_set(mode='EDIT')
for n in CTRL + POLES: arm.data.edit_bones.remove(arm.data.edit_bones[n])
bpy.ops.object.mode_set(mode='POSE')
for name, (n, frames, loop) in baked.items():
    act = bpy.data.actions.new(name); act.use_fake_user = True; arm.animation_data.action = act
    for f in range(0, n + 1):
        for b in EXPORT_BONES:
            m = frames[f][b]; pb = PB[b]; pb.location = m.to_translation(); pb.rotation_quaternion = m.to_quaternion()
            pb.keyframe_insert('location', frame=f); pb.keyframe_insert('rotation_quaternion', frame=f)
            if b == 'Nock_Arrow': pb.scale = m.to_scale(); pb.keyframe_insert('scale', frame=f)
    act.use_frame_range = True; act.frame_start, act.frame_end = 0, n; act.use_cyclic = loop
arm.animation_data.action = None
for p in PB: p.location = (0, 0, 0); p.rotation_quaternion = (1, 0, 0, 0); p.scale = (1, 1, 1)
bpy.ops.object.mode_set(mode='OBJECT')
log('actions', [a.name for a in bpy.data.actions])

# ----------------------------------------------------------------------------------------------- 6. export + QA + team texture
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, NAME + '.blend'))
def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
if CFG.get('export', {}).get('glb', True):
    select_only([arm] + skinned)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, NAME + '.glb'), export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_yup=True, export_skins=True, export_apply=False)
    if props.get('free'):
        select_only([props['free']])
        bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, NAME + '_arrow.glb'), export_format='GLB', use_selection=True, export_animations=False, export_yup=True)
    log('exported GLB')
if CFG.get('export', {}).get('fbx'):
    select_only([arm] + skinned)
    bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, NAME + '.fbx'), use_selection=True, object_types={'ARMATURE', 'MESH'}, add_leaf_bones=False, bake_anim=True,
                             bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False, axis_forward='-Z', axis_up='Y', apply_scale_options='FBX_SCALE_ALL', path_mode='COPY', embed_textures=True)

# enemy-eye texture variant: shift the purple pixels (the glowing eyes) to amber; same mesh, different texture at runtime
TT = CFG.get('team_texture')
if TT and body_img:
    w, h = body_img.size; px = np.array(body_img.pixels[:], dtype=np.float32).reshape(h, w, body_img.channels)[:, :, :3]
    r, g, b = px[..., 0], px[..., 1], px[..., 2]; mx = px.max(-1); mn = px.min(-1); d = mx - mn + 1e-9
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6.0; sat = d / (mx + 1e-9)
    mask = (hue >= TT['from_hue'][0]) & (hue <= TT['from_hue'][1]) & (sat > 0.28) & (mx > 0.25)
    EB = TT.get('eye_box')          # optional: only texels that belong to the face's eye area (the painted eyes), not every purple speck in the texture
    if EB:
        me_ = body.data; uvl = me_.uv_layers.active.data; region = np.zeros(mask.shape, dtype=bool); rx, ry = int(0.03 * w), int(0.03 * h)
        for lp in me_.loops:
            co_ = me_.vertices[lp.vertex_index].co
            if EB['z'][0] < co_.z < EB['z'][1] and abs(co_.x) < EB['x'] and co_.y < EB['y_max']:
                u_, v_ = uvl[lp.index].uv; cx_, cy_ = int(u_ * w), int(v_ * h); region[max(0, cy_ - ry):cy_ + ry, max(0, cx_ - rx):cx_ + rx] = True
        mask = mask & region; log('eye box kept', int(mask.sum()), 'texels')
    nh = np.where(mask, TT['to_hue'], hue); c = mx * sat; x = c * (1 - np.abs((nh * 6) % 2 - 1)); m0 = mx - c
    sector = (nh * 6).astype(int) % 6; z = np.zeros_like(c)
    R = np.select([sector == 0, sector == 1, sector == 2, sector == 3, sector == 4, sector == 5], [c, x, z, z, x, c]) + m0
    G = np.select([sector == 0, sector == 1, sector == 2, sector == 3, sector == 4, sector == 5], [x, c, c, x, z, z]) + m0
    Bc = np.select([sector == 0, sector == 1, sector == 2, sector == 3, sector == 4, sector == 5], [z, z, x, c, c, x]) + m0
    out = np.stack([np.where(mask, R, r), np.where(mask, G, g), np.where(mask, Bc, b), np.ones_like(r)], -1)
    img2 = bpy.data.images.new(NAME + '_enemy', w, h, alpha=False); img2.pixels = out.astype(np.float32).ravel().tolist()
    img2.filepath_raw = os.path.join(OUT, NAME + '_enemy.jpg'); img2.file_format = 'JPEG'; img2.save()      # JPEG: a 2048 px PNG is 6 MB
    log('team texture: recoloured', int(mask.sum()), 'pixels ->', NAME + '_enemy.jpg')
    # eye mask (white where the glowing eyes are, same UVs as the colour map): the game drives its glow per state (dim when sleepy, bright when fighting)
    imgE = bpy.data.images.new(NAME + '_eyes', w, h, alpha=False); m3 = np.stack([mask, mask, mask, np.ones_like(mask)], -1).astype(np.float32)
    imgE.pixels = m3.ravel().tolist(); imgE.scale(1024, 1024); imgE.filepath_raw = os.path.join(OUT, NAME + '_eyes.png'); imgE.file_format = 'PNG'; imgE.save()
    log('eye mask ->', NAME + '_eyes.png')

if props.get('free'): props['free'].hide_render = True; props['free'].hide_viewport = True
if CFG.get('export', {}).get('qa_sheets', True):
    sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
    Wd = 360; sc.render.resolution_x = sc.render.resolution_y = Wd; sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.82, 0.82, 0.87)
    cam = bpy.data.objects.new('qa', bpy.data.cameras.new('qa')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.55; cam.location = (-2.4, -3.4, 1.3)
    tgt = bpy.data.objects.new('t', None); tgt.location = (0, 0, 0.5); sc.collection.objects.link(tgt)
    tc = cam.constraints.new('TRACK_TO'); tc.target = tgt; tc.track_axis = 'TRACK_NEGATIVE_Z'; tc.up_axis = 'UP_Y'
    arm.animation_data_create(); rows = []
    for act in bpy.data.actions:
        arm.animation_data.action = act; n = int(act.frame_end); shots = []
        for i in range(6):
            sc.frame_set(round(n * i / 5)); fp = os.path.join(WORK, '_q.png'); sc.render.filepath = fp; bpy.ops.render.render(write_still=True)
            im = bpy.data.images.load(fp); shots.append(np.array(im.pixels[:], dtype=np.float32).reshape(Wd, Wd, 4).copy()); bpy.data.images.remove(im)
        rows.append(np.concatenate(shots, axis=1))
    sheet = np.concatenate(rows, axis=0); hh, ww = sheet.shape[:2]
    im = bpy.data.images.new('sheet', ww, hh, alpha=True); im.pixels = sheet.ravel().tolist(); im.filepath_raw = os.path.join(OUT, NAME + '_qa.png'); im.file_format = 'PNG'; im.save()
    log('QA sheet rows:', [a.name for a in bpy.data.actions])
log('DONE in %.1fs' % (time.time() - T0))
