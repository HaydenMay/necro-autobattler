"""
recolor_texture.py - make the enemy-team version of a Tripo texture (purple glowing eyes -> amber).

    blender -b -P recolor_texture.py -- in.jpg out.jpg [from_hue_lo from_hue_hi to_hue] [max_size]

Only pixels whose hue is in the purple range AND are saturated+bright are shifted, so keep purple ONLY on the eyes in the
reference art. Output is a JPEG (about 1 MB for 2048 px) instead of the 5 MB PNG.
"""
import bpy, sys, numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
src, dst = a[0], a[1]
lo, hi, to = (float(a[2]), float(a[3]), float(a[4])) if len(a) >= 5 else (0.70, 0.90, 0.105)
maxsize = int(a[5]) if len(a) >= 6 else 0
img = bpy.data.images.load(src)
w, h = img.size; ch = img.channels
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, ch)[:, :, :3]
r, g, b = px[..., 0], px[..., 1], px[..., 2]
mx = px.max(-1); mn = px.min(-1); d = mx - mn + 1e-9
hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6.0
sat = d / (mx + 1e-9)
mask = (hue >= lo) & (hue <= hi) & (sat > 0.28) & (mx > 0.25)
nh = np.where(mask, to, hue); c = mx * sat; x = c * (1 - np.abs((nh * 6) % 2 - 1)); m0 = mx - c
sector = (nh * 6).astype(int) % 6; z = np.zeros_like(c)
conds = [sector == i for i in range(6)]
R = np.select(conds, [c, x, z, z, x, c]) + m0; G = np.select(conds, [x, c, c, x, z, z]) + m0; Bc = np.select(conds, [z, z, x, c, c, x]) + m0
out = np.stack([np.where(mask, R, r), np.where(mask, G, g), np.where(mask, Bc, b), np.ones_like(r)], -1)
o = bpy.data.images.new('out', w, h, alpha=False); o.pixels = out.astype(np.float32).ravel().tolist()
if maxsize and max(w, h) > maxsize: o.scale(maxsize, maxsize)
o.filepath_raw = dst; o.file_format = 'JPEG'; o.save_render(dst) if False else None
sc = bpy.context.scene; sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 88
o.save_render(dst, scene=sc)
print('[recolor]', int(mask.sum()), 'pixels shifted ->', dst)
