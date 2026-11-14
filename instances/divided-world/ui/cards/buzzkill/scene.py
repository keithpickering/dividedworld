"""Buzzkill card art: a bug zapper burning blue in the dark, and a bee in a party hat on its way over to see what
the light is. (The card ends one Gimmick that is up on its target.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('BUZZ_SEED', '5')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#01030a'), (0.5, '#061a36'), (0.8, '#12447a'), (1.0, '#020814')]).scale.x = 60
G = -3.6
rig.floor(G, rig.checker('floor', '#02080f', '#0c2c4c', 40, rough=0.1))

# ---- the zapper: a lantern of bars round two burning tubes, hung by a chain -----------------------
Z = Vector((0.7, 0.4, 1.6))              # its middle
dark = rig.plastic('case', (0.03, 0.035, 0.045), rough=0.25, coat=0.6)
steel = rig.plastic('steel', (0.75, 0.8, 0.88), rough=0.12, metallic=1.0)
tube = rig.glow('tube', rig.hexrgb('#4fa8ff'), 5.0)
RC, HC = 1.0, 1.25                       # the cage's radius, and half its height
rig.lathe('cap', [(0.0, 0.0), (RC + 0.12, 0.0), (RC + 0.14, 0.12), (RC * 0.8, 0.4), (RC * 0.3, 0.62), (0.0, 0.66)], dark, tuple(Z + Vector((0, 0, HC))))
rig.lathe('foot', [(0.0, -0.3), (RC * 0.7, -0.3), (RC + 0.12, -0.12), (RC + 0.12, 0.0), (0.0, 0.0)], dark, tuple(Z + Vector((0, 0, -HC))))
for j in range(20):
    a = math.tau * j / 20
    rig.tube('bar', [tuple(Z + Vector((math.cos(a) * RC, math.sin(a) * RC, -HC))), tuple(Z + Vector((math.cos(a) * RC, math.sin(a) * RC, HC)))], 0.025, steel, res=3)
for z in (-HC * 0.5, 0.0, HC * 0.5):
    rig.tube('hoop', [tuple(Z + Vector((math.cos(a) * RC, math.sin(a) * RC, z))) for a in (math.tau * j / 48 for j in range(49))], 0.025, steel, res=3)
for sx in (-1, 1):
    rig.cone(tuple(Z + Vector((sx * 0.3, 0, -HC + 0.1))), tuple(Z + Vector((sx * 0.3, 0, HC - 0.1))), 0.14, 0.14, tube, 24)
lamp = bpy.data.lights.new('zap', 'POINT'); lamp.energy = 1500; lamp.color = (0.35, 0.7, 1.0); lamp.shadow_soft_size = 0.3
o = bpy.data.objects.new('zap', lamp); sc.collection.objects.link(o); o.location = Z
HOOK = Z + Vector((0, 0, HC + 0.66))
for k in range(9):                       # the chain, link by link, up out of the picture
    bpy.ops.mesh.primitive_torus_add(major_radius=0.13, minor_radius=0.03, major_segments=20, minor_segments=8, location=tuple(HOOK + Vector((0, 0, 0.1 + 0.2 * k))), rotation=(math.radians(90), 0, math.radians(90 * (k % 2))))
    bpy.context.object.scale = (0.8, 1.2, 1); bpy.ops.object.shade_smooth(); bpy.context.object.data.materials.append(steel)
bolt = rig.glow('bolt', rig.hexrgb('#e8f6ff'), 9.0)
for k in range(5):                       # it is already crackling
    a = rnd.uniform(0, math.tau); p = Z + Vector((math.cos(a) * RC, math.sin(a) * RC * 0.3 - 0.9, rnd.uniform(-0.9, 0.9))); pts = [tuple(p)]
    for j in range(4):
        p = p + Vector((math.cos(a) * 0.22 + rnd.uniform(-0.15, 0.15), 0, rnd.uniform(-0.25, 0.25))); pts.append(tuple(p))
    rig.tube('bolt', pts, 0.022, bolt, res=2)

# ---- the bee: stripes, wings, a party hat, not a care ---------------------------------------------
yellow = rig.plastic('bee', rig.hexrgb('#ffc21c'), rough=0.25, coat=0.6)
black = rig.plastic('stripe', (0.01, 0.01, 0.012), rough=0.3, coat=0.5)
white = rig.plastic('white', (0.95, 0.97, 1.0), rough=0.1, coat=1.0)
wing = rig.glow('wing', (0.85, 0.95, 1.0), 0.9, alpha=0.35)
RB = 0.62
bee = [rig.ball((0, 0, 0), RB, yellow, 'body', 40, scale=(1.35, 1, 1))]
for x in (-0.42, -0.08, 0.26):           # stripes: slices just proud of the body
    bee.append(rig.ball((x, 0, 0), RB * math.sqrt(1 - (x / (1.35 * RB)) ** 2) * 1.03, black, 'stripe', 32, scale=(0.3, 1, 1)))
bee.append(rig.cone((-0.78, 0, 0), (-1.12, 0, -0.05), 0.1, 0.0, black, 16))                  # the sting
bee.append(rig.ball((0.92, 0, 0.12), 0.46, yellow, 'head', 32))
for sy in (-1, 1):
    bee.append(rig.ball((1.2, sy * 0.2, 0.22), 0.17, white, 'eye', 24)); bee.append(rig.ball((1.33, sy * 0.21, 0.23), 0.08, black, 'pupil', 16))
    bee.append(rig.tube('feeler', [(1.05, sy * 0.15, 0.5), (1.25, sy * 0.25, 0.85), (1.45, sy * 0.28, 0.9)], 0.02, black, res=3))
    w = rig.ball((-0.1, sy * 0.35, 0.75), 0.5, wing, 'wing', 24, scale=(0.7, 0.12, 1.25)); w.rotation_euler = (math.radians(sy * 38), math.radians(-18), 0); bee.append(w)
bee.append(rig.tube('smile', [(1.28, -0.12, -0.02), (1.36, 0, -0.08), (1.28, 0.12, -0.02)], 0.022, black, res=3))
hat = rig.plastic('hat', rig.hexrgb('#e86fa8'), rough=0.3, coat=0.5)
bee.append(rig.cone((0.85, 0, 0.5), (0.7, 0, 1.3), 0.3, 0.0, hat, 24))
for t in (0.3, 0.6):                     # the hat's stripes, and its pom
    bee.append(rig.cone((0.85 - 0.15 * t, 0, 0.5 + 0.8 * t), (0.85 - 0.15 * (t + 0.1), 0, 0.5 + 0.8 * (t + 0.1)), 0.3 * (1 - t) + 0.01, 0.3 * (0.9 - t) + 0.01, rig.plastic('hat-b', rig.hexrgb('#fff1a0'), rough=0.3), 24))
bee.append(rig.ball((0.69, 0, 1.34), 0.1, white, 'pom', 16))
BEE = Vector((-1.25, -1.2, -0.85))
rig.group(bee, loc=tuple(BEE), rot=(0, -24, 12), scale=0.85)
dash = rig.glow('dash', rig.hexrgb('#fff1a0'), 1.5, alpha=0.7)
path = lambda t: Vector((-4.2 + 2.6 * t, -1.2, -2.8 + 1.6 * t + 0.6 * math.sin(t * 5.5)))    # the way it came, wandering
for k in range(8):
    rig.tube('dash', [tuple(path(k / 8 + j * 0.016)) for j in range(5)], 0.03, dash, res=2)
for i in range(34):                      # confetti off the party it left
    hx = rnd.choice(['#e86fa8', '#ffc21c', '#3fb8e8', '#6fd86a', '#ffffff'])
    o = rig.slab('confetti', rig.rrect(0.14, 0.08, 0.01, 1), -0.004, 0.004, rig.plastic('confetti', rig.hexrgb(hx), rough=0.4, emit=0.3), 0.0)
    o.location = (rnd.uniform(-2.6, 0.2), rnd.uniform(-1.8, 0.5), rnd.uniform(-3.2, 0.6)); o.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))

LOOK = (0, 0, 0.6)
rig.area('key', (-5, -9, 5), 4.0, 900, look_at=tuple(BEE))
rig.area('rim', (5, 6, 6), 4.0, 1200, rgb=(0.3, 0.6, 1.0), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 250, rgb=(0.8, 0.9, 1.0), look_at=LOOK)
rig.world((0.01, 0.03, 0.07), 0.5)
rig.camera(50)
rig.render(OUT)
