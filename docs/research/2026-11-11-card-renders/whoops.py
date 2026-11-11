"""Whoops! card art exploration: the game's own metaball splat (cards/whoops/splat.ts), inflated to 3D."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import bpy
from scipy import sparse
from scipy.sparse.linalg import cg
import rig

OUT = sys.argv[-1]
SEED = int(os.environ.get('WHOOPS_SEED', '7'))
T = 0.42                                   # splat.ts THRESHOLD

# ---- the game's splat, ported from splat.ts -------------------------------------------------
def mulberry32(seed):
    a = seed & 0xffffffff
    imul = lambda x, y: (x * y) & 0xffffffff
    def r():
        nonlocal a
        a = (a + 0x6d2b79f5) & 0xffffffff
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xffffffff) ^ t
        return ((t ^ (t >> 14)) & 0xffffffff) / 4294967296
    return r

def make_splat(seed):
    r = mulberry32(seed); balls = []
    DW, DH = 1.25, 1.0
    cx = DW / 2 + (r() - 0.5) * 0.14; cy = DH / 2 + (r() - 0.5) * 0.1
    harm = [(k, (0.05 + r() * 0.11) / math.sqrt(k / 2), r() * math.pi * 2) for k in (2, 3, 4, 5, 7)]
    def swell(th):
        m = 1 + sum(a * math.sin(k * th + p) for k, a, p in harm)
        return max(0.65, min(1.3, m))
    R0 = 0.27
    balls.append((cx, cy, 0.22))
    for i in range(6):
        th = r() * math.pi * 2; d = r() * 0.14
        balls.append((cx + math.cos(th) * d * 1.25, cy + math.sin(th) * d, 0.14 + r() * 0.05))
    ring = 15
    for i in range(ring):
        th = ((i + (r() - 0.5) * 0.5) / ring) * math.pi * 2; m = swell(th)
        balls.append((cx + math.cos(th) * R0 * m * 1.3, cy + math.sin(th) * R0 * m, 0.1 + r() * 0.06))
    arms = 9 + math.floor(r() * 7)
    for a in range(arms):
        th = r() * math.pi * 2; m = swell(th)
        sx = cx + math.cos(th) * R0 * m * 1.3 * 0.95; sy = cy + math.sin(th) * R0 * m * 0.95
        ln = 0.14 + r() * 0.32; w = 0.03 + r() * 0.035; bend = (r() - 0.5) * 0.7; beads = 10
        for k in range(1, beads + 1):
            f = k / beads; ang = th + bend * f * f; d = ln * f
            balls.append((sx + math.cos(ang) * d, sy + math.sin(ang) * d, w * (1 - 0.62 * f)))
        ang = th + bend
        balls.append((sx + math.cos(ang) * ln, sy + math.sin(ang) * ln, w * 0.72))
        drops = 1 + math.floor(r() * 3)
        for j in range(drops):
            d = ln + 0.05 + r() * 0.14; aj = ang + (r() - 0.5) * 0.35
            balls.append((sx + math.cos(aj) * d, sy + math.sin(aj) * d, w * (0.28 + r() * 0.42)))
    flecks = 5 + math.floor(r() * 7)
    for i in range(flecks):
        th = r() * math.pi * 2; d = 0.55 + r() * 0.25
        balls.append((cx + math.cos(th) * d * 1.3, cy + math.sin(th) * d, 0.008 + r() * 0.02))
    return balls, (cx, cy)

def place(seed, at, size, rot=0.0):
    """A seed's splat as world balls (x, y up, r): its core put at `at`, one design unit being `size`."""
    balls, (cx, cy) = make_splat(seed)
    c, s = math.cos(rot), math.sin(rot); out = []
    for x, y, r in balls:
        dx, dy = (x - cx) * size, -(y - cy) * size
        out.append((at[0] + dx * c - dy * s, at[1] + dx * s + dy * c, r * size))
    return out

def drip(x, y0, length, w, wobble=0.0, seed=1):
    """A run down the wall: beads thinning a little, then a bulb at the foot."""
    rnd = mulberry32(seed); out = []; n = max(4, int(length / (w * 0.55)))
    for k in range(n + 1):
        f = k / n
        out.append((x + math.sin(f * 5 + seed) * wobble * f, y0 - length * f, w * (1.0 - 0.35 * f) * (0.95 + 0.1 * rnd())))
    out.append((x + math.sin(5 + seed) * wobble, y0 - length - w * 0.4, w * 1.25))
    return out

# ---- the layers, laid out after the placeholder art.svg: one big splat high and left, runs under it,
# a darker one behind and low, small pale ones about ------------------------------------------
# world: the card is 5.4 wide by 8.4 tall, centered on the origin, y up
main = place(SEED, (-0.2, 1.55), 3.7, rot=0.3)
main += drip(-1.0, 0.75, 3.3, 0.1, 0.05, 3) + drip(0.3, 0.45, 2.3, 0.075, 0.04, 5) + drip(0.95, 0.8, 1.6, 0.055, 0.03, 8) + drip(-0.4, 0.45, 1.2, 0.05, 0.02, 9)
back = place(SEED + 12, (1.45, -2.5), 2.6, rot=1.1) + drip(1.8, -3.1, 1.5, 0.07, 0.03, 4)
pale = place(SEED + 5, (2.0, 3.4), 0.95, rot=0.5) + place(SEED + 9, (-2.0, -2.9), 0.7, rot=2.0)

X0, X1, Y0, Y1 = -3.5, 3.5, -5.2, 5.2      # the wall, wider than the card so a tilted camera never sees its edge

def field(balls, ppu):
    gw, gh = int(round((X1 - X0) * ppu)), int(round((Y1 - Y0) * ppu))
    f = np.zeros((gh, gw), np.float32)
    for x, y, r in balls:
        R = 2 * r * ppu; bx = (x - X0) * ppu; by = (y - Y0) * ppu
        x0, x1 = max(0, int(bx - R)), min(gw - 1, int(bx + R) + 1)
        y0, y1 = max(0, int(by - R)), min(gh - 1, int(by + R) + 1)
        if x1 < x0 or y1 < y0: continue
        xs = np.arange(x0, x1 + 1) + 0.5 - bx; ys = np.arange(y0, y1 + 1) + 0.5 - by
        k = 1 - (xs[None, :] ** 2 + ys[:, None] ** 2) / (R * R)
        f[y0:y1 + 1, x0:x1 + 1] += np.where(k > 0, k, 0) ** 3
    return f

def alpha(f):
    gy, gx = np.gradient(f)
    return np.clip(0.5 + (f - T) / np.maximum(np.hypot(gx, gy), 1e-6), 0, 1)

def inflate(f, ppu, cap):
    """Height of a wet blob over the ink: solve lap(u) = -1 inside, u = 0 at the edge; 2*sqrt(u) is a half-round
    for a bead or a run, and tanh flattens a wide pool to `cap` with a rounded lip."""
    inside = f >= T
    idx = -np.ones(f.shape, np.int64); n = int(inside.sum()); idx[inside] = np.arange(n)
    rows, cols = [], []
    for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
        nb = np.roll(idx, (-dy, -dx), (0, 1))
        ok = inside & (nb >= 0)
        rows.append(idx[ok]); cols.append(nb[ok])
    rows = np.concatenate(rows); cols = np.concatenate(cols)
    A = sparse.coo_matrix((-np.ones(len(rows)), (rows, cols)), (n, n)).tocsr() + sparse.identity(n) * 4
    u, _ = cg(A, np.full(n, 1.0 / (ppu * ppu)), rtol=1e-4, maxiter=4000)
    h = np.zeros(f.shape, np.float32)
    h[inside] = 2 * np.sqrt(np.maximum(u, 0))
    return cap * np.tanh(h / cap) + 0.16 * h

MESH = int(os.environ.get('WHOOPS_MESH', '130'))     # mesh points per world unit
TEX = MESH * 3
print('fields'); fm, fb, fp = (field(b, MESH) for b in (main, back, pale))
print('inflate'); hm, hb, hp = inflate(fm, MESH, 0.34), inflate(fb, MESH, 0.2), inflate(fp, MESH, 0.2)
z = np.maximum.reduce([hm + 0.35 * hb, hb, hp])
print('masks'); masks = np.stack([alpha(field(b, TEX)) for b in (main, back, pale)] + [np.ones((int(round((Y1 - Y0) * TEX)), int(round((X1 - X0) * TEX))), np.float32)], -1)

# ---- scene ------------------------------------------------------------------------------------
sc = rig.reset()
gh, gw = z.shape
xs = X0 + (np.arange(gw) + 0.5) / MESH; ys = Y0 + (np.arange(gh) + 0.5) / MESH
co = np.empty((gh, gw, 3), np.float32); co[..., 0] = xs[None, :]; co[..., 1] = ys[:, None]; co[..., 2] = z
me = bpy.data.meshes.new('wall')
me.vertices.add(gh * gw); me.vertices.foreach_set('co', co.ravel())
i = (np.arange(gh - 1)[:, None] * gw + np.arange(gw - 1)[None, :]).ravel()
quads = np.stack([i, i + 1, i + gw + 1, i + gw], -1).astype(np.int32)
me.loops.add(quads.size); me.loops.foreach_set('vertex_index', quads.ravel())
me.polygons.add(len(quads)); me.polygons.foreach_set('loop_start', np.arange(0, quads.size, 4, dtype=np.int32))
me.polygons.foreach_set('loop_total', np.full(len(quads), 4, np.int32))
me.polygons.foreach_set('use_smooth', np.ones(len(quads), bool))
uv = me.uv_layers.new(name='uv')
uvs = np.stack([((np.arange(gw) + 0.5) / gw)[None, :].repeat(gh, 0), ((np.arange(gh) + 0.5) / gh)[:, None].repeat(gw, 1)], -1).reshape(-1, 2)
uv.data.foreach_set('uv', uvs[quads.ravel()].astype(np.float32).ravel())
me.update(calc_edges=True)
wall = bpy.data.objects.new('wall', me); sc.collection.objects.link(wall)

img = bpy.data.images.new('masks', masks.shape[1], masks.shape[0], alpha=True, float_buffer=True)
img.colorspace_settings.name = 'Non-Color'
img.pixels.foreach_set(masks.ravel()); img.pack()

m, n, l, b = rig.material('ink')
tex = n.new('ShaderNodeTexImage'); tex.image = img; tex.interpolation = 'Cubic'; tex.extension = 'EXTEND'
sep = n.new('ShaderNodeSeparateColor'); l.new(tex.outputs['Color'], sep.inputs['Color'])
# the wall: dark tiles, two near tones, so the gloss has something to slide over
tc = n.new('ShaderNodeTexCoord'); chk = n.new('ShaderNodeTexChecker'); chk.inputs['Scale'].default_value = 5.0
mp = n.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1, (Y1 - Y0) / (X1 - X0), 1)
l.new(tc.outputs['UV'], mp.inputs['Vector']); l.new(mp.outputs['Vector'], chk.inputs['Vector'])
chk.inputs['Color1'].default_value = (*rig.hexrgb('#1a030c'), 1); chk.inputs['Color2'].default_value = (*rig.hexrgb('#290616'), 1)
c = chk.outputs['Color']
c = rig.mix_color(n, l, sep.outputs['Green'], c, rig.hexrgb('#b3124e'))
c = rig.mix_color(n, l, sep.outputs['Blue'], c, rig.hexrgb('#ff8fb8'))
c = rig.mix_color(n, l, sep.outputs['Red'], c, rig.hexrgb('#ff2a75'))
l.new(c, b.inputs['Base Color'])
anyink = n.new('ShaderNodeMath'); anyink.operation = 'MAXIMUM'; any2 = n.new('ShaderNodeMath'); any2.operation = 'MAXIMUM'
l.new(sep.outputs['Red'], anyink.inputs[0]); l.new(sep.outputs['Green'], anyink.inputs[1])
l.new(anyink.outputs[0], any2.inputs[0]); l.new(sep.outputs['Blue'], any2.inputs[1])
rr = n.new('ShaderNodeMapRange'); l.new(any2.outputs[0], rr.inputs['Value'])
rr.inputs['To Min'].default_value = 0.5; rr.inputs['To Max'].default_value = 0.06
l.new(rr.outputs['Result'], b.inputs['Roughness'])
l.new(any2.outputs[0], b.inputs['Coat Weight']); b.inputs['Coat Roughness'].default_value = 0.02
me.materials.append(m)

# light: a hard window up and left for the wet glint, a pink kick from low right, a dim violet room
rig.area('key', (-7.5, 8.5, 5.0), 3.2, 3600, look_at=(-0.3, 1.2, 0), size_y=5.0)
rig.area('kick', (6, -5, 3.0), 4.0, 700, rgb=(1.0, 0.45, 0.8), look_at=(0, -1, 0))
rig.area('top', (0.5, 9, 2.2), 6.0, 500, rgb=(0.8, 0.85, 1.0), look_at=(0, 1, 0), size_y=1.2)
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.10, 0.02, 0.14, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6

cam = bpy.data.cameras.new('cam'); cam.sensor_fit = 'VERTICAL'; cam.sensor_height = 36; cam.lens = 70
co_ = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co_); sc.camera = co_
tilt = math.radians(float(os.environ.get('WHOOPS_TILT', '9')))
dist = 70 * 8.4 / 36 * 0.985
co_.location = (0.0, -math.sin(tilt) * dist - 0.12, math.cos(tilt) * dist); co_.rotation_euler = (tilt, 0, 0)
rig.render(OUT)
