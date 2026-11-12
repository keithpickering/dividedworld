"""Divided World's Booster: a foil pillow pack between two sealed ends, straight ahead and orthographic, on a
transparent ground. The foil is the four colors the placeholder had, corner to corner, with rays from the coin; the coin
and the pack's name are embossed in the film. It is lit evenly, with no highlight of its own: the page's light draws the
highlight from the relief (specs/card-art.md, "A pack"). One scene makes both files. From this folder,

    python scene.py art.webp
    PASS=relief python scene.py relief.webp

with the cards' rig (../../cards/rig.py), as the cards' README says, and `fonttools brotli` beside `bpy`, to read the
name's face. The first is the pack's picture at the rig's defaults, 1080 by 1680. The second is which way each bit of
the film faces, as a color: red is the normal's x, green its up, blue its lean toward the viewer, each from -1..1 into
0..1; it is always 540 by 840, whatever ART_SCALE says, unlit, raw and not denoised. Render the relief again whenever
the picture is: nothing compares the two.

The engine prints the count over the picture, from 74% to 82% of its height, so the film there is kept quiet: no pleat,
no ray's edge and no lettering."""
import sys, os, math, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'cards'))   # the rig the card scenes share
sys.dont_write_bytecode = True
import bpy, bmesh
import numpy as np
from mathutils import noise
from mathutils.bvhtree import BVHTree
import rig

OUT = sys.argv[-1]
RELIEF = os.environ.get('PASS') == 'relief'
HERE = os.path.dirname(os.path.abspath(__file__))
FACE = os.path.join(HERE, '..', '..', 'fonts', 'Anton-Regular.woff2')      # the glass's display face
sc = rig.reset()

PW, PH = 5.3, 8.3            # the pack, which all but fills the 5.4 by 8.4 canvas
TOOTH = PW / 26              # a crimp tooth's width
HW, HH = PW / 2, PH / 2
CRIMP = 0.62                 # each sealed end's height
VC = HH - CRIMP
COIN = (0.0, 0.8, 1.3)       # x, z, radius
NAME, NAME_Z, NAME_H = 'BOOSTER', -1.25, 0.85      # the name, its middle and its capitals' height
QUIET = (4.2 - 0.84 * 8.4, 4.2 - 0.73 * 8.4)       # the count's band in z, with a margin either side of 74% to 82%

sm = lambda a: a * a * (3 - 2 * a)
unit = lambda a: np.clip(a, 0, 1)

def blur(a, sigma):
    """A Gaussian blur, by rows and then by columns."""
    r = int(sigma * 3); k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2); k /= k.sum()
    for axis in (0, 1):
        p = np.pad(a, [(r, r) if ax == axis else (0, 0) for ax in (0, 1)], mode='edge'); a = np.zeros_like(a)
        for i, kv in enumerate(k):
            a += kv * (p[i:i + a.shape[0], :] if axis == 0 else p[:, i:i + a.shape[1]])
    return a

# ---- the print's grid: about 400 pixels to a unit, row 0 at the foot ------------------------------------------------------
TW, TH = 2120, 3320
PX = TW / PW
ys, xs = np.mgrid[0:TH, 0:TW]
X = (xs + 0.5) / TW * PW - HW; Z = (ys + 0.5) / TH * PH - HH
quiet = 1 - sm(unit((Z - QUIET[0] + 0.12) / 0.12)) * sm(unit((QUIET[1] + 0.12 - Z) / 0.12))     # 0 inside the count's band

# ---- the name: the face's outlines, filled, read into the grid as a mask ---------------------------------------------
def name_mask():
    from fontTools.ttLib import TTFont                    # Blender reads no WOFF2: unpack the face to a TTF it can
    ttf = os.path.join(tempfile.mkdtemp(), 'face.ttf'); f = TTFont(FACE); f.flavor = None; f.save(ttf)
    cu = bpy.data.curves.new('name', 'FONT'); cu.body = NAME; cu.font = bpy.data.fonts.load(ttf); cu.space_character = 1.06
    o = bpy.data.objects.new('name', cu); sc.collection.objects.link(o)
    ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get()); tm = ev.to_mesh()
    vs = np.array([v.co[:] for v in tm.vertices]); polys = [tuple(p.vertices) for p in tm.polygons]
    lo, hi = vs.min(0), vs.max(0); k = NAME_H / (hi[1] - lo[1]); mid = (lo + hi) / 2
    vs = (vs - mid) * k; vs[:, 2] = 0
    tree = BVHTree.FromPolygons([tuple(v) for v in vs], polys)
    ev.to_mesh_clear(); bpy.data.objects.remove(o)
    mask = np.zeros((TH, TW), np.float32)
    w = (hi[0] - lo[0]) * k / 2
    c0, c1 = int((-w + HW) * PX) - 2, int((w + HW) * PX) + 3
    r0, r1 = int((NAME_Z - NAME_H / 2 + HH) * PX) - 2, int((NAME_Z + NAME_H / 2 + HH) * PX) + 3
    down = (0, 0, -1)
    for r in range(r0, r1):
        z = (r + 0.5) / PX - HH - NAME_Z
        for c in range(c0, c1):
            if tree.ray_cast(((c + 0.5) / PX - HW, z, 1.0), down)[0] is not None: mask[r, c] = 1
    return mask
name = name_mask()
name_soft = blur(name, 5.0)
name_edge = (blur(name, 4.0) > 0.06) & (name < 0.5)        # a dark line round each letter, as the coin's rim is

# ---- the print: four colors corner to corner, rays from the coin, the coin and the name ------------------------------
lin = lambda h: np.array(rig.hexrgb(h))
stops = [(0.0, '#ffd93d'), (0.34, '#ff3d7f'), (0.66, '#7a2bff'), (1.0, '#19e3ff')]
t = unit((X + HW) / PW * 0.39 + (HH - Z) / PH * 0.61)
img = np.zeros((TH, TW, 3))
for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
    k = unit((t - p0) / (p1 - p0))[..., None]
    m = ((t >= p0) & (t <= p1))[..., None]
    img = np.where(m, lin(c0) * (1 - k) + lin(c1) * k, img)
dx, dz = X - COIN[0], Z - COIN[1]; r = np.hypot(dx, dz); ang = np.arctan2(dz, dx)
rays = (unit(np.sin(ang * 28) * r * 40 + 0.5) * unit((r - COIN[2]) / 0.4) * quiet)[..., None]     # each ray's edge a soft one
img = img * (1 - 0.14 * rays) + 0.04 * rays
# the coin (mark.svg, 64 units across)
u = 64 / (2 * COIN[2] * 32 / 30)
cx, cz = dx * u, dz * u; cr = r * u
low = unit(-cz / 30)[..., None] ** 0.8
coin = np.where((cz > 0)[..., None], np.array([0.9, 0.9, 0.92]), lin('#8c24fa') * low + lin('#2a0f55') * (1 - low))
coin = np.where((np.abs(cz) < 2)[..., None], lin('#19e3ff'), coin)
coin = np.where((np.hypot(cx, cz - 16) < 6)[..., None], lin('#07050d'), coin)
coin = np.where((np.hypot(cx, cz + 16) < 6)[..., None], lin('#f1ecff'), coin)
coin = np.where((cr > 28.5)[..., None], lin('#07050d'), coin)
img = np.where((cr < 31.5)[..., None], coin, img)
img = np.where(name_edge[..., None], lin('#07050d'), img)
img = np.where((name > 0.5)[..., None], lin('#f1ecff'), img)
metal = np.where((cr < 31.5) | (name > 0.5) | name_edge, 0.25, 1.0)        # the coin and the name are ink on the foil; the rest is bare foil
tex = bpy.data.images.new('print', TW, TH, alpha=True, float_buffer=True); tex.colorspace_settings.name = 'Non-Color'
tex.pixels.foreach_set(np.dstack([img, metal]).astype(np.float32).ravel())

# ---- what is pressed into the film, as a height toward the viewer: the coin, its rim and its two dots, and the name ----
emboss = 0.03 * sm(unit((31.5 - cr) / 1.4))
emboss += 0.016 * sm(unit(1 - np.abs(cr - 30) / 1.7))
emboss += 0.012 * (sm(unit((6.5 - np.hypot(cx, cz - 16)) / 1.6)) + sm(unit((6.5 - np.hypot(cx, cz + 16)) / 1.6)))
emboss -= 0.008 * sm(unit((2.6 - np.abs(cz)) / 1.4)) * (cr < 27)
emboss = blur(emboss, 2.0) + 0.035 * name_soft

# ---- the wrapper: a pillow between two crimped ends ------------------------------------------------------------------
NX, NZ = 624, 978            # a tooth's point every twelfth column
tri = lambda a: 2 * abs(a - math.floor(a + 0.5))
cols = np.minimum(TW - 1, (np.arange(NX + 1) / NX * TW).astype(int)); rows = np.minimum(TH - 1, (np.arange(NZ + 1) / NZ * TH).astype(int))
E = emboss[rows[:, None], cols[None, :]]; Q = quiet[rows[:, None], cols[None, :]]
bm = bmesh.new(); uvl = bm.loops.layers.uv.new()
grid = []
for j in range(NZ + 1):
    row = []
    for i in range(NX + 1):
        x = -HW + PW * i / NX; z0 = -HH + PH * j / NZ
        az = abs(z0); z = z0; d = VC - az                # d: how far into the belly from the seal
        if az > VC:                                      # the crimp: its outer edge is cut in fine teeth
            edge = HH - 0.075 * tri(x / TOOTH)
            z = math.copysign(VC + (az - VC) * (edge - VC) / CRIMP, z0)
            y = 0.012 * math.sin(az * math.tau / 0.085) * min(1.0, (az - VC) / 0.05)        # the seal's ribs
        else:
            tb = min(1.0, d / 1.5)                       # 0 at the seal, 1 in the belly
            y = 0.34 * sm(tb) ** 0.8 * (1 - (abs(x) / HW) ** 3.0) ** 0.6
            top = z0 > 0                                 # the pleats the seal pulls: long from the top, short at the foot, none in the count's band
            reach = 1.5 if top else 0.9
            y += 0.07 * max(0.0, 1 - d / reach) ** 2.2 * min(1.0, d / 0.08) * noise.noise((x * 2.6 / (1 + d * 0.35), 8.0 if top else 12.0, d * 0.25)) * Q[j][i]
            y += 0.008 * noise.noise((x * 0.7, z0 * 0.35, 3.0))                             # the film is nearly flat, and not quite
            y += E[j][i]
        row.append(bm.verts.new((x, -y, z)))
    grid.append(row)
for j in range(NZ):
    for i in range(NX):
        f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i])); f.smooth = True
        for lp, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))): lp[uvl].uv = (a / NX, b / NZ)
me = bpy.data.meshes.new('pack'); bm.to_mesh(me); bm.free()
pack = bpy.data.objects.new('pack', me); sc.collection.objects.link(pack)
m, n, l, b = rig.material('foil')
ti = n.new('ShaderNodeTexImage'); ti.image = tex
l.new(ti.outputs['Color'], b.inputs['Base Color']); l.new(ti.outputs['Alpha'], b.inputs['Metallic'])
b.inputs['Roughness'].default_value = 0.22
me.materials.append(m)

# ---- even light: a soft room and two broad panels to show the film's form, with no hard highlight ---------------------
rig.world((0.5, 0.5, 0.6), 0.3)
rig.area('left', (-7, -9, 5), 12.0, 2100, look_at=(0, 0, 0))
rig.area('right', (8, -7, -3), 12.0, 900, rgb=(0.8, 0.9, 1.0), look_at=(0, 0, 0))
cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.sensor_fit = 'VERTICAL'; cam.ortho_scale = 8.4
o = bpy.data.objects.new('cam', cam); sc.collection.objects.link(o); sc.camera = o
o.location = (0, -12, 0); o.rotation_euler = (math.radians(90), 0, 0)

if RELIEF:                   # the film's facing in the camera's frame, as a color: unlit, raw, and half the picture's size
    nm = bpy.data.materials.new('relief'); nm.use_nodes = True; nn, nl = nm.node_tree.nodes, nm.node_tree.links
    g = nn.new('ShaderNodeNewGeometry'); sp = nn.new('ShaderNodeSeparateXYZ'); cb = nn.new('ShaderNodeCombineXYZ'); nl.new(g.outputs['Normal'], sp.inputs[0])
    def half(sock_, sign):
        a = nn.new('ShaderNodeMath'); a.operation = 'MULTIPLY_ADD'; nl.new(sock_, a.inputs[0]); a.inputs[1].default_value = 0.5 * sign; a.inputs[2].default_value = 0.5; return a.outputs[0]
    nl.new(half(sp.outputs['X'], 1), cb.inputs[0]); nl.new(half(sp.outputs['Z'], 1), cb.inputs[1]); nl.new(half(sp.outputs['Y'], -1), cb.inputs[2])
    em = nn.new('ShaderNodeEmission'); nl.new(cb.outputs[0], em.inputs['Color']); nl.new(em.outputs[0], nn['Material Output'].inputs['Surface'])
    me.materials.clear(); me.materials.append(nm)
    sc.view_settings.view_transform = 'Raw'; sc.cycles.use_denoising = False; sc.cycles.samples = 16
    sc.render.resolution_x, sc.render.resolution_y = rig.W, rig.H
rig.render(OUT, alpha=True)
