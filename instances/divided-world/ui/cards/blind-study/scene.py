"""Blind Study card art: it hides a post's reaction totals from everyone. A clipboard whose bar chart
is tied over with a blindfold, and on the bench in front of it four reaction faces, each blindfolded too, each with
a question mark where its count would be."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('BLIND_STUDY_SEED', '1')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#1c0802'), (0.45, '#a8380c'), (0.6, '#e8701c'), (1.0, '#5a1c06')])
G = -0.55
rig.floor(G, rig.checker('bench', '#3a1204', '#a8400f', 70, rough=0.12))

cloth = rig.plastic('blindfold', rig.hexrgb('#1c1430'), rough=0.55)
fold = rig.plastic('blindfold-fold', rig.hexrgb('#3a2c5c'), rough=0.5)
ink = rig.plastic('ink', rig.hexrgb('#2a1206'), rough=0.4)
chrome = rig.plastic('chrome', (1.0, 0.93, 0.85), rough=0.06, metallic=1.0)
FACES = ['#ffd21c', '#ff3a2a', '#3ddc5a', '#3aa0ff']                 # grin, angry, neutral, yawn

# ---- the clipboard ---------------------------------------------------------------------------------
BW, BH = 2.9, 3.3
board = rig.plastic('board', rig.hexrgb('#c8641c'), rough=0.3, coat=0.6)
paper = rig.plastic('paper', rig.hexrgb('#fff4e2'), rough=0.35)
clip = [rig.slab('board', rig.rrect(BW, BH, 0.16), -0.07, 0.07, board, 0.03),
        rig.slab('paper', rig.rrect(BW - 0.4, BH - 0.5, 0.05), -0.1, -0.06, paper, 0.01),
        rig.slab('clip', rig.rrect(1.2, 0.34, 0.08), -0.2, -0.08, chrome, 0.03),
        rig.slab('clip-top', rig.rrect(0.55, 0.42, 0.12), -0.16, -0.06, chrome, 0.03)]
clip[1].location = (0, 0, -0.12); clip[2].location = (0, 0, BH / 2 - 0.2); clip[3].location = (0, 0, BH / 2 + 0.02)
Z0 = -1.2                                                            # the chart's baseline
clip.append(rig.tube('axis', [(-1.02, -0.11, 0.95), (-1.02, -0.11, Z0), (1.05, -0.11, Z0)], 0.03, ink, res=4))
for k, (hx, h) in enumerate(zip(FACES, (1.3, 1.95, 1.05, 1.6))):
    h += rnd.uniform(-0.12, 0.12)
    clip.append(rig.slab('bar', rig.rrect(0.36, h, 0.03, 2), -0.17, -0.09, rig.plastic(f'bar{k}', rig.hexrgb(hx), rough=0.45), 0.015))
    clip[-1].location = (-0.72 + 0.48 * k, 0, Z0 + 0.04 + h / 2)
# the blindfold: a band right round the board, over the top of every bar, knotted at one side
B0, B1 = Z0 + 0.9, 0.98
clip.append(rig.slab('band', rig.rrect(BW + 0.16, B1 - B0, 0.1), -0.24, 0.12, cloth, 0.05)); clip[-1].location = (0, 0, (B0 + B1) / 2)
for dz in (-0.2, 0.02, 0.22):
    clip.append(rig.tube('crease', [(-BW / 2, -0.25, (B0 + B1) / 2 + dz), (0.0, -0.26, (B0 + B1) / 2 + dz * 0.7), (BW / 2, -0.25, (B0 + B1) / 2 + dz * 0.2)], 0.022, fold, res=3))
K = Vector((BW / 2 + 0.12, -0.12, (B0 + B1) / 2 - 0.05))
clip.append(rig.ball(tuple(K), 0.26, cloth, 'knot', 24, scale=(0.9, 0.8, 1.1)))
for ang, ln in ((-52, 1.25), (-78, 1.0)):
    a = math.radians(ang)
    o = rig.slab('tail', [(0, 0.16), (ln, 0.24), (ln - 0.12, 0.0), (ln, -0.24), (0, -0.16)], -0.04, 0.04, cloth, 0.02)
    o.location = tuple(K); o.rotation_euler = (0, -a, 0); clip.append(o)
C = Vector((-0.15, 1.0, 2.8))
rig.group(clip, loc=tuple(C), rot=(-7, -5, 14))

# ---- the four reactions, blindfolded, and the counts nobody gets ------------------------------------
R = 0.56
q = rig.plastic('question', rig.hexrgb('#fff4e2'), rough=0.1, coat=1.0, emit=0.5)
tooth = rig.plastic('tooth', (1.0, 1.0, 0.96), rough=0.1, coat=1.0)
def reaction(k, x, hx):
    c = Vector((x, -1.2 + 0.25 * abs(k - 1.5), G + R))
    skin = rig.plastic(f'face{k}', rig.hexrgb(hx), rough=0.08, coat=1.0)
    def face(fx, fz, lift=0.0):
        return c + Vector((fx, -math.sqrt(max(0.0, R * R - fx * fx - fz * fz)) - lift, fz))
    parts = [rig.ball(tuple(c), R, skin, 'face', 48)]
    Rb = R + 0.035
    rig.lathe('band', [(Rb * math.cos(a), Rb * math.sin(a)) for a in (math.radians(2 + 26 * j / 8) for j in range(9))], cloth, tuple(c), seg=48)
    rig.ball(tuple(c + Vector((Rb * 0.95, 0.12, R * 0.26))), 0.11, cloth, 'knot', 12)
    if k == 0:                                                       # a grin, teeth showing
        rig.tube('grin', [tuple(face(-0.3 + 0.6 * t, -0.2 - 0.14 * math.sin(math.pi * t), -0.01)) for t in (j / 16 for j in range(17))], 0.085, ink, res=6)
        rig.tube('teeth', [tuple(face(-0.2 + 0.4 * t, -0.2 - 0.12 * math.sin(math.pi * t), 0.06)) for t in (j / 10 for j in range(11))], 0.04, tooth, res=5)
    elif k == 1:                                                     # angry: a scowl, and brows over the band
        rig.tube('scowl', [tuple(face(-0.24 + 0.48 * t, -0.32 + 0.12 * math.sin(math.pi * t), 0.0)) for t in (j / 16 for j in range(17))], 0.05, ink, res=6)
        for sx in (-1, 1):
            rig.tube('brow', [tuple(face(sx * 0.08, 0.3, 0.05)), tuple(face(sx * 0.36, 0.45, 0.05))], 0.055, ink, res=6)
    elif k == 2:                                                     # neutral: a flat line
        rig.tube('flat', [tuple(face(-0.22 + 0.44 * t, -0.24, 0.0)) for t in (j / 8 for j in range(9))], 0.05, ink, res=6)
    else:                                                            # a yawn: wide open
        rig.ball(tuple(face(0.0, -0.24, -0.03)), 0.17, ink, 'yawn', 24, scale=(0.9, 0.5, 1.25))
    rig.text('?', 0.58, q, (c.x, c.y, c.z + R + 0.42), depth=0.07, bevel=0.02, rot=(0, math.radians(rnd.uniform(-10, 10)), 0))
for k, x in enumerate((-1.95, -0.65, 0.65, 1.95)):
    reaction(k, x, FACES[k])

rig.area('key', (-6, -9, 7), 4.0, 2400, rgb=(1.0, 0.95, 0.9), look_at=(0, 0, 1))
rig.area('strip', (5, -8, 2), 1.2, 700, look_at=(0, 0, 0.5), size_y=6.0)
rig.area('rim', (6, 6, 5), 4.0, 2600, rgb=(1.0, 0.6, 0.25), look_at=tuple(C), glossy=False)
rig.world((0.35, 0.14, 0.05), 0.7)
rig.camera(60, elev=7, target=(0, 0, 0.5))
rig.render(OUT)
