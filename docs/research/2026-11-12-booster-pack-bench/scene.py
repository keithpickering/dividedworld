"""Draft: the Booster as a foil pillow pack, straight ahead, orthographic, on a transparent ground, lit evenly (the page's light adds the highlight)."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'instances', 'divided-world', 'ui', 'cards'))   # the cards' rig
sys.dont_write_bytecode = True
import bpy, bmesh
import numpy as np
from mathutils import noise, Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
sc.render.film_transparent = True

PW, PH = 5.0, 8.0            # the pack, inside the 5.4 by 8.4 canvas
HW, HH = PW / 2, PH / 2
CRIMP = 0.62                 # each sealed end's height
VC = HH - CRIMP
COIN = (0.0, 0.55, 1.3)      # x, z, radius

# ---- the print: the placeholder's four colors corner to corner, rays from the coin, and the coin itself -----------
TW, TH = 1000, 1600
ys, xs = np.mgrid[0:TH, 0:TW]
X = (xs + 0.5) / TW * PW - HW; Z = (ys + 0.5) / TH * PH - HH      # image row 0 is the foot
lin = lambda h: np.array(rig.hexrgb(h))
stops = [(0.0, '#ffd93d'), (0.34, '#ff3d7f'), (0.66, '#7a2bff'), (1.0, '#19e3ff')]
t = np.clip(((X + HW) / PW * 0.39 + (HH - Z) / PH * 0.61), 0, 1)
img = np.zeros((TH, TW, 3))
for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
    k = np.clip((t - p0) / (p1 - p0), 0, 1)[..., None]
    m = ((t >= p0) & (t <= p1))[..., None]
    img = np.where(m, lin(c0) * (1 - k) + lin(c1) * k, img)
dx, dz = X - COIN[0], Z - COIN[1]; r = np.hypot(dx, dz); ang = np.arctan2(dz, dx)
rays = (np.sin(ang * 28) > 0).astype(float) * np.clip((r - COIN[2]) / 0.4, 0, 1)
img = img * (1 - 0.14 * rays[..., None]) + 0.04 * rays[..., None]
# the coin (mark.svg, 64 units across its 2*R)
u = 64 / (2 * COIN[2] * 32 / 30)
cx, cz = dx * u, dz * u; cr = r * u
coin = np.where((cz > 0)[..., None], np.array([0.9, 0.9, 0.92]), lin('#8c24fa') * np.clip(-cz / 30, 0, 1)[..., None] ** 0.8 + lin('#2a0f55') * (1 - np.clip(-cz / 30, 0, 1)[..., None] ** 0.8))
coin = np.where((np.abs(cz) < 2)[..., None], lin('#19e3ff'), coin)
coin = np.where((np.hypot(cx, cz - 16) < 6)[..., None], lin('#07050d'), coin)
coin = np.where((np.hypot(cx, cz + 16) < 6)[..., None], lin('#f1ecff'), coin)
coin = np.where((cr > 28.5)[..., None], lin('#07050d'), coin)
img = np.where((cr < 31.5)[..., None], coin, img)
metal = np.where(cr < 31.5, 0.25, 1.0)        # the coin is ink on the foil; the rest is bare foil
tex = bpy.data.images.new('print', TW, TH, alpha=True, float_buffer=True); tex.colorspace_settings.name = 'Non-Color'
tex.pixels.foreach_set(np.dstack([img, metal]).astype(np.float32).ravel())

# ---- the wrapper: a pillow between two crimped ends ----------------------------------------------------------------
NX, NZ = 360, 580
tri = lambda a: 2 * abs(a - math.floor(a + 0.5))
sm = lambda a: a * a * (3 - 2 * a)
bm = bmesh.new(); uvl = bm.loops.layers.uv.new()
grid = []
for j in range(NZ + 1):
    row = []
    for i in range(NX + 1):
        x = -HW + PW * i / NX; z0 = -HH + PH * j / NZ
        az = abs(z0); z = z0
        if az > VC:                              # the crimp: its outer edge is cut in fine teeth
            edge = HH - 0.075 * tri(x / 0.2)
            z = math.copysign(VC + (az - VC) * (edge - VC) / CRIMP, z0)
        tb = max(0.0, min(1.0, (VC - az) / 1.5))      # 0 at the seal, 1 in the belly
        ux = abs(x) / HW
        y = 0.34 * sm(tb) ** 0.8 * (1 - ux ** 3.0) ** 0.6
        y += 0.035 * (1 - tb) ** 2.2 * min(1.0, (VC - az) / 0.08 if az < VC else 0.0) * noise.noise((x * 2.6, 7.0 + (1 if z0 > 0 else 5), az * 0.25)) * 2     # the folds the seal pulls
        y += 0.012 * noise.noise((x * 0.7, z0 * 0.35, 3.0)) + 0.0015 * noise.noise((x * 5, z0 * 4, 9.0))                                                       # the film's own crinkle
        y += 0.03 * sm(max(0.0, min(1.0, (COIN[2] * 1.02 - math.hypot(x - COIN[0], z0 - COIN[1])) / 0.06)))                                                # the coin, embossed
        if az > VC: y = 0.012 * math.sin(az * math.tau / 0.085) * min(1.0, (az - VC) / 0.05)                                                                # the seal's ribs
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

# ---- even light: a soft room, two broad panels to show the film's form, no hard highlight --------------------------
rig.world((0.5, 0.5, 0.6), 0.3)
rig.area('left', (-7, -9, 5), 12.0, 2600, look_at=(0, 0, 0))
rig.area('right', (8, -7, -3), 12.0, 900, rgb=(0.8, 0.9, 1.0), look_at=(0, 0, 0))
cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.sensor_fit = 'VERTICAL'; cam.ortho_scale = 8.4
o = bpy.data.objects.new('cam', cam); sc.collection.objects.link(o); sc.camera = o
o.location = (0, -12, 0); o.rotation_euler = (math.radians(90), 0, 0)
if os.environ.get('PASS') == 'normal':         # the film's facing, for the page's light: camera-space normal as a color, unlit and raw
    nm = bpy.data.materials.new('normal'); nm.use_nodes = True; nn, nl = nm.node_tree.nodes, nm.node_tree.links
    g = nn.new('ShaderNodeNewGeometry'); sp = nn.new('ShaderNodeSeparateXYZ'); cb = nn.new('ShaderNodeCombineXYZ'); nl.new(g.outputs['Normal'], sp.inputs[0])
    def half(sock_, sign):
        a = nn.new('ShaderNodeMath'); a.operation = 'MULTIPLY_ADD'; nl.new(sock_, a.inputs[0]); a.inputs[1].default_value = 0.5 * sign; a.inputs[2].default_value = 0.5; return a.outputs[0]
    nl.new(half(sp.outputs['X'], 1), cb.inputs[0]); nl.new(half(sp.outputs['Z'], 1), cb.inputs[1]); nl.new(half(sp.outputs['Y'], -1), cb.inputs[2])
    em = nn.new('ShaderNodeEmission'); nl.new(cb.outputs[0], em.inputs['Color']); nl.new(em.outputs[0], nn['Material Output'].inputs['Surface'])
    me.materials.clear(); me.materials.append(nm)
    sc.view_settings.view_transform = 'Raw'; sc.cycles.use_denoising = False; sc.cycles.samples = 16
sc.render.image_settings.file_format = 'WEBP' if OUT.endswith('.webp') else 'PNG'
sc.render.image_settings.color_mode = 'RGBA'; sc.render.image_settings.quality = 88
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
