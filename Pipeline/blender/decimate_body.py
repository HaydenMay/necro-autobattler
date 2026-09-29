# Cut a heavy image-to-3D body (Hunyuan/Tripo GLB) down to a game-ready size and RE-BAKE its colour onto the light mesh.
# (Collapsing triangles on the original UVs tears the texture apart: the atlas is hundreds of tiny islands. So: decimate the shape, unwrap it
#  cleanly, and bake the painted colour from the high-poly onto the new UVs.)
#   blender -b -P decimate_body.py -- in.glb out.glb target_triangles [texture_px] [bake_png] [colour_gain]
# Output: one mesh, base-colour texture only, metres, feet on z=0, facing -Y (the glTF export makes it Y-up).
import bpy, sys, math
a = sys.argv[sys.argv.index('--') + 1:]
src, out, target = a[0], a[1], int(a[2]); px = int(a[3]) if len(a) > 3 else 2048
bake_png = a[4] if len(a) > 4 else out.replace('.glb', '_color.png')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in [o for o in sc.objects if o.type != 'MESH']: bpy.data.objects.remove(o, do_unlink=True)
hi = [o for o in sc.objects if o.type == 'MESH'][0]
bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); bpy.context.view_layer.objects.active = hi
hi.parent = None; bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = hi.data; me.calc_loop_triangles(); n0 = len(me.loop_triangles)
weapon_len = float(a[6]) if len(a) > 6 else 0.0     # >0: this is a WEAPON: stand it upright, scale to this length, put the grip at the origin
if weapon_len > 0:
    import numpy as np
    from mathutils import Vector
    P = np.array([v.co[:] for v in me.vertices]); m = P.mean(0); w, V = np.linalg.eigh(np.cov((P - m).T)); ax = V[:, np.argmax(w)]
    t = (P - m) @ ax
    if (t.mean() < (t.min() + t.max()) / 2) != (len(a) > 7 and a[7] == 'flip'): ax = -ax; t = -t          # the heavy head end (more vertices) points up
    q = Vector(ax.tolist()).rotation_difference(Vector((0, 0, 1)))
    for v in me.vertices: v.co = q @ (v.co - Vector(m.tolist()))
    me.update(); P2 = np.array([v.co[:] for v in me.vertices]); z0, z1 = P2[:, 2].min(), P2[:, 2].max(); sc_f = weapon_len / (z1 - z0)
    grip_z = z0 + 0.28 * (z1 - z0); handle = P2[P2[:, 2] < z0 + 0.25 * (z1 - z0)]; hx, hy = handle[:, 0].mean(), handle[:, 1].mean()
    for v in me.vertices: v.co = Vector(((v.co.x - hx) * sc_f, (v.co.y - hy) * sc_f, (v.co.z - grip_z) * sc_f))
    me.update(); print('[dec] weapon: length %.2f, grip at origin, head up' % weapon_len)
else:
    # feet on z=0, centred, BEFORE copying so both meshes line up
    zs = [v.co.z for v in me.vertices]; xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
    lo_z = min(zs); cx = (min(xs) + max(xs)) / 2; cy = (min(ys) + max(ys)) / 2
    for v in me.vertices: v.co.x -= cx; v.co.y -= cy; v.co.z -= lo_z
    me.update()
# a mesh that is already light and clean (a Tripo Smart Mesh): keep its own texture and topology, just orient / scale / centre it and export
if n0 <= target:
    hi.name = 'body'; me.name = 'body'
    for m_ in me.materials:
        if m_ and m_.use_nodes:
            for nd_ in m_.node_tree.nodes:
                if nd_.type == 'TEX_IMAGE' and nd_.image and max(nd_.image.size) > px: nd_.image.scale(px, px)
    bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); bpy.context.view_layer.objects.active = hi
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=90, export_yup=True, export_apply=True)
    print('[dec] clean mesh kept as is:', n0, 'triangles; size w %.2f d %.2f h %.2f' % tuple(hi.dimensions), ' wrote', out)
    raise SystemExit(0)
# the light copy
lo = hi.copy(); lo.data = hi.data.copy(); lo.name = 'body'; sc.collection.objects.link(lo)
bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True); bpy.context.view_layer.objects.active = lo
# weld the vertices that image-to-3D duplicated along texture seams, or every seam collapses on its own and tears the model open
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.mesh.remove_doubles(threshold=0.00002); bpy.ops.object.mode_set(mode='OBJECT')
print('[dec] verts after weld', len(lo.data.vertices))
mod = lo.modifiers.new('d', 'DECIMATE'); mod.ratio = min(1.0, target / n0); mod.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='d')
lo.data.calc_loop_triangles(); n1 = len(lo.data.loop_triangles)
# clean new UVs
for uv in list(lo.data.uv_layers): lo.data.uv_layers.remove(uv)
lo.data.uv_layers.new(name='UVMap')
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=0.004)
bpy.ops.object.mode_set(mode='OBJECT')
# metal renders black in a colour-only bake (metallic surfaces have no diffuse colour): flatten the source to plain colour first
for m_ in hi.data.materials:
    if m_ and m_.use_nodes:
        for nd_ in m_.node_tree.nodes:
            if nd_.type == 'BSDF_PRINCIPLED':
                for l_ in list(nd_.inputs['Metallic'].links): m_.node_tree.links.remove(l_)
                nd_.inputs['Metallic'].default_value = 0.0
# bake target
img = bpy.data.images.new('body_color', px, px, alpha=False)
mat = bpy.data.materials.new('body'); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
outn = nt.nodes.new('ShaderNodeOutputMaterial'); bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled'); tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img
bsdf.inputs['Roughness'].default_value = 0.85; bsdf.inputs['Metallic'].default_value = 0.0
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color']); nt.links.new(bsdf.outputs['BSDF'], outn.inputs['Surface'])
nt.nodes.active = tex
lo.data.materials.clear(); lo.data.materials.append(mat)
# bake the colour from the original onto the light mesh
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 1
bk = sc.render.bake; bk.use_selected_to_active = True; bk.cage_extrusion = 0.02; bk.max_ray_distance = 0.08; bk.margin = 10; bk.margin_type = 'EXTEND'
bk.use_pass_direct = False; bk.use_pass_indirect = False; bk.use_pass_color = True
bpy.ops.object.select_all(action='DESELECT'); hi.select_set(True); lo.select_set(True); bpy.context.view_layer.objects.active = lo
bpy.ops.object.bake(type='DIFFUSE')
gain = float(a[5]) if len(a) > 5 else 1.0                       # metal bakes dark without lighting: brighten the colour map
if gain != 1.0:
    import numpy as np
    px_ = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4); px_[:, :3] = np.clip(px_[:, :3] * gain, 0, 1); img.pixels = px_.ravel().tolist()
img.filepath_raw = bake_png; img.file_format = 'PNG'; img.save()
# export only the light mesh
bpy.data.objects.remove(hi, do_unlink=True)
lo.data.shade_smooth() if hasattr(lo.data, 'shade_smooth') else None
bpy.ops.object.select_all(action='DESELECT'); lo.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG', export_jpeg_quality=90, export_yup=True, export_apply=True)
d = lo.dimensions
print('[dec] tris', n0, '->', n1, ' size w %.2f d %.2f h %.2f' % (d.x, d.y, d.z), ' wrote', out)
