"""Take the Fall card art: you take a moderator's punishment in someone else's place. A giant ban
hammer swings down out of the dark; under it a small bright figure stands with its arms spread wide, and a
smaller one cowers behind it."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('TAKE_THE_FALL_SEED', '2')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#010608'), (0.42, '#0a5a70'), (0.6, '#06323e'), (1.0, '#010a0e')])
G = -1.6
rig.floor(G, rig.checker('floor', '#04222b', '#0e5a6e', 56, rough=0.1))

# ---- the hammer: its handle runs up and off to the left, its face comes down on the hero ------------
red = rig.plastic('hammer', rig.hexrgb('#ff3a2a'), rough=0.1, coat=1.0)
chrome = rig.plastic('chrome', (0.85, 0.95, 1.0), rough=0.05, metallic=1.0)
wood = rig.plastic('handle', rig.hexrgb('#06323e'), rough=0.2, coat=1.0)
HC = Vector((0.8, 0.3, 3.25))                         # the head's middle
strike = Vector((-0.6, -0.12, -0.79)).normalized()    # the way the face is travelling
grip = Vector((-0.79, 0.0, 0.61)).normalized()        # from the head back up the handle
L, HR = 1.25, 0.82
rig.cone(tuple(HC - strike * L), tuple(HC + strike * L), HR, HR, red, 64)
for s in (-1, 1):
    rig.cone(tuple(HC + strike * s * (L - 0.02)), tuple(HC + strike * s * (L + 0.22)), HR + 0.1, HR + 0.1, chrome, 64)
    rig.cone(tuple(HC + strike * s * (L + 0.22)), tuple(HC + strike * s * (L + 0.3)), HR + 0.1, HR - 0.08, chrome, 64)
    rig.cone(tuple(HC + strike * s * 0.5), tuple(HC + strike * s * 0.66), HR + 0.05, HR + 0.05, chrome, 64)
rig.cone(tuple(HC + grip * 0.3), tuple(HC + grip * 6.0), 0.24, 0.2, wood, 32)
rig.cone(tuple(HC + grip * (HR - 0.05)), tuple(HC + grip * (HR + 0.3)), 0.34, 0.3, chrome, 32)
swoosh = rig.glow('swoosh', rig.hexrgb('#7af0ff'), 1.6, alpha=0.3)
PIV = HC + grip * 7.0
for k, off in enumerate((-0.55, 0.0, 0.55)):                       # the air it came through
    pts = []
    for j in range(18):
        a = math.radians(4 + (26 - 5 * abs(k - 1)) * j / 17); v = (HC - strike * (L + 0.5) + grip * off) - PIV
        pts.append(tuple(PIV + Vector((v.x * math.cos(a) - v.z * math.sin(a), v.y, v.x * math.sin(a) + v.z * math.cos(a)))))
    rig.tube('swoosh', pts, 0.05, swoosh, res=3)

# ---- the hero: a pawn with arms, spread as wide as they go ------------------------------------------
cyan = rig.plastic('hero', rig.hexrgb('#19d8f5'), rough=0.08, coat=1.0, emit=0.1)
H = Vector((-0.45, -0.2, G)); HS = 1.2
hero = [rig.lathe('body', [(0.78, 0), (0.78, 0.12), (0.52, 0.3), (0.3, 1.3), (0.4, 1.72), (0.5, 1.88), (0.3, 2.0), (0.0, 2.0)], cyan, seg=48),
        rig.ball((0, 0, 2.42), 0.5, cyan, 'head', 48)]
for sx in (-1, 1):
    hero.append(rig.tube('arm', [(sx * 0.3, 0, 1.78), (sx * 0.85, -0.15, 1.95), (sx * 1.45, -0.3, 2.3)], 0.13, cyan, res=8))
    hero.append(rig.ball((sx * 1.5, -0.32, 2.35), 0.22, cyan, 'hand', 24))
rig.group(hero, loc=tuple(H), rot=(-6, 0, 8), scale=HS)

# ---- the one it is standing in for: smaller, ducked, hands over its head ----------------------------
soft = rig.plastic('saved', rig.hexrgb('#ffd9a0'), rough=0.2, coat=1.0)
S = Vector((1.05, 1.1, G))
small = [rig.lathe('body', [(0.7, 0), (0.7, 0.12), (0.5, 0.3), (0.36, 0.95), (0.44, 1.2), (0.3, 1.32), (0.0, 1.32)], soft, seg=48),
         rig.ball((0, -0.12, 1.62), 0.46, soft, 'head', 48)]
for sx in (-1, 1):
    small.append(rig.tube('arm', [(sx * 0.34, 0, 1.15), (sx * 0.72, -0.2, 1.6), (sx * 0.4, -0.3, 2.08)], 0.11, soft, res=8))
    small.append(rig.ball((sx * 0.34, -0.32, 2.1), 0.18, soft, 'hand', 24))
rig.group(small, loc=tuple(S), rot=(14, 0, -18), scale=0.82)

# ---- light from above, down the hammer's path -------------------------------------------------------
beam = rig.glow('beam', rig.hexrgb('#5ae0ff'), 0.6, alpha=0.04)
rig.cone((H.x, 0.6, 9), (H.x, 0.6, G), 0.5, 2.6, beam, 64)
sp = bpy.data.lights.new('spot', 'SPOT'); sp.energy = 5000; sp.spot_size = math.radians(42); sp.spot_blend = 0.4; sp.color = (0.75, 0.95, 1.0)
so = bpy.data.objects.new('spot', sp); sc.collection.objects.link(so); so.location = (H.x - 1.2, -2.5, 9)
so.rotation_euler = (Vector((H.x, 0, 0.5)) - Vector(so.location)).to_track_quat('-Z', 'Y').to_euler()
rig.area('key', (-6, -9, 5), 4.0, 2200, look_at=(0, 0, 1.5))
rig.area('hammer', (5, -8, 6), 3.0, 1400, rgb=(1.0, 0.9, 0.85), look_at=tuple(HC))
rig.area('rim', (5, 6, 4), 4.0, 2600, rgb=(0.3, 0.9, 1.0), look_at=(0, 0, 0.5), glossy=False)
rig.world((0.02, 0.09, 0.12), 0.7)
rig.camera(60, elev=5, target=(0, 0, 0.4))
rig.render(OUT)
