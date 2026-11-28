"""Heads Will Roll card art: emoji heads as glossy balls rolling across a starfield, the largest a sun with smaller
ones in orbit, a few strays rolling loose with trails behind them."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('HEADS_SEED', '7')))
sc = rig.reset()
rig.backdrop(26, [(0.0, '#05030c'), (0.5, '#2a0e2c'), (0.8, '#120824'), (1.0, '#04020a')])
rig.world((0.02, 0.01, 0.04), 0.4)

# ---- the starfield ---------------------------------------------------------------------------------
for i in range(260):
    big = rnd.random() < 0.08
    y = rnd.uniform(8, 20)
    k = (y + 14) / 14                      # the visible half-width grows with depth
    x, z = rnd.uniform(-2.9, 2.9) * k, rnd.uniform(-4.5, 4.5) * k
    r = (rnd.uniform(0.03, 0.055) if big else rnd.uniform(0.008, 0.026)) * k
    tint = rnd.choice([(1, 1, 1), (1, 0.9, 0.7), (0.75, 0.85, 1), (1, 0.7, 0.6)])
    rig.ball((x, y, z), r, rig.glow('star', tint, rnd.uniform(5, 14)), 'star', 8)

# ---- the heads: a ball with a face on it, built at radius 1 facing the camera ------------------------
black = rig.plastic('ink', (0.01, 0.005, 0.005), rough=0.15, coat=0.6)
white = rig.plastic('teeth', (0.95, 0.95, 0.92), rough=0.1, coat=1.0)
pink = rig.plastic('tongue', rig.hexrgb('#ff5a7a'), rough=0.2, coat=0.5)
lens = rig.plastic('lens', (0.0, 0.0, 0.0), rough=0.05, coat=1.0)

def on(x, z, lift=0.0):
    """The point on the unit sphere's face at (x, z), pushed out by `lift`."""
    y = -math.sqrt(max(0.02, 1 - x * x - z * z))
    return (x * (1 + lift), y * (1 + lift), z * (1 + lift))

def arc(f, a, b, n=14, r=0.05):
    pts = [on(*f(a + (b - a) * k / n), 0.0) for k in range(n + 1)]
    return rig.tube('mouth', pts, r, black, res=4)

def face(kind, mat):
    parts = [rig.ball((0, 0, 0), 1.0, mat, 'head', 48)]
    eyes = lambda x, z, sx=0.09, sz=0.15: parts.append(rig.ball(on(x, z, 0.0), 1.0, black, 'eye', 16, scale=(sx, 0.05, sz)))
    if kind == 'smile':
        eyes(-0.3, 0.25); eyes(0.3, 0.25); parts.append(arc(lambda t: (0.42 * t, -0.22 - 0.2 * (1 - t * t)), -1, 1))
    elif kind == 'shock':
        eyes(-0.3, 0.3, 0.1, 0.2); eyes(0.3, 0.3, 0.1, 0.2); parts.append(rig.ball(on(0, -0.35), 1.0, black, 'mouth', 16, scale=(0.17, 0.06, 0.24)))
    elif kind == 'grin':
        eyes(-0.3, 0.26); eyes(0.3, 0.26)
        parts.append(rig.ball(on(0, -0.28), 1.0, black, 'mouth', 20, scale=(0.5, 0.06, 0.28)))
        parts.append(rig.ball(on(0, -0.12, 0.0), 1.0, white, 'teeth', 12, scale=(0.4, 0.05, 0.07)))
    elif kind == 'cool':
        for sx in (-1, 1):
            parts.append(rig.ball(on(sx * 0.3, 0.24, 0.0), 1.0, lens, 'lens', 16, scale=(0.24, 0.06, 0.17)))
        parts.append(rig.tube('bridge', [on(-0.12, 0.27), on(0.12, 0.27)], 0.04, lens, res=3))
        parts.append(arc(lambda t: (0.4 * t, -0.2 - 0.17 * (1 - t * t)), -1, 1))
    elif kind == 'angry':
        eyes(-0.28, 0.2); eyes(0.28, 0.2)
        parts.append(rig.tube('brow', [on(-0.5, 0.52), on(-0.1, 0.38)], 0.06, black, res=4)); parts.append(rig.tube('brow', [on(0.5, 0.52), on(0.1, 0.38)], 0.06, black, res=4))
        parts.append(arc(lambda t: (0.36 * t, -0.42 + 0.14 * (1 - t * t)), -1, 1))
    elif kind == 'tongue':
        eyes(-0.3, 0.25); eyes(0.3, 0.25); parts.append(arc(lambda t: (0.42 * t, -0.2 - 0.18 * (1 - t * t)), -1, 1))
        parts.append(rig.ball(on(0.1, -0.5, 0.0), 1.0, pink, 'tongue', 16, scale=(0.14, 0.06, 0.2)))
    return parts

def head(kind, loc, r, mat, turn=(0, 0, 0)):
    return rig.group(face(kind, mat), loc=loc, rot=turn, scale=r)

yellow = rig.plastic('yellow', rig.hexrgb('#ffc414'), rough=0.07, coat=1.0)
orange = rig.plastic('orange', rig.hexrgb('#ff8a1c'), rough=0.07, coat=1.0)
red = rig.plastic('red', rig.hexrgb('#e8381e'), rough=0.07, coat=1.0)
lime = rig.plastic('lime', rig.hexrgb('#a6e22e'), rough=0.07, coat=1.0)
blue = rig.plastic('blue', rig.hexrgb('#46b4ff'), rough=0.07, coat=1.0)
sunmat = rig.plastic('sun', rig.hexrgb('#ffcc22'), rough=0.06, coat=1.0, emit=0.5)

# ---- the sun and what circles it ---------------------------------------------------------------------
SUN = (0.5, 0.0, 1.9)
head('smile', SUN, 1.35, sunmat, (-8, 0, -14))
halo = rig.glow('halo', (1.0, 0.7, 0.2), 1.0, alpha=0.02)
for cr in (1.6, 1.9, 2.3):
    rig.ball((SUN[0], SUN[1] + 0.6, SUN[2]), cr, halo, 'corona', 48)
ring = rig.glow('ring', (1.0, 0.8, 0.45), 2.0, alpha=0.35)
def orbit(rx, rz, tilt, n=96):
    pts = []
    for k in range(n + 1):
        a = math.tau * k / n; x, z = math.cos(a) * rx, math.sin(a) * rz
        pts.append((SUN[0] + x * math.cos(tilt) - z * math.sin(tilt), SUN[1] + math.sin(a) * 0.9, SUN[2] + x * math.sin(tilt) + z * math.cos(tilt)))
    return pts
for rx, rz, tilt in ((2.4, 0.95, -0.35), (3.1, 1.4, 0.2)):
    rig.tube('orbit', orbit(rx, rz, tilt), 0.012, ring, res=2)
def at(rx, rz, tilt, a):
    return orbit(rx, rz, tilt, 360)[int(a) % 360]
for kind, mat, rx, rz, tilt, a, r in (('smile', orange, 2.4, 0.95, -0.35, 60, 0.5), ('shock', blue, 2.4, 0.95, -0.35, 200, 0.38), ('cool', lime, 3.1, 1.4, 0.2, 120, 0.46),
                                      ('angry', red, 3.1, 1.4, 0.2, 285, 0.34), ('tongue', yellow, 3.1, 1.4, 0.2, 215, 0.27)):
    head(kind, at(rx, rz, tilt, a), r, mat, (rnd.uniform(-25, 25), rnd.uniform(-20, 20), rnd.uniform(-30, 30)))

# ---- strays rolling across the field, a trail behind each --------------------------------------------
def stray(kind, mat, loc, r, vx, vz, spin):
    head(kind, loc, r, mat, spin)
    pts = [(loc[0] - vx * t, loc[1] + 0.05 * t, loc[2] - vz * t + 0.05 * t * t) for t in (0.0, 0.8, 1.6, 2.4, 3.2)]
    rig.tube('trail', pts[0:5], r * 0.07, rig.glow('trail', (1.0, 0.55, 0.25), 1.2, alpha=0.18), res=3)
stray('shock', red, (-2.1, -1.2, -1.2), 0.62, -0.5, 0.18, (10, 15, 25))
stray('cool', blue, (2.5, -1.3, -0.5), 0.5, 0.55, 0.25, (-5, -25, -20))
stray('smile', lime, (-1.1, 0.4, -2.9), 0.38, -0.6, -0.1, (0, 25, 10))
stray('grin', orange, (1.4, 0.2, -2.4), 0.33, 0.55, -0.15, (0, -15, 30))
stray('tongue', yellow, (3.2, 3.0, 2.8), 0.2, 0.0, 0.4, (0, -20, 0))

# ---- light ---------------------------------------------------------------------------------------------
rig.area('key', (-5, -9, 6), 3.0, 2800, rgb=(1.0, 0.95, 0.88), look_at=(0, 0, 1))
rig.area('fill', (6, -8, -2), 4.0, 1200, rgb=(0.55, 0.65, 1.0), look_at=(0, 0, 0), glossy=False)
rig.area('rim', (6, 6, 4), 4.0, 2500, rgb=(1.0, 0.4, 0.2), look_at=(0, 0, 1), glossy=False)
sl = bpy.data.lights.new('sun', 'POINT'); sl.energy = 1400; sl.color = (1.0, 0.8, 0.5); sl.shadow_soft_size = 0.6
so = bpy.data.objects.new('sun', sl); sc.collection.objects.link(so); so.location = (SUN[0], SUN[1] - 3.2, SUN[2] + 0.6)
rig.camera(60, fstop=None, elev=0, target=(0, 0, 0))
rig.render(OUT)
