"""Sweet Heat card art: a swirl lollipop that has caught fire along its top edge and is burning quite happily.
(The card pays its character a flat amount for each hype and each heat vote, for 3 days.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('HEAT_SEED', '6')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#120202'), (0.45, '#5a0f08'), (0.8, '#d24a2c'), (1.0, '#1c0403')]).scale.x = 60
G = -3.6
rig.floor(G, rig.checker('floor', '#1c0403', '#6a160c', 40, rough=0.08))

# ---- the lollipop: a hard candy disc with a swirl, on a paper stick --------------------------------
candy = rig.plastic('candy', rig.hexrgb('#ff2a4a'), rough=0.05, coat=1.0, emit=0.25)
cream = rig.plastic('swirl', rig.hexrgb('#fff0f4'), rough=0.08, coat=1.0, emit=0.15)
R = 1.7
disc = rig.lathe('disc', [(0.0, -0.2), (R - 0.2, -0.2), (R, -0.08), (R, 0.08), (R - 0.2, 0.2), (0.0, 0.2)], candy); disc.rotation_euler.x = math.radians(90)
parts = [disc, rig.tube('swirl', [(math.cos(a) * r, -0.17, math.sin(a) * r) for a, r in ((0.5 + j * 0.16, 0.22 + (R - 0.4) * j / 140) for j in range(141))], 0.12, cream, res=5)]
parts.append(rig.cone((0, 0.05, -R + 0.3), (0, 0.05, -R - 4.5), 0.1, 0.1, rig.plastic('stick', rig.hexrgb('#fbf6ec'), rough=0.6), 20))
lolly = rig.group(parts, loc=(0, 0, 0.55), rot=(-6, 0, -9))
bpy.context.view_layer.update()

# ---- the fire: tongues along the top of it, yellow inside orange ----------------------------------
FLAME = [(0.0, 0.0), (0.26, 0.1), (0.4, 0.38), (0.36, 0.7), (0.22, 1.05), (0.09, 1.35), (0.0, 1.6)]
outer = rig.glow('flame', rig.hexrgb('#ff4a08'), 2.2, alpha=0.9)
inner = rig.glow('flame-core', rig.hexrgb('#ffd21c'), 2.6)
for k in range(11):
    a = math.radians(8 + 164 * k / 10 + rnd.uniform(-5, 5))
    root = lolly.matrix_world @ Vector((math.cos(a) * (R - 0.1), 0, math.sin(a) * (R - 0.1)))
    size = (0.75 + 0.75 * math.sin(a) ** 2) * rnd.uniform(0.8, 1.2)        # tallest at the crown
    lean = math.radians((90 - math.degrees(a)) * 0.35 + rnd.uniform(-8, 8))
    for mat, s, dy in ((outer, size, 0.0), (inner, size * 0.48, -0.3)):
        o = rig.lathe('flame', FLAME, mat, tuple(root + Vector((0, dy, -0.15)))); o.scale = (s, s * 0.7, s); o.rotation_euler.y = lean
for i in range(22):                      # sparks going up off it
    p = Vector((rnd.uniform(-2.3, 2.3), rnd.uniform(-0.8, 0.6), rnd.uniform(2.2, 3.6)))
    rig.ball(tuple(p), rnd.uniform(0.02, 0.06), inner, 'spark', 8)
fire = bpy.data.lights.new('fire', 'POINT'); fire.energy = 900; fire.color = (1.0, 0.5, 0.15); fire.shadow_soft_size = 0.8
o = bpy.data.objects.new('fire', fire); sc.collection.objects.link(o); o.location = (0, -1.5, 3.0)
drip = rig.plastic('drip', rig.hexrgb('#ff2a4a'), rough=0.05, coat=1.0, emit=0.3)   # and melting a little for it
for x, z, r in ((-0.9, -0.55, 0.13), (-0.35, -0.75, 0.1), (0.6, -0.7, 0.12)):
    rig.ball(tuple(lolly.matrix_world @ Vector((x, -0.1, z - R * 0.45))), r, drip, 'drip', 20, scale=(1, 1, 1.7))

LOOK = (0, 0, 1.2)
rig.area('key', (-5, -9, 6), 4.0, 1500, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 700, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2400, rgb=(1.0, 0.45, 0.15), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 350, rgb=(1.0, 0.8, 0.7), look_at=LOOK)
rig.world((0.08, 0.02, 0.01), 0.6)
rig.camera(50)
rig.render(OUT)
