"""Overreaction, a Minus World spell, as a 90s render. Its icon's alt text: "a Godzilla sized :^) emoji sits in
the midst of a destroyed metropolis. It has unknowingly tipped skyscrapers with its immense size. Smoke from the
leveled buildings sits behind it"."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('OVERREACTION_SEED', '5')))
sc = rig.reset()
rig.backdrop(22, [(0.0, '#ffd23a'), (0.42, '#ffc02a'), (0.5, '#ff8a2a'), (0.6, '#c8321c'), (1.0, '#7a1420')])
G = -3.5
rig.floor(G, rig.plastic('street', rig.hexrgb('#2a1228'), rough=0.5))
R = 2.75; C = Vector((0.0, 3.0, G + R - 0.25))        # the emoji: sat down in the middle of town

skin = rig.plastic('face', rig.hexrgb('#f2b8b0'), rough=0.35)
ink = rig.plastic('ink', rig.hexrgb('#3a1626'), rough=0.3, coat=1.0)
rig.ball(C, R, skin, 'face', 96)
def face(x, z, lift=0.0):
    k = max(0.0, R * R - x * x - z * z)
    return C + Vector((x, -math.sqrt(k) - lift, z))
for sx in (-1, 1):                                               # :  two upright eyes
    rig.ball(face(sx * 0.62 - 0.25, 1.0, -0.05), 0.27, ink, 'eye', 32, scale=(0.62, 0.35, 1.45))
rig.cone(face(0.15, 0.2, -0.1), face(0.15, 0.2) + Vector((1.45, -1.25, -0.5)), 0.46, 0.0, skin, 48)        # ^  the nose
rig.tube('smile', [face(-1.7 + 3.2 * t, -0.35 - 0.95 * math.sin(math.pi * t) ** 0.8 + 0.3 * t, 0.03) for t in (j / 40 for j in range(41))], 0.065, ink, res=6)   # )

# ---- the smoke of what it flattened, standing behind it -------------------------------------------
SMOKE = ['#8a4a3a', '#a05c44', '#6a3a34', '#b06a48']
for cx in (-3.9, 0.6, 4.2):                                      # three columns, with the sunset between them
    for k in range(11):
        t = k / 10
        rig.ball((cx + rnd.uniform(-0.35, 0.35) + 0.9 * t, C.y + rnd.uniform(3.0, 4.5), G + 0.5 + 9.5 * t + rnd.uniform(-0.3, 0.3)), 0.6 + 0.75 * t + rnd.uniform(-0.1, 0.1),
                 rig.plastic('smoke', rig.hexrgb(rnd.choice(SMOKE)), rough=0.95), 'smoke', 24)

# ---- the metropolis: towers knocked off true, one flat on its side, rubble between ----------------
lit = rig.glow('window', rig.hexrgb('#ffe27a'), 2.2)
unlit = rig.plastic('window-dark', rig.hexrgb('#4a2a4a'), rough=0.3)
def tower(x, y, w, d, h, tone, cols, rows, lean=(0, 0, 0), crack=False, dark=0.3):
    """A block with its lights on, built upright on its foot and then tipped: lean is degrees about x, y and z."""
    wall = rig.plastic('wall', rig.hexrgb(tone), rough=0.6); parts = [rig.box('tower', w, d, h, wall, (0, 0, 0))]
    for c in range(cols):
        for r in range(rows):
            wz = h - 0.35 - r * 0.52
            if wz < 0.2: continue
            o = rig.slab('window', rig.rrect(w / cols * 0.5, 0.28, 0.02), -0.02, 0.02, unlit if rnd.random() < dark else lit, 0.004)
            o.location = (-w / 2 + w * (c + 0.5) / cols, -d / 2 - 0.01, wz); parts.append(o)
    if crack:
        parts.append(rig.tube('crack', [(0.1, -d / 2 - 0.02, h - 0.2), (-0.1, -d / 2 - 0.02, h - 0.6), (0.2, -d / 2 - 0.02, h - 0.95), (0.0, -d / 2 - 0.02, h - 1.5), (0.3, -d / 2 - 0.02, h - 1.9)], 0.022,
                              rig.plastic('crack', rig.hexrgb('#2a1228'), rough=0.6), res=3))
    return rig.group(parts, loc=(x, y, G), rot=lean)
tower(-2.0, 1.0, 1.3, 1.2, 5.4, '#8a5674', 3, 10, lean=(-6, -13, 0), crack=True)      # shouldered aside, to the left
tower(2.05, 1.3, 1.2, 1.2, 5.0, '#7a4a6a', 2, 9, lean=(-4, 16, 0))                      # and to the right
tower(2.2, -0.8, 1.3, 1.0, 2.6, '#9a6480', 3, 5, lean=(8, 10, 6), crack=True)
tower(-2.3, -0.9, 1.2, 1.0, 2.1, '#a06a84', 3, 4, lean=(10, -12, -5), dark=0.55)
tower(-1.9, -1.9, 1.0, 0.9, 3.3, '#8a5674', 2, 6, lean=(0, 84, 8), dark=0.7)           # this one is down, lying across the street
tower(1.1, -2.2, 1.3, 1.0, 1.1, '#6a4062', 3, 2, lean=(5, -7, 10), crack=True, dark=0.5)
rubble = [rig.plastic('rubble', rig.hexrgb(h), rough=0.7) for h in ('#8a5674', '#6a4062', '#a06a84')]
for i in range(46):
    s = rnd.uniform(0.1, 0.38)
    o = rig.box('rubble', s, s * rnd.uniform(0.6, 1.2), s * rnd.uniform(0.5, 1.0), rnd.choice(rubble), (rnd.uniform(-3.0, 3.0), rnd.uniform(-3.4, 0.2), G), bevel=0.01)
    o.rotation_euler = (rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0, 3))
for x, y in ((-2.6, -2.4), (2.7, -2.6)):                           # dust still hanging over the nearest wreckage
    for k in range(4):
        rig.ball((x + rnd.uniform(-0.3, 0.3), y + rnd.uniform(-0.3, 0.3), G + 0.2 + 0.28 * k), 0.22 + 0.06 * k, rig.plastic('dust', rig.hexrgb('#b08a84'), rough=0.95), 'dust', 16)

rig.area('sun', (-7, -6, 5), 5.0, 3200, rgb=(1.0, 0.75, 0.5), look_at=tuple(C))
rig.area('city', (-5, -9, 2), 5.0, 900, rgb=(1.0, 0.8, 0.7), look_at=(0, 0, -2))
rig.area('rim', (6, 8, 3), 5.0, 5000, rgb=(1.0, 0.5, 0.2), look_at=tuple(C), glossy=False)
rig.world((0.5, 0.22, 0.12), 0.6)
rig.camera(60, elev=5, target=(0, 0, 0.0))
rig.render(OUT)
