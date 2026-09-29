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
    bpy.ops.object.mode_set(mode='OBJECT'); bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    log('bone-heat weights on', len(body.vertex_groups), 'groups')
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
    log('islands', nisl, 'rigid', rigid_count, 'blended', nisl - rigid_count)
    for j, n in enumerate(names):
        vg = body.vertex_groups.new(name=n)
        for vi in np.nonzero(W[:, j] > 1e-3)[0]: vg.add([int(vi)], float(W[vi, j]), 'REPLACE')


def rigid_group(o, bone_name):
    vg = o.vertex_groups.new(name=bone_name); vg.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
if props.get('weapon'):
    sc.collection.objects.link(props['weapon']) if props['weapon'].name not in sc.collection.objects else None
    rigid_group(props['weapon'], 'Socket_Weapon')
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
skinned = [body] + [props[k] for k in ('weapon', 'bow', 'arrow', 'string') if props.get(k)]
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
def o_idle(f, n=60):
    w = 2 * math.pi * f / n; br = math.sin(w)
    return dict(hips_off=(0, 0, 0.008 * br), chest_rot=(2.0 * br, 0, 1.2 * math.sin(w * 0.5)), head_rot=(-1.0 * math.sin(w - 1.0), 0, 3 * math.sin(w * 0.5)),
                hand_L=va(RL, (0, -0.02, 0.006 * math.sin(w - 0.4))), hand_R=va(RR, (0.02, -0.06, 0.006 * math.sin(w - 0.8))), rot_R=(-10 + 2 * br, 0, 0))
def o_walk(f, n=36, stride=0.06, lift=0.035, bob=0.014, lean=2, run=False):
    w = 2 * math.pi * f / n
    foot = lambda ph: (0, -stride * math.sin(w + ph), lift * max(0, math.cos(w + ph)))
    return dict(hips_off=(0.012 * math.sin(w), -0.006 if run else 0, bob * math.cos(2 * w) - (0.02 if run else 0)), hips_rot=(lean, 0, 4 * math.sin(w)), chest_rot=(lean * 0.5, 0, -6 * math.sin(w)),
                head_rot=(-lean * 0.6, 0, 2 * math.sin(w)), foot_L=foot(0), foot_R=foot(math.pi),
                hand_L=va(RL, (0, 0.04 * math.sin(w) - 0.02, 0.015 * math.cos(2 * w))), hand_R=va(RR, (0.02, -0.06 - 0.03 * math.sin(w), 0.012 * math.cos(2 * w))), rot_R=(-10 + 6 * math.sin(w), 0, 0))
def o_run(f, n=24):
    d = o_walk(f, n, stride=0.09, lift=0.055, bob=0.02, lean=9, run=True); w = 2 * math.pi * f / n
    d['hand_L'] = va(RL, (-0.02, -0.10 + 0.05 * math.sin(w), 0.04)); d['hand_R'] = va(RR, (0.03, -0.10, 0.05 + 0.02 * math.sin(w))); d['rot_R'] = (15 + 8 * math.sin(w), 0, 0); return d
def o_attack(f, n=40):
    p = f / n; wind = seg(p, 0, .34); slam = seg(p, .44, .56); rec = seg(p, .70, 1.0)
    hr = vl(RR, V(-0.31, -0.02, 0.80), wind); hr = vl(hr, V(-0.31, -0.24, 0.47), slam); hr = vl(hr, RR, rec)
    rot = lerp(-10, -50, wind); rot = lerp(rot, 150, slam); rot = lerp(rot, -10, rec)
    hl = vl(RL, V(0.28, -0.05, 0.74), wind); hl = vl(hl, V(0.29, -0.20, 0.50), slam); hl = vl(hl, RL, rec)
    lean = lerp(lerp(-22 * wind, 32, slam), 0, rec)
    return dict(hand_R=hr, hand_L=hl, rot_R=(rot, 0, 0), chest_rot=(lean, 0, 4 * slam), head_rot=(lerp(-8 * wind, 14, slam) * (1 - rec), 0, 0),
                hips_off=(0, -0.06 * slam * (1 - rec), -0.03 * slam * (1 - rec)), foot_R=(0, -0.05 * slam * (1 - rec), 0))
def o_hit(f, n=18):
    k = math.sin(max(0, min(1, f / n)) * math.pi)
    return dict(chest_rot=(-20 * k, 0, 5 * k), head_rot=(-14 * k, 0, -6 * k), hips_off=(0, 0.05 * k, -0.02 * k),
                hand_R=va(RR, (0.02, -0.06 + 0.05 * k, 0.02 * k)), hand_L=va(RL, (0, 0.04 * k, 0.03 * k)), rot_R=(-10 - 12 * k, 0, 0))
def o_death(f):
    stag = dict(chest_rot=(-15, 0, 5), head_rot=(-12, 0, -8), hips_off=(0, 0.05, -0.02), hand_R=va(RR, (0.02, -0.01, 0.02)), hand_L=va(RL, (0, 0.04, 0.03)), rot_R=(-22, 0, 0))
    if f <= 5:
        k = f / 5; return dict(chest_rot=vl((0, 0, 0), stag['chest_rot'], k), head_rot=vl((0, 0, 0), stag['head_rot'], k), hips_off=vl((0, 0, 0), stag['hips_off'], k),
                               hand_R=vl(va(RR, (0.02, -0.06, 0)), stag['hand_R'], k), hand_L=vl(RL, stag['hand_L'], k), rot_R=(lerp(-10, -22, k), 0, 0))
    t = min(1.0, (f - 5) / 22); e = t * t * (3 - 2 * t); d = dict(stag)
    d['root_rot'] = (-88 * e, 0, 0); d['root_off'] = (0, 0.03 * e, 0.20 * e); d['hips_off'] = vl(stag['hips_off'], (0, 0.02, 0), e)
    d['chest_rot'] = vl(stag['chest_rot'], (0, 0, 0), e); d['head_rot'] = vl(stag['head_rot'], (-8, 0, 12), e)
    d['hand_L'] = vl(stag['hand_L'], V(0.40, 0.06, 0.28), e); d['hand_R'] = vl(stag['hand_R'], V(-0.40, 0.06, 0.28), e); d['rot_R'] = (lerp(-22, -70, e), 0, 0)
    d['foot_L'] = vl((0, 0, 0), (0.03, 0.02, 0.03), e); d['foot_R'] = vl((0, 0, 0), (-0.03, 0.05, 0.02), e)
    if f > 27: s_ = min(1.0, (f - 27) / 6); d['root_off'] = va(d['root_off'], (0, 0, 0.012 * math.sin(s_ * math.pi) * (1 - s_)))
    return d
def o_spawn(f, n=50):   # still asleep, slowly wakes up, grabs the mace, ready to fight
    p = f / n; asleep = 1 - seg(p, .40, .62); jerk = seg(p, .30, .38) * (1 - seg(p, .38, .46)) * math.sin(f * 2.2)
    stretch = seg(p, .55, .74) * (1 - seg(p, .74, .92)); grab = seg(p, .64, .86)
    hr = vl(V(-0.33, -0.16, 0.20), va(RR, (0.02, -0.06, 0)), grab); rot = lerp(100, -10, grab)
    hl = va(vl(V(0.30, -0.12, 0.20), RL, seg(p, .5, .8)), (0.06 * stretch, 0, 0.12 * stretch))
    return dict(hips_off=(0, 0.02 * asleep, -0.09 * asleep), chest_rot=(24 * asleep - 10 * stretch, 0, 0), head_rot=(30 * asleep - 8 * stretch, 0, 7 * jerk),
                hand_R=hr, hand_L=hl, rot_R=(rot, 0, 0))
def o_yawn(f, n=70):
    p = f / n; up = seg(p, .12, .40) * (1 - seg(p, .72, .94)); sh = math.sin(p * 2 * math.pi * 3) * up
    return dict(chest_rot=(-12 * up, 0, 0), head_rot=(-22 * up, 0, 2 * sh), hips_off=(0, 0, 0.01 * up),
                hand_L=vl(va(RL, (0, -0.02, 0)), V(0.30, -0.06, 0.72), up), hand_R=vl(va(RR, (0.02, -0.06, 0)), V(-0.30, -0.06, 0.72), up), rot_R=(lerp(-10, -20, up), 0, 0))
def o_cheer(f, n=60):
    p = f / n; up = seg(p, 0, .2) * (1 - seg(p, .85, 1.0)); pump = max(0, math.sin(p * 2 * math.pi * 3)) * up
    return dict(chest_rot=(-14 * up, 0, 0), head_rot=(-12 * up - 5 * pump, 0, 0), hips_off=(0, 0, 0.03 * pump),
                hand_L=vl(RL, V(0.30, -0.02 - 0.04 * pump, 0.80 + 0.03 * pump), up), hand_R=vl(va(RR, (0.02, -0.06, 0)), V(-0.31, -0.02 - 0.04 * pump, 0.80 + 0.03 * pump), up), rot_R=(lerp(-10, -30, up), 0, 0))
CLIPSETS = {'ogre': [('Idle', 60, o_idle, True), ('Walk', 36, o_walk, True), ('Run', 24, o_run, True), ('Attack', 40, o_attack, False), ('Hit', 18, o_hit, False),
                     ('Death', DEATH_LEN, o_death, False), ('Spawn', 50, o_spawn, False), ('Yawn', 70, o_yawn, False), ('Cheer', 60, o_cheer, False)],
            'archer': [('Idle', 60, idle, True), ('Walk', 30, walk, True), ('Run', 20, run, True), ('Shoot', 45, shoot, False), ('Flex', 72, flex, False),
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
    nh = np.where(mask, TT['to_hue'], hue); c = mx * sat; x = c * (1 - np.abs((nh * 6) % 2 - 1)); m0 = mx - c
    sector = (nh * 6).astype(int) % 6; z = np.zeros_like(c)
    R = np.select([sector == 0, sector == 1, sector == 2, sector == 3, sector == 4, sector == 5], [c, x, z, z, x, c]) + m0
    G = np.select([sector == 0, sector == 1, sector == 2, sector == 3, sector == 4, sector == 5], [x, c, c, x, z, z]) + m0
    Bc = np.select([sector == 0, sector == 1, sector == 2, sector == 3, sector == 4, sector == 5], [z, z, x, c, c, x]) + m0
    out = np.stack([np.where(mask, R, r), np.where(mask, G, g), np.where(mask, Bc, b), np.ones_like(r)], -1)
    img2 = bpy.data.images.new(NAME + '_enemy', w, h, alpha=False); img2.pixels = out.astype(np.float32).ravel().tolist()
    img2.filepath_raw = os.path.join(OUT, NAME + '_enemy.jpg'); img2.file_format = 'JPEG'; img2.save()      # JPEG: a 2048 px PNG is 6 MB
    log('team texture: recoloured', int(mask.sum()), 'pixels ->', NAME + '_enemy.jpg')

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
