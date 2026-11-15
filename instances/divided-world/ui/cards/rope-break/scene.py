"""Rope Break card art: a taped hand come up from the mat and closed round the bottom rope, which is all a wrestler
needs to make the hold stop. (The card springs on the first Salty common cast on its post and catches it.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('ROPE_SEED', '7')))
sc = rig.reset()
rig.backdrop(22, [(0.0, '#03141a'), (0.45, '#0b4f63'), (0.78, '#7fe3f2'), (1.0, '#062a36')]).scale = (80, 50, 1)
for i in range(40):                      # the crowd's flashbulbs
    hx = rnd.choice(['#ffffff', '#d0f4ff', '#7fe3f2', '#fff1c0'])
    rig.ball((rnd.uniform(-18, 18), rnd.uniform(17, 21), rnd.uniform(-4, 8)), rnd.uniform(0.15, 0.5), rig.glow('flash', rig.hexrgb(hx), rnd.uniform(0.6, 2.5), alpha=0.5), 'flash', 16)
G = -3.2
m, n, l, b = rig.material('mat'); b.inputs['Base Color'].default_value = (*rig.hexrgb('#2a9fb8'), 1); b.inputs['Roughness'].default_value = 0.5
rig.box('ring', 40, 14, 0.6, m, (0, 0, G - 0.6), bevel=0.08)       # we are at ringside, looking in over the apron

def smooth(pts, passes=3):
    """Round an open path's corners, keeping its ends."""
    pts = [Vector(p) for p in pts]
    for _ in range(passes):
        out = [pts[0]]
        for a, c in zip(pts, pts[1:]): out += [a * 0.75 + c * 0.25, a * 0.25 + c * 0.75]
        pts = out + [pts[-1]]
    return [tuple(p) for p in pts]
ZR = 1.55                                # the bottom rope, where the hand has it
rope = rig.plastic('rope', rig.hexrgb('#f0fcff'), rough=0.45)
rig.tube('rope', smooth([(-14, 0, ZR + 0.75), (-3, 0, ZR + 0.16), (0, 0, ZR), (3, 0, ZR + 0.16), (14, 0, ZR + 0.75)], 4), 0.15, rope, res=6)
for z, hx in ((ZR + 2.2, '#7fe3f2'), (ZR + 4.0, '#f0fcff')):       # the two above it, out of reach
    rig.tube('rope', [(-14, 0.2, z), (14, 0.2, z)], 0.15, rig.plastic('rope', rig.hexrgb(hx), rough=0.45), res=6)

# ---- the hand: seen from the back, four fingers over the rope and the thumb hooked under it --------
skin = rig.plastic('skin', rig.hexrgb('#e8a070'), rough=0.4, coat=0.2)
tape = rig.plastic('tape', rig.hexrgb('#fbf6ec'), rough=0.6)
band = rig.plastic('band', rig.hexrgb('#2ee6ff'), rough=0.7)
for k, x in enumerate((-0.54, -0.18, 0.18, 0.54)):
    reach = (0.0, 0.07, 0.05, -0.06)[k]  # the middle fingers come over a little further
    path = smooth([(x, -0.5, ZR - 0.62), (x, -0.5, ZR - 0.05), (x, -0.36, ZR + 0.36 + reach), (x, 0.02, ZR + 0.45 + reach), (x, 0.34, ZR + 0.22), (x, 0.36, ZR - 0.12)])
    rig.tube('finger', path, 0.175, skin, res=6)
    rig.ball((x, -0.5, ZR - 0.05), 0.2, skin, 'knuckle', 20)
    rig.tube('tape', smooth([(x, -0.5, ZR - 0.5), (x, -0.5, ZR - 0.24)], 1), 0.185, tape, res=6)   # each finger taped at its root
rig.tube('thumb', smooth([(-0.55, -0.55, ZR - 1.0), (-1.02, -0.5, ZR - 0.62), (-1.0, -0.3, ZR - 0.3), (-0.72, -0.08, ZR - 0.24)]), 0.2, skin, res=6)
rig.ball((0, -0.52, ZR - 0.92), 0.78, skin, 'palm', 40, scale=(1.0, 0.42, 0.78))
WRIST = Vector((0.05, -0.55, ZR - 1.55))
rig.cone(tuple(WRIST + Vector((0, 0, 0.25))), tuple(WRIST + Vector((0.5, -0.5, -5.5))), 0.5, 0.95, skin, 40)
rig.cone(tuple(WRIST + Vector((0, 0, 0.3))), tuple(WRIST + Vector((0.06, -0.06, -0.55))), 0.56, 0.6, band, 40)   # a sweatband
for k in range(3):                       # tape round the wrist under it
    rig.cone(tuple(WRIST + Vector((0.07 + 0.03 * k, -0.07 - 0.03 * k, -0.6 - 0.3 * k))), tuple(WRIST + Vector((0.1 + 0.03 * k, -0.1 - 0.03 * k, -0.9 - 0.3 * k))), 0.6 + 0.02 * k, 0.63 + 0.02 * k, tape, 40)

gold = rig.glow('star', rig.hexrgb('#fff1a0'), 3.0)
for x, z, r, turn in ((-1.9, 2.6, 0.34, 0.2), (1.7, 2.9, 0.26, -0.3), (2.2, 1.0, 0.2, 0.5), (-2.3, 0.9, 0.18, 0.1)):   # the relief of it
    o = rig.slab('star', rig.star(4, r, r * 0.3, turn), -0.02, 0.02, gold, 0.0); o.location = (x, -0.4, z)
sweat = rig.plastic('sweat', rig.hexrgb('#d8f4ff'), rough=0.02, coat=1.0, emit=0.5)
for x, z in ((-1.2, 0.5), (1.15, 0.75), (1.45, 0.2)):
    rig.ball((x, -0.6, z), 0.1, sweat, 'sweat', 20, scale=(1, 1, 1.5))

LOOK = (0, 0, 1.0)
rig.area('key', (-5, -9, 7), 4.0, 1900, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 500, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2400, rgb=(0.5, 0.92, 1.0), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 450, rgb=(0.85, 0.97, 1.0), look_at=LOOK)
rig.world((0.02, 0.06, 0.1), 0.7)
rig.camera(50)
rig.render(OUT)
