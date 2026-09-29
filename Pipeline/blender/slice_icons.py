"""
slice_icons.py - cut the two 5x6 icon sheets (colour + white-silhouette) into one PNG per icon.

    blender -b -P slice_icons.py -- <sheet_color.png> <sheet_mask.png> <out_dir> [size]

The white-on-black sheet supplies the transparency (so dark outlines never get keyed out); the colour sheet supplies the artwork.
Icons are found by connected blobs (nearby pieces such as a skull + its X are merged), not by a fixed grid, then sorted into reading order.
Outputs per icon:  <name>.png  (colour, transparent)   and   <name>_m.png  (white silhouette, transparent: a mask you can tint with CSS)
Also writes _preview_light.png / _preview_dark.png contact sheets for a quick visual check.
"""
import bpy, numpy as np, os, sys

NAMES = [
    'home', 'souls', 'shop', 'settings', 'close',
    'heart', 'heart_empty', 'dominion', 'star', 'lock',
    'warrior', 'archer', 'goblin', 'knight', 'ogre',
    'barbarian', 'gem_common', 'gem_rare', 'gem_epic', 'gem_legendary',
    'music', 'sound_on', 'sound_off', 'upgrade', 'swap',
    'merge', 'remove', 'check', 'back', 'info',
]
args = sys.argv[sys.argv.index('--') + 1:]
COLOR, MASK, OUT = args[0], args[1], args[2]
SIZE = int(args[3]) if len(args) > 3 else 192
os.makedirs(OUT, exist_ok=True)


def load(path):
    im = bpy.data.images.load(path)
    im.colorspace_settings.name = 'Non-Color'                   # keep the raw 0-1 values, no colour-space conversion
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]      # Blender stores rows bottom-first: flip so row 0 is the top
    return a


def save_rgba(arr, path):
    h, w, _ = arr.shape
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    im.colorspace_settings.name = 'Non-Color'; im.alpha_mode = 'CHANNEL_PACKED'
    im.pixels = arr[::-1].astype(np.float32).ravel().tolist()
    im.filepath_raw = path; im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)


col = load(COLOR)
msk = load(MASK)
H, W, _ = col.shape
assert msk.shape[:2] == (H, W), 'sheets must be the same size'
m = msk[..., 0]                                                  # white-on-black: any channel is the silhouette

# ---- find the 30 icons by projection: 6 horizontal bands (empty rows between them), then 5 icons per band (empty columns between them)
solid = m > 0.4


def runs(flags, gap):
    """[(start, end)] of consecutive True entries, joining runs separated by fewer than `gap` empty entries."""
    out = []; start = None; last = None
    for i, f in enumerate(flags):
        if f:
            if start is None:
                start = i
            elif i - last > gap:
                out.append((start, last + 1)); start = i
            last = i
    if start is not None:
        out.append((start, last + 1))
    return out


cols = runs(solid.any(axis=0), 30)
print('[icons] columns:', cols)
assert len(cols) == 5, 'expected 5 columns, found %d' % len(cols)
# rows: take the boundaries from the two cleanest columns, then in every column cut at the emptiest line near each boundary
ref = []
for (xa, xb) in cols[:2]:
    r = runs(solid[:, xa:xb].any(axis=1), 10)
    assert len(r) == 6, 'reference column should split into 6 rows'
    ref.append(r)
bounds = [int(np.mean([(r[k][1] + r[k + 1][0]) / 2 for r in ref])) for k in range(5)]
print('[icons] row boundaries:', bounds)
grid = {}
for ci, (xa, xb) in enumerate(cols):
    cuts = []
    for bnd in bounds:
        lo, hi = bnd - 30, bnd + 30
        density = solid[lo:hi, xa:xb].sum(axis=1)
        cuts.append(lo + int(np.argmin(density)))
    edges = [0] + cuts + [H]
    for ri in range(6):
        ya, yb = edges[ri], edges[ri + 1]
        sub = solid[ya:yb, xa:xb]; ys = np.nonzero(sub.any(axis=1))[0]; xs = np.nonzero(sub.any(axis=0))[0]
        grid[(ri, ci)] = (ya + int(ys.min()), ya + int(ys.max()) + 1, xa + int(xs.min()), xa + int(xs.max()) + 1)
ordered = [grid[(r, c)] for r in range(6) for c in range(5)]

previews = {'light': np.zeros((6 * SIZE, 5 * SIZE, 4), np.float32), 'dark': np.zeros((6 * SIZE, 5 * SIZE, 4), np.float32)}
previews['light'][...] = (0.8, 0.8, 0.8, 1); previews['dark'][...] = (0.13, 0.06, 0.2, 1)
for i, (y0, y1, x0, x1) in enumerate(ordered):
    pad = 10
    y0 = max(0, y0 - pad); y1 = min(H, y1 + pad); x0 = max(0, x0 - pad); x1 = min(W, x1 + pad)
    side = max(y1 - y0, x1 - x0)
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    ya, xa = max(0, cy - side // 2), max(0, cx - side // 2)
    yb, xb = min(H, ya + side), min(W, xa + side)
    rgb = col[ya:yb, xa:xb, :3]; a = np.clip(m[ya:yb, xa:xb] * 1.02, 0, 1)
    canvas = np.zeros((side, side, 4), np.float32)
    canvas[:yb - ya, :xb - xa, :3] = rgb; canvas[:yb - ya, :xb - xa, 3] = a
    mask_canvas = np.zeros((side, side, 4), np.float32); mask_canvas[..., :3] = 1.0; mask_canvas[..., 3] = canvas[..., 3]
    outs = {}
    for tag, arr in (('', canvas), ('_m', mask_canvas)):
        im = bpy.data.images.new('tmp', side, side, alpha=True)
        im.colorspace_settings.name = 'Non-Color'; im.alpha_mode = 'CHANNEL_PACKED'
        im.pixels = arr[::-1].ravel().tolist(); im.scale(SIZE, SIZE)
        small_arr = np.array(im.pixels[:], np.float32).reshape(SIZE, SIZE, 4)[::-1].copy()
        bpy.data.images.remove(im)
        # scaling blends colour with the transparent black around the icon: rebuild colour from the alpha-weighted result
        al = small_arr[..., 3:4]; small_arr[..., :3] = np.where(al > 1e-3, small_arr[..., :3] / np.maximum(al, 1e-3), 0).clip(0, 1) if tag == '' else 1.0
        outs[tag] = small_arr
        save_rgba(small_arr, os.path.join(OUT, NAMES[i] + tag + '.png'))
    r, c = divmod(i, 5)
    for k, bg in previews.items():
        a2 = outs[''][..., 3:4]
        bg[r * SIZE:(r + 1) * SIZE, c * SIZE:(c + 1) * SIZE, :3] = outs[''][..., :3] * a2 + bg[r * SIZE:(r + 1) * SIZE, c * SIZE:(c + 1) * SIZE, :3] * (1 - a2)
    print('[icons]', NAMES[i], 'from', (x0, y0, x1, y1))
for k, bg in previews.items():
    save_rgba(bg, os.path.join(OUT, '_preview_%s.png' % k))
print('[icons] done ->', OUT)
