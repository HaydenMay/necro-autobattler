# Big stills of chosen animation frames from a rigged unit's .blend, tiled into one image.
#   blender -b Unit.blend -P clip_frames.py -- out.png Idle:0 Attack:14 Attack:22 ...
import bpy, sys, math
import numpy as np
a = sys.argv[sys.argv.index('--') + 1:]; out = a[0]; picks = [(x.split(':')[0], int(x.split(':')[1])) for x in a[1:]]
sc = bpy.context.scene
arm = next(o for o in sc.objects if o.type == 'ARMATURE'); arm.animation_data_create()
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'TEXTURE'
W = 520; sc.render.resolution_x = sc.render.resolution_y = W; sc.world = bpy.data.worlds.new('w2'); sc.world.color = (0.82, 0.82, 0.87)
cam = bpy.data.objects.new('cq', bpy.data.cameras.new('cq')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; import os
cam.data.ortho_scale = float(os.environ.get('ORTHO', 1.5)); cam.location = (-2.2, -3.6, float(os.environ.get('CAMZ', 1.0)))
tgt = bpy.data.objects.new('tq', None); tgt.location = (float(os.environ.get('TGX', 0)), 0, float(os.environ.get('TGZ', 0.5))); sc.collection.objects.link(tgt)
tc = cam.constraints.new('TRACK_TO'); tc.target = tgt; tc.track_axis = 'TRACK_NEGATIVE_Z'; tc.up_axis = 'UP_Y'
tiles = []
for name, fr in picks:
    arm.animation_data.action = bpy.data.actions[name]; sc.frame_set(fr)
    fp = out + '_tmp.png'; sc.render.filepath = fp; bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(fp); tiles.append(np.array(im.pixels[:], dtype=np.float32).reshape(W, W, 4).copy()); bpy.data.images.remove(im)
cols = min(4, len(tiles)); rows = (len(tiles) + cols - 1) // cols
sheet = np.ones((rows * W, cols * W, 4), dtype=np.float32)
for i, t in enumerate(tiles): r, c = divmod(i, cols); sheet[(rows - 1 - r) * W:(rows - r) * W, c * W:(c + 1) * W] = t
im = bpy.data.images.new('sheet', cols * W, rows * W, alpha=True); im.pixels = sheet.ravel().tolist(); im.filepath_raw = out; im.file_format = 'PNG'; im.save()
print('[frames] wrote', out)
