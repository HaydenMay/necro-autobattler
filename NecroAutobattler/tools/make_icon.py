"""
make_icon.py - draw the app icon (skull dome, red headband, glowing purple eyes) into docs/icon-*.png

    blender -b -P tools/make_icon.py

Plain numpy drawing, no art files needed. Re-run if you want to tweak the look.
"""
import bpy, os, numpy as np
HERE = os.path.dirname(os.path.abspath(bpy.data.filepath or __file__)) if False else os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(os.path.dirname(HERE), 'docs')

def draw(S):
    y, x = np.mgrid[0:S, 0:S].astype(np.float32) / S                        # Blender image rows run bottom-to-top, so y=0 is the bottom edge
    img = np.zeros((S, S, 3), np.float32)
    r = np.hypot(x - 0.5, y - 0.5)
    img[:] = np.array([0.07, 0.04, 0.12]) + (np.clip(0.55 - r, 0, 1) ** 1.6)[..., None] * np.array([0.28, 0.10, 0.45])   # dark purple glow
    def ell(cx, cy, rx, ry): return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
    dome = ell(0.5, 0.55, 0.31, 0.30) < 1
    jaw = (ell(0.5, 0.36, 0.20, 0.16) < 1)
    skull = dome | jaw
    shade = np.clip(1.0 - 0.35 * np.clip((0.5 - y) * 2.2, 0, 1), 0.65, 1)
    img[skull] = (np.array([0.93, 0.85, 0.68])[None, :] * shade[skull][:, None])
    band = skull & (y > 0.60) & (y < 0.71)                                 # red headband across the dome
    img[band] = np.array([0.72, 0.10, 0.18])
    for cx in (0.39, 0.61):                                                 # dark sockets + glowing purple eyes
        sock = ell(cx, 0.49, 0.085, 0.075) < 1; img[sock] = np.array([0.05, 0.02, 0.08])
        glow = np.exp(-ell(cx, 0.49, 0.06, 0.055) * 2.2)[..., None] * np.array([0.85, 0.35, 1.0])
        img[skull] = np.clip(img[skull] + (glow[skull] * (ell(cx, 0.49, 0.16, 0.14)[skull, None] < 1)) * 0.5, 0, 1)
        core = ell(cx, 0.49, 0.05, 0.045) < 1; img[core] = np.array([0.85, 0.45, 1.0])
        img[ell(cx - 0.012, 0.505, 0.014, 0.014) < 1] = np.array([1, 1, 1])
    nose = (np.abs(x - 0.5) < 0.018 * (1.2 - (y - 0.33) * 2.5)) & (y > 0.33) & (y < 0.42) & skull; img[nose] = np.array([0.08, 0.04, 0.1])
    for i in range(5):                                                      # teeth
        tx = 0.5 + (i - 2) * 0.04; t = (np.abs(x - tx) < 0.016) & (y > 0.24) & (y < 0.31) & skull; img[t] = np.array([0.97, 0.94, 0.85])
    return np.concatenate([img, np.ones((S, S, 1), np.float32)], -1)

for S, name in ((180, 'icon-180.png'), (192, 'icon-192.png'), (512, 'icon-512.png')):
    a = draw(S)
    im = bpy.data.images.new(name, S, S, alpha=True); im.pixels = a.ravel().tolist()
    sc = bpy.context.scene; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    im.save_render(os.path.join(DOCS, name), scene=sc); print('[icon]', name)
