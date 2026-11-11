"""4D Chess card art: a face-down counter-play, you wanted them to play that card on you. Three glass
chess boards in tiers over an endless checker floor, a few turned pieces, and a glowing tesseract above the game."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector, Euler
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('FOURD_CHESS_SEED', '4')))
sc = rig.reset()
rig.backdrop(26, [(0.0, '#14020c'), (0.47, '#e03a80'), (0.56, '#5a0c30'), (1.0, '#16020e')])
G = -3.3
rig.floor(G, rig.checker('floor', '#1c030e', '#8c1648', 64, rough=0.12))

def glass(name, rgb, rough=0.02):
    m, n, l, b = rig.material(name)
    b.inputs['Base Color'].default_value = (*rgb, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Transmission Weight'].default_value = 1.0; b.inputs['IOR'].default_value = 1.45
    return m

clear = glass('glass', (1.0, 0.86, 0.93))
tile = rig.plastic('tile', rig.hexrgb('#ff2f7f'), rough=0.06, coat=1.0)
chrome = rig.plastic('chrome', (0.95, 0.9, 0.95), rough=0.04, metallic=1.0)
ivory = rig.plastic('ivory', rig.hexrgb('#fff0f6'), rough=0.08, coat=1.0)
rose = rig.plastic('rose', rig.hexrgb('#c8105a'), rough=0.08, coat=1.0)

# ---- three boards, stepped up and back like a stair ------------------------------------------------
N, SQ = 4, 0.62
BOARDS = [Vector((0.6, -1.1, -1.45)), Vector((0.0, 0.1, 0.0)), Vector((-0.6, 1.3, 1.45))]
def square(b, i, j):
    """The top of square (i, j) on board b."""
    return BOARDS[b] + Vector(((i - (N - 1) / 2) * SQ, (j - (N - 1) / 2) * SQ, 0.09))
for b, c in enumerate(BOARDS):
    rig.box('board', N * SQ + 0.12, N * SQ + 0.12, 0.08, clear, tuple(c), bevel=0.02)
    for i in range(N):
        for j in range(N):
            if (i + j) % 2 == 0:
                p = square(b, i, j); rig.box('tile', SQ - 0.03, SQ - 0.03, 0.025, tile, (p.x, p.y, p.z - 0.01), bevel=0.008)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = c.x + sx * (N * SQ / 2 + 0.02), c.y + sy * (N * SQ / 2 + 0.02)
            rig.cone((x, y, G), (x, y, c.z + 0.14), 0.04, 0.04, chrome, 16); rig.ball((x, y, c.z + 0.16), 0.075, chrome, 'knob', 16)

# ---- the pieces: lathe-turned, chunky --------------------------------------------------------------
def king(p, mat, s=1.0):
    parts = [rig.lathe('king', [(0.22, 0), (0.22, 0.06), (0.14, 0.12), (0.09, 0.34), (0.08, 0.6), (0.15, 0.66), (0.15, 0.71), (0.08, 0.75), (0.13, 0.9), (0.0, 0.92)], mat, seg=32),
             rig.box('cross', 0.07, 0.07, 0.3, mat, (0, 0, 0.9), bevel=0.01), rig.box('cross', 0.24, 0.07, 0.07, mat, (0, 0, 1.03), bevel=0.01)]
    return rig.group(parts, loc=tuple(p), scale=s)
def pawn(p, mat, s=1.0):
    parts = [rig.lathe('pawn', [(0.18, 0), (0.18, 0.05), (0.11, 0.1), (0.06, 0.3), (0.11, 0.34), (0.05, 0.38), (0.0, 0.38)], mat, seg=32), rig.ball((0, 0, 0.47), 0.12, mat, 'pawn', 24)]
    return rig.group(parts, loc=tuple(p), scale=s)
def knight(p, mat, s=1.0, turn=0.0):
    head = rig.slab('knight', [(-0.13, 0.12), (0.14, 0.12), (0.09, 0.32), (0.03, 0.44), (0.22, 0.4), (0.27, 0.52), (0.12, 0.66), (0.03, 0.78), (-0.05, 0.7), (-0.14, 0.52), (-0.16, 0.3)], -0.08, 0.08, mat, 0.03)
    parts = [rig.lathe('knight', [(0.2, 0), (0.2, 0.06), (0.14, 0.12), (0.12, 0.17), (0.0, 0.17)], mat, seg=32), head]
    return rig.group(parts, loc=tuple(p), rot=(0, 0, turn), scale=s)
S = 1.25
king(square(2, 3, 2), chrome, S * 1.1)
pawn(square(2, 2, 0), rose, S); pawn(square(2, 0, 0), ivory, S)
knight(square(1, 2, 1), ivory, S * 1.1, turn=-20)
pawn(square(1, 0, 2), rose, S); pawn(square(1, 3, 3), chrome, S)
king(square(0, 2, 2), rose, S); pawn(square(0, 0, 1), ivory, S); knight(square(0, 3, 0), chrome, S, turn=200)

# ---- the tesseract: a cube in a cube, every corner tied to its twin --------------------------------
T = Vector((-0.95, 1.2, 3.2)); A, B = 0.58, 0.25
wire = rig.glow('wire', rig.hexrgb('#3fe0ff'), 3.5); inner = rig.glow('wire-in', rig.hexrgb('#c8f8ff'), 4.0)
R = Euler((math.radians(24 + rnd.uniform(-4, 4)), math.radians(14), math.radians(33 + rnd.uniform(-6, 6))), 'XYZ').to_matrix()
corners = [Vector((sx, sy, sz)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
at = lambda v, h: tuple(T + R @ (v * h))
for i, u in enumerate(corners):
    rig.tube('tie', [at(u, A), at(u, B)], 0.022, wire, res=3)
    rig.ball(at(u, A), 0.06, inner, 'node', 12); rig.ball(at(u, B), 0.04, inner, 'node', 12)
    for v in corners[i + 1:]:
        if (u - v).length < 2.01:
            rig.tube('edge', [at(u, A), at(v, A)], 0.035, wire, res=4); rig.tube('edge', [at(u, B), at(v, B)], 0.028, inner, res=4)
tl = bpy.data.lights.new('tesseract', 'POINT'); tl.energy = 500; tl.color = (0.7, 0.95, 1.0); tl.shadow_soft_size = 0.4
to = bpy.data.objects.new('tesseract', tl); sc.collection.objects.link(to); to.location = T

rig.area('key', (-6, -9, 7), 4.0, 2600, look_at=(0, 0, 0))
rig.area('strip', (5, -7, 2), 1.0, 900, look_at=(0, 0, 0), size_y=7.0)
rig.area('rim', (5, 7, 5), 4.0, 3000, rgb=(1.0, 0.45, 0.75), look_at=(0, 0, 0.5), glossy=False)
rig.world((0.2, 0.03, 0.11), 0.7)
rig.camera(60, elev=15, target=(0, 0, 0.35))
rig.render(OUT)
