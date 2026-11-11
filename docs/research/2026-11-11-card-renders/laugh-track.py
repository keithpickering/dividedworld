"""Laugh Track card art exploration: a sitcom studio seen from behind the back row. Two rows of seats and
round heads in silhouette face a lit LAUGH sign on its chains, with the reel-to-reel that does the laughing beside it."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('LAUGH_TRACK_SEED', '2')))
sc = rig.reset()

# ---- the studio's back curtain -------------------------------------------------------------------
drape = rig.plastic('drape', rig.hexrgb('#d05a10'), rough=0.6)
for k in range(-14, 15):
    rig.cone((k * 0.75, 7.0 + 0.2 * (k % 2), -9), (k * 0.75, 7.0 + 0.2 * (k % 2), 9), 0.45, 0.45, drape, 20)

# ---- the sign: a lit box on two chains, raised letters on its face -------------------------------
S = Vector((-0.55, 3.0, 3.0))
frame = rig.plastic('frame', rig.hexrgb('#2a0c04'), rough=0.3, coat=1.0)
brass = rig.plastic('brass', rig.hexrgb('#ffc24a'), rough=0.15, metallic=1.0)
o = rig.slab('frame', rig.rrect(3.7, 1.6, 0.2), -0.25, 0.25, frame, 0.06); o.location = S
o = rig.slab('lit', rig.rrect(3.35, 1.25, 0.12), -0.3, -0.24, rig.glow('lit', rig.hexrgb('#ffb21c'), 5.0), 0.02); o.location = S
rig.text('LAUGH', 1.0, rig.plastic('letters', rig.hexrgb('#5a0c04'), rough=0.2, coat=1.0), tuple(S + Vector((0, -0.34, 0.0))), depth=0.07, bevel=0.015)
bulb = rig.glow('bulb', rig.hexrgb('#fff2c0'), 9.0)
for j in range(12):
    for z in (-0.72, 0.72):
        rig.ball(tuple(S + Vector((-1.68 + 3.36 * j / 11, -0.3, z))), 0.055, bulb, 'bulb', 12)
for sx in (-1, 1):
    for j in range(16):                                          # chain: links seen edge on and face on by turns
        rig.ball(tuple(S + Vector((sx * 1.4, 0, 0.88 + 0.17 * j))), 0.075, brass, 'link', 12, scale=(1.0 if j % 2 else 0.45, 0.45 if j % 2 else 1.0, 1.3))
sl = bpy.data.lights.new('sign', 'POINT'); sl.energy = 1500; sl.color = (1.0, 0.62, 0.2); sl.shadow_soft_size = 0.6
so = bpy.data.objects.new('sign', sl); sc.collection.objects.link(so); so.location = S + Vector((0, -1.3, -0.2))

# ---- the tape machine: two reels over a panel of meters, on a cart -------------------------------
T = Vector((2.0, 2.6, 0.2))
steel = rig.plastic('steel', rig.hexrgb('#d8c0a8'), rough=0.25, metallic=0.7)
black = rig.plastic('black', rig.hexrgb('#1a0a06'), rough=0.3)
tape = rig.plastic('tape', rig.hexrgb('#5a2408'), rough=0.3)
rig.box('deck', 1.7, 0.7, 2.3, steel, tuple(T), bevel=0.06)
rig.box('cart', 1.3, 0.6, 4.2, black, tuple(T + Vector((0, 0.1, -4.2))), bevel=0.03)
FY = T.y - 0.36
for sx in (-1, 1):
    c = Vector((T.x + sx * 0.4, FY, T.z + 1.65))
    rig.cone(tuple(c), tuple(c + Vector((0, -0.05, 0))), 0.33 if sx < 0 else 0.25, 0.33 if sx < 0 else 0.25, tape, 40)
    rig.cone(tuple(c + Vector((0, -0.05, 0))), tuple(c + Vector((0, -0.09, 0))), 0.37, 0.37, steel, 40)
    spin = rnd.uniform(0, 2)
    for j in range(3):
        a = spin + j * math.tau / 3
        rig.ball(tuple(c + Vector((math.cos(a) * 0.2, -0.09, math.sin(a) * 0.2))), 0.1, black, 'hole', 16, scale=(1, 0.2, 1))
    rig.ball(tuple(c + Vector((0, -0.1, 0))), 0.06, brass, 'hub', 16)
    rig.tube('tape', [tuple(c + Vector((sx * -0.1, -0.03, -0.3))), (T.x + sx * 0.12, FY - 0.03, T.z + 0.95)], 0.02, tape, res=3)
rig.box('head', 0.4, 0.12, 0.22, black, (T.x, FY, T.z + 0.85), bevel=0.03)
for sx in (-1, 1):
    o = rig.slab('meter', rig.rrect(0.5, 0.3, 0.04), -0.03, 0.03, rig.glow('meter', rig.hexrgb('#ffd87a'), 3.0), 0.01); o.location = (T.x + sx * 0.4, FY, T.z + 0.5)
    rig.tube('needle', [(T.x + sx * 0.4, FY - 0.04, T.z + 0.39), (T.x + sx * 0.4 + 0.14, FY - 0.04, T.z + 0.6)], 0.012, black, res=3)
for j in range(4):
    rig.cone((T.x - 0.54 + 0.36 * j, FY, T.z + 0.17), (T.x - 0.54 + 0.36 * j, FY - 0.08, T.z + 0.17), 0.09, 0.08, black if j else rig.plastic('rec', rig.hexrgb('#ff2a1c'), rough=0.2, emit=1.5), 20)

# ---- the audience: two rows of seat backs and round heads, seen from behind ----------------------
seat = rig.plastic('seat', rig.hexrgb('#4a100a'), rough=0.45)
head = rig.plastic('head', rig.hexrgb('#1c0a06'), rough=0.4)
def row(y, z_top, pitch, off, r):
    for k in range(-3, 4):
        x = k * pitch + off
        o = rig.slab('seat', rig.rrect(pitch * 0.9, 3.0, 0.3), -0.14, 0.14, seat, 0.08); o.location = (x, y, z_top - 1.5)
        hr = r * rnd.uniform(0.9, 1.08); hz = z_top + hr * 0.75 + rnd.uniform(-0.08, 0.12)
        rig.ball((x + rnd.uniform(-0.1, 0.1), y - 0.5, hz), hr, head, 'head', 32)
        style = rnd.choice(['none', 'bun', 'cap', 'none', 'tuft'])
        if style == 'bun': rig.ball((x, y - 0.5, hz + hr * 1.05), hr * 0.42, head, 'bun', 20)
        if style == 'cap': rig.ball((x, y - 0.45, hz + hr * 0.5), hr * 1.02, seat, 'cap', 24, scale=(1.05, 1.05, 0.6))
        if style == 'tuft':
            for a in (-0.4, 0.0, 0.4): rig.cone((x, y - 0.5, hz + hr * 0.8), (x + a * 0.5, y - 0.5, hz + hr * 1.35), hr * 0.16, 0.0, head, 12)
row(1.2, -0.75, 1.5, 0.75, 0.52)
row(-1.6, -2.0, 1.55, 0.0, 0.56)

rig.area('rim', (0, 5.5, 7), 5.0, 2600, rgb=(1.0, 0.55, 0.2), look_at=(0, 0, -1.0), glossy=False)
rig.area('back', (0, -9, 4), 6.0, 260, rgb=(1.0, 0.6, 0.4), look_at=(0, 0, -1.5))
rig.area('deck', (5, -4, 3), 2.5, 500, rgb=(1.0, 0.8, 0.6), look_at=tuple(T + Vector((0, 0, 1.2))))
rig.world((0.2, 0.06, 0.02), 0.5)
rig.camera(60)
rig.render(OUT)
