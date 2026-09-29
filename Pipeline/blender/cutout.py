# Cut objects out of a flat-grey ChatGPT background (flood fill from the border), crop, optionally split into columns, resize, save as transparent PNG.
#   blender -b -P cutout.py -- in.webp out_prefix target_height [split_columns]
# One output per object: out_prefix.png (or out_prefix_1.png ... when splitting).
import bpy, sys
import numpy as np

a = sys.argv[sys.argv.index('--') + 1:]
src, prefix, target_h = a[0], a[1], int(a[2]); split = int(a[3]) if len(a) > 3 else 1

img = bpy.data.images.load(src); img.colorspace_settings.name = 'sRGB'
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)    # bottom-up rows, like Blender stores them
rgb = px[..., :3]
border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
bg = np.median(border, axis=0)
dist = np.sqrt(((rgb - bg) ** 2).sum(-1))
like = dist < 0.06                                               # looks like the background
# flood fill from every border pixel through background-like pixels only
seen = np.zeros_like(like); seen[0, :] = like[0, :]; seen[-1, :] = like[-1, :]; seen[:, 0] = like[:, 0]; seen[:, -1] = like[:, -1]
for _ in range(max(w, h)):
    n = seen.copy()
    n[1:, :] |= seen[:-1, :]; n[:-1, :] |= seen[1:, :]; n[:, 1:] |= seen[:, :-1]; n[:, :-1] |= seen[:, 1:]
    n &= like
    if (n == seen).all(): break
    seen = n
alpha = (~seen).astype(np.float32)
# erode one pixel to lose the grey fringe, then soften the edge a touch
er = alpha.copy(); er[1:, :] = np.minimum(er[1:, :], alpha[:-1, :]); er[:-1, :] = np.minimum(er[:-1, :], alpha[1:, :]); er[:, 1:] = np.minimum(er[:, 1:], alpha[:, :-1]); er[:, :-1] = np.minimum(er[:, :-1], alpha[:, 1:])
soft = (er + np.roll(er, 1, 0) + np.roll(er, -1, 0) + np.roll(er, 1, 1) + np.roll(er, -1, 1)) / 5
out = px.copy(); out[..., 3] = soft

def save(arr, name):
    ys, xs = np.where(arr[..., 3] > 0.05)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = arr[y0:y1, x0:x1]; ch, cw = crop.shape[:2]
    im = bpy.data.images.new(name, cw, ch, alpha=True); im.pixels = crop.ravel().tolist()
    s = target_h / ch
    if s < 1: im.scale(max(1, round(cw * s)), target_h)
    sc = bpy.context.scene; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    im.filepath_raw = name; im.file_format = 'PNG'; im.save()
    print('[cut]', name, cw, 'x', ch, '->', im.size[0], 'x', im.size[1])

if split == 1: save(out, prefix + '.png')
else:
    cols = (out[..., 3] > 0.05).any(0); edges = []; inside = False
    for x, c in enumerate(cols):
        if c and not inside: edges.append([x, x]); inside = True
        elif c: edges[-1][1] = x
        elif inside and not c: inside = False
    edges = [e for e in edges if e[1] - e[0] > w * 0.05]
    print('[cut] columns found', len(edges))
    for i, (x0, x1) in enumerate(edges[:split]):
        part = np.zeros_like(out); part[:, x0:x1 + 1] = out[:, x0:x1 + 1]; save(part, prefix + '_%d.png' % (i + 1))
