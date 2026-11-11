"""Bluff card art exploration, after the placeholder art.svg: a card held face down in a gloved hand, in smoke."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('BLUFF_SEED', '5')))
sc = rig.reset()
rig.backdrop(16, [(0.0, '#0c0302'), (0.5, '#3a0d08'), (1.0, '#120403')])
rig.floor(-3.6, rig.checker('floor', '#1c0604', '#33100a', 30, rough=0.07))
C = Vector((0, 0, 1.1))

# ---- the card, back out: a lattice, a ring, and the question it will never answer ----------------
W, HH = 2.3, 3.3
back = rig.plastic('back', rig.hexrgb('#8a1606'), rough=0.4)
trim = rig.plastic('trim', rig.hexrgb('#ff6a2a'), rough=0.15, coat=1.0, emit=0.5)
line = rig.plastic('lattice', rig.hexrgb('#b8401c'), rough=0.2, emit=0.25)
parts = [rig.slab('edge', rig.rrect(W, HH, 0.2), -0.05, 0.05, trim, 0.03),
         rig.slab('back', rig.rrect(W - 0.2, HH - 0.2, 0.12), -0.075, -0.02, back, 0.012)]
iw, ih = (W - 0.36) / 2, (HH - 0.36) / 2
for s in (1, -1):                                                 # diagonals both ways, cut to the card
    c = -(iw + ih)
    while c <= iw + ih:
        x0, x1 = max(-iw, c - ih), min(iw, c + ih)                # the line z = s * (c - x), inside the box
        if x1 - x0 > 0.05:
            parts.append(rig.tube('lattice', [(x0, -0.08, s * (c - x0)), (x1, -0.08, s * (c - x1))], 0.012, line, res=2))
        c += 0.3
parts.append(rig.cone((0, -0.075, 0.25), (0, -0.1, 0.25), 0.62, 0.62, trim, 64))
parts.append(rig.cone((0, -0.1, 0.25), (0, -0.115, 0.25), 0.52, 0.52, back, 64))
parts.append(rig.text('?', 0.95, trim, (0, -0.115, 0.25), depth=0.04, bevel=0.012))
# the glove: four fingers over the bottom edge, the hand behind
glove = rig.plastic('glove', (0.012, 0.01, 0.012), rough=0.22, coat=1.0)
zb = -HH / 2
for i in range(4):
    x = -0.52 + i * 0.36; tip = 0.5 - abs(i - 1.3) * 0.07
    parts.append(rig.tube('finger', [(x, 0.35, zb - 0.25), (x, -0.02, zb - 0.22), (x, -0.2, zb - 0.02), (x * 1.02, -0.22, zb + tip * 0.6), (x * 1.04, -0.2, zb + tip)], 0.15, glove, res=8))
parts.append(rig.ball((0.0, 0.45, zb - 0.45), 0.8, glove, 'palm', 40, scale=(1.0, 0.5, 0.75)))
parts.append(rig.tube('cuff', [(0.0, 0.5, zb - 1.0), (0.1, 0.9, zb - 6.0)], 0.5, glove, res=10))
rig.group(parts, loc=C, rot=(-6, -22, -9))

# ---- the smoke it is played in: soft balls of it, lit from inside -------------------------------
for i in range(34):
    a = rnd.uniform(0, math.tau); d = rnd.uniform(1.0, 2.6); y = rnd.uniform(0.9, 3.2)
    tone = rnd.choice(['#c8402a', '#e0552f', '#a8301f', '#ff7a4a'])
    rig.ball(C + Vector((math.cos(a) * d * 1.05, y, math.sin(a) * d * 0.95 - 0.2)), rnd.uniform(0.55, 1.15),
             rig.plastic('smoke', rig.hexrgb(tone), rough=0.9, emit=0.12), 'smoke', 28)
for x, z, s in ((-2.2, 3.4, 0.05), (2.3, 2.8, 0.04), (2.0, -1.2, 0.05), (-2.3, -0.6, 0.035), (1.2, 3.7, 0.03)):   # embers
    rig.ball((x, 0.5, z), s, trim, 'ember', 12)

lamp = bpy.data.lights.new('inside', 'POINT'); lamp.energy = 1800; lamp.color = (1.0, 0.45, 0.2); lamp.shadow_soft_size = 0.8
lo = bpy.data.objects.new('inside', lamp); sc.collection.objects.link(lo); lo.location = C + Vector((0, 1.2, 0.2))
rig.area('key', (-6, -9, 7), 4.0, 1500, look_at=tuple(C))
rig.area('edge', (6, 2, 3), 3.0, 2500, rgb=(1.0, 0.5, 0.25), look_at=tuple(C))
rig.area('strip', (-1, -8, 3), 1.0, 600, look_at=tuple(C), size_y=7.0)
rig.world((0.1, 0.03, 0.02), 0.6)
rig.camera(60, elev=5)
rig.render(OUT)
