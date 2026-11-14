"""Kick Me card art: a post with a KICK ME sign taped to it, and somebody's boot on the way up to it. (The card hangs the sign
on one's own post for 3 days, and the first three Salty casts on it are refunded to their casters.)"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
rig.backdrop(18, [(0.0, '#1a0503'), (0.45, '#7a1c0e'), (0.8, '#f0803c'), (1.0, '#3a0c06')]).scale.x = 60
G = -3.4
rig.floor(G, rig.checker('floor', '#2a0906', '#8a2814', 40, rough=0.1))

# ---- the post: a board post's box, with an avatar and lines of words --------------------------------
card = rig.plastic('post', rig.hexrgb('#cfd6de'), rough=0.35)
grey = rig.plastic('words', rig.hexrgb('#9aa6b4'), rough=0.5)
post = [rig.slab('post', rig.rrect(4.6, 3.3, 0.22), -0.06, 0.06, card, 0.03),
        rig.slab('avatar', rig.rrect(0.75, 0.75, 0.12), -0.1, -0.06, rig.plastic('avatar', rig.hexrgb('#d24a2c'), rough=0.3), 0.015)]
post[1].location = (-1.7, 0, 1.05)
for k, wide in enumerate((2.6, 3.0, 2.2, 3.9, 3.4, 3.7, 1.8)):
    z = 1.2 - 0.3 * k if k < 2 else 0.75 - 0.33 * k
    x0 = -1.1 if k < 2 else -2.05
    o = rig.slab('line', rig.rrect(wide, 0.13, 0.06, 3), -0.085, -0.06, grey, 0.0); o.location = (x0 + wide / 2, 0, z); post.append(o)
rig.group(post, loc=(0.05, 1.0, 1.75), rot=(-4, -8, 5))

# ---- the sign: a sheet of paper in marker, taped on at its top corners -----------------------------
paper = rig.plastic('paper', rig.hexrgb('#fff6c8'), rough=0.6)
marker = rig.plastic('marker', rig.hexrgb('#c8102a'), rough=0.35)
tape = rig.glow('tape', (1.0, 0.95, 0.7), 0.5, alpha=0.45)
sign = [rig.slab('sign', rig.rrect(2.7, 2.15, 0.04, 2), -0.012, 0.012, paper, 0.0),
        rig.text('KICK', 0.86, marker, (0, -0.03, 0.42), depth=0.008, bevel=0.002),
        rig.text('ME', 0.98, marker, (0, -0.03, -0.5), depth=0.008, bevel=0.002)]
for sx in (-1, 1):
    t = rig.slab('tape', rig.rrect(0.75, 0.26, 0.02, 1), -0.03, -0.018, tape, 0.0); t.location = (sx * 1.25, 0, 1.0); t.rotation_euler.y = math.radians(sx * 38); sign.append(t)
rig.group(sign, loc=(0.35, 0.3, 1.75), rot=(2, -6, -9))    # hung clear of the post's face, turned the way the post is

# ---- the boot: a leg swung from a hip up off the card's left, the toe about to arrive ---------------
leather = rig.plastic('leather', rig.hexrgb('#5a2a14'), rough=0.3, coat=0.7)
sole = rig.plastic('sole', (0.02, 0.018, 0.016), rough=0.5)
brass = rig.plastic('brass', rig.hexrgb('#ffc21c'), rough=0.2, metallic=1.0)
denim = rig.plastic('denim', rig.hexrgb('#27508a'), rough=0.7)
UPPER = [(-1.1, 0.0), (1.15, 0.0), (1.5, 0.1), (1.66, 0.4), (1.56, 0.74), (1.15, 0.98), (0.6, 1.05), (0.26, 1.35), (0.16, 2.45), (-1.0, 2.45), (-1.08, 0.5)]
SOLE = [(-1.2, -0.42), (-0.5, -0.42), (-0.45, -0.22), (1.3, -0.22), (1.68, -0.1), (1.76, 0.06), (-1.2, 0.06)]
def soft(o):
    """Round a slab off: the old trick of subdividing the surface."""
    md = o.modifiers.new('soft', 'SUBSURF'); md.levels = md.render_levels = 2
    for f in o.data.polygons: f.use_smooth = True
    return o
boot = [soft(rig.slab('upper', UPPER, -0.48, 0.48, leather, 0.2)), soft(rig.slab('sole', SOLE, -0.54, 0.54, sole, 0.06)),
        rig.ball((1.02, 0, 0.5), 0.56, leather, 'toe', 40, scale=(1.2, 0.86, 0.9)),
        rig.cone((-0.42, 0, 2.2), (-0.42, 0, 2.75), 0.62, 0.66, rig.plastic('cuff', rig.hexrgb('#f2e2c0'), rough=0.6), 40),
        rig.cone((-0.42, 0, 2.6), (-0.42, 0, 9.0), 0.6, 0.8, denim, 40)]              # the leg, away up to the hip
for k in range(5):                       # eyelets up the front, and the lace between them
    x, z = 0.3 - 0.02 * k, 1.25 + 0.22 * k
    boot.append(rig.ball((x, -0.46, z), 0.06, brass, 'eyelet', 12))
    boot.append(rig.tube('lace', [(x, -0.48, z), (x - 0.25, -0.52, z + 0.1), (x - 0.02, -0.48, z + 0.22)], 0.025, rig.plastic('lace', rig.hexrgb('#f2e2c0'), rough=0.6), res=3))
HIP = Vector((-3.6, -1.0, 2.4)); REACH = 5.0; AT = math.radians(-44)     # the leg's pivot, its length, and where on its swing the boot is
foot = HIP + Vector((math.cos(AT), 0, math.sin(AT))) * REACH
rig.group(boot, loc=tuple(foot), rot=(0, math.degrees(AT) - 90 + 90 - 4, -14), scale=0.6)   # shin toward the hip, toe along the swing
swing = rig.glow('swing', rig.hexrgb('#ffd27a'), 2.5, alpha=0.6)
for r, w, back in ((REACH - 0.35, 0.03, 30), (REACH + 0.05, 0.045, 38), (REACH + 0.45, 0.03, 30)):   # the arc the foot has come up through, about the hip
    rig.tube('swing', [tuple(HIP + Vector((math.cos(a), 0, math.sin(a))) * r + Vector((0, 0.5, 0))) for a in (AT - math.radians(9 + back * j / 20) for j in range(21))], w, swing, res=2)

LOOK = (0, 0, 0.5)
rig.area('key', (-5, -9, 7), 4.0, 1500, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 600, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2200, rgb=(1.0, 0.7, 0.3), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 450, rgb=(1.0, 0.85, 0.75), look_at=LOOK)
rig.world((0.12, 0.04, 0.02), 0.7)
rig.camera(50)
rig.render(OUT)
