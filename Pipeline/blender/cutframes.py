# Cut card frames out of a ChatGPT sheet: grey background AND the solid magenta windows become transparent. Prints each window's position as fractions of the frame.
#   blender -b -P cutframes.py -- sheet.webp out_dir name1,name2,... target_height
import bpy, sys, os, json
import numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
src, outdir, names, target_h = a[0], a[1], a[2].split(','), int(a[3])
img = bpy.data.images.load(src); img.colorspace_settings.name = 'sRGB'
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4); rgb = px[..., :3]
bg = np.median(np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]), axis=0)
like = np.sqrt(((rgb - bg) ** 2).sum(-1)) < 0.06
seen = np.zeros_like(like); seen[0, :] = like[0, :]; seen[-1, :] = like[-1, :]; seen[:, 0] = like[:, 0]; seen[:, -1] = like[:, -1]
for _ in range(max(w, h)):
    n = seen.copy(); n[1:, :] |= seen[:-1, :]; n[:-1, :] |= seen[1:, :]; n[:, 1:] |= seen[:, :-1]; n[:, :-1] |= seen[:, 1:]; n &= like
    if (n == seen).all(): break
    seen = n
mag = (rgb[..., 0] > 0.7) & (rgb[..., 2] > 0.7) & (rgb[..., 1] < 0.45)
magd = mag.copy()                                                    # grow the hole a pixel or two so no pink fringe survives
for _ in range(2):
    m2 = magd.copy(); m2[1:, :] |= magd[:-1, :]; m2[:-1, :] |= magd[1:, :]; m2[:, 1:] |= magd[:, :-1]; m2[:, :-1] |= magd[:, 1:]; magd = m2
alpha = (~(seen | magd)).astype(np.float32)
er = alpha.copy(); er[1:, :] = np.minimum(er[1:, :], alpha[:-1, :]); er[:-1, :] = np.minimum(er[:-1, :], alpha[1:, :]); er[:, 1:] = np.minimum(er[:, 1:], alpha[:, :-1]); er[:, :-1] = np.minimum(er[:, :-1], alpha[:, 1:])
soft = (er + np.roll(er, 1, 0) + np.roll(er, -1, 0) + np.roll(er, 1, 1) + np.roll(er, -1, 1)) / 5
out = px.copy(); out[..., 3] = soft
outer = ~seen                                                        # frame silhouette incl. windows
cols = outer.any(0); edges = []; inside = False
for x, c in enumerate(cols):
    if c and not inside: edges.append([x, x]); inside = True
    elif c: edges[-1][1] = x
    elif inside: inside = False
edges = [e for e in edges if e[1] - e[0] > w * 0.05]
print('[frame] found', len(edges))
info = {}
for (x0, x1), name in zip(edges, names):
    sub_outer = outer[:, x0:x1 + 1]; ys = np.where(sub_outer.any(1))[0]; y0, y1 = ys.min(), ys.max() + 1
    crop = out[y0:y1, x0:x1 + 1].copy(); ch, cw = crop.shape[:2]
    hole = magd[y0:y1, x0:x1 + 1]
    # windows: vertical runs of hole pixels down the middle column
    mid = hole[:, cw // 2]; runs = []; st = None
    for y, v in enumerate(mid):
        if v and st is None: st = y
        elif not v and st is not None: runs.append((st, y)); st = None
    wins = []
    for (r0, r1) in runs:
        xs = np.where(hole[(r0 + r1) // 2])[0]; wins.append([round(xs.min() / cw, 4), round(r0 / ch, 4), round((xs.max() + 1) / cw, 4), round(r1 / ch, 4)])
    info[name] = {'aspect': round(cw / ch, 4), 'windows': wins}
    im = bpy.data.images.new(name, cw, ch, alpha=True); im.pixels = crop.ravel().tolist()
    s = target_h / ch
    if s < 1: im.scale(max(1, round(cw * s)), target_h)
    im.filepath_raw = os.path.join(outdir, 'frame_' + name + '.png'); im.file_format = 'PNG'; im.save()
print('[frame]', json.dumps(info))
