"""Cheap Shot card art: a boxing glove on a spring gone straight through somebody's shield, the glass still in the
air. (While the card is up, the next Move its character casts ignores the target's Wards and can't be caught by a
Reversal.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('SHOT_SEED', '8')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#010309'), (0.45, '#0a2c50'), (0.8, '#3f8fd2'), (1.0, '#041428')]).scale.x = 60
G = -3.4
rig.floor(G, rig.checker('floor', '#03101c', '#12436e', 40, rough=0.1))
HIT = Vector((0.35, 0, 1.5))             # where the glove went through

# ---- the shield: a pane of light in a bright rim, seen nearly edge on, cracked from the middle -----
SHIELD = [(0.0, -2.1), (0.95, -1.55), (1.5, -0.6), (1.6, 1.0), (1.2, 1.55), (0.0, 1.8), (-1.2, 1.55), (-1.6, 1.0), (-1.5, -0.6), (-0.95, -1.55)]
glass = rig.glow('glass', rig.hexrgb('#7fd0ff'), 1.4, alpha=0.3)
edge = rig.glow('edge', rig.hexrgb('#d8f2ff'), 5.0)
crack = rig.glow('crack', (1, 1, 1), 4.0)
parts = [rig.slab('shield', SHIELD, -0.03, 0.03, glass, 0.0), rig.tube('rim', [(x, 0, z) for x, z in SHIELD + SHIELD[:1]], 0.07, edge, res=4)]
for k in range(11):                      # cracks out from the hole, each with a kink
    a = math.tau * k / 11 + rnd.uniform(-0.2, 0.2); far = rnd.uniform(0.9, 1.5)
    pts = [(math.cos(a + rnd.uniform(-0.25, 0.25) * (j > 0)) * far * j / 3 + 0.0, -0.04, math.sin(a + rnd.uniform(-0.25, 0.25) * (j > 0)) * far * j / 3) for j in range(4)]
    parts.append(rig.tube('crack', [(0.45 * math.cos(a), -0.04, 0.45 * math.sin(a))] + pts[1:], 0.018, crack, res=2))
shield = rig.group(parts, loc=tuple(HIT), rot=(0, 0, 58))
bpy.context.view_layer.update()
THROUGH = (shield.matrix_world.to_3x3() @ Vector((0, -1, 0))).normalized()     # the way the glove is going: out of the shield's face, toward us and right
if THROUGH.x < 0: THROUGH = -THROUGH

# ---- the glove, and the spring it rode in on ------------------------------------------------------
red = rig.plastic('glove', rig.hexrgb('#e2101c'), rough=0.18, coat=0.9)
white = rig.plastic('cuff', rig.hexrgb('#f4f0e6'), rough=0.5)
steel = rig.plastic('steel', (0.8, 0.85, 0.9), rough=0.1, metallic=1.0)
glove = [rig.ball((0.55, 0, 0.0), 0.95, red, 'fist', 48, scale=(1.15, 0.95, 1.0)),
         rig.ball((0.25, -0.15, -0.72), 0.42, red, 'thumb', 32, scale=(1.5, 0.9, 0.85)),
         rig.cone((-0.3, 0, 0), (-1.25, 0, 0), 0.72, 0.62, red, 40), rig.cone((-1.0, 0, 0), (-1.5, 0, 0), 0.66, 0.68, white, 40)]
for k in range(4):                       # its laces
    x = -0.45 - 0.15 * k
    glove.append(rig.tube('lace', [(x, -0.3, 0.63), (x - 0.12, 0, 0.72), (x, 0.3, 0.63)], 0.03, white, res=3))
coil = [(-1.5 - 3.6 * t, math.cos(t * math.tau * 7) * 0.42, math.sin(t * math.tau * 7) * 0.42) for t in (j / 220 for j in range(221))]
glove.append(rig.tube('spring', coil, 0.06, steel, res=5))
root = rig.group(glove, loc=tuple(HIT + THROUGH * 0.55))
aim = (THROUGH + Vector((0, 0, 0.22))).normalized()
root.rotation_euler = Vector((1, 0, 0)).rotation_difference(aim).to_euler()

for i in range(30):                      # what is left of the middle of the shield
    d = (THROUGH * rnd.uniform(0.3, 2.6) + Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.4, 0.4), rnd.uniform(-1.6, 1.8))))
    r = rnd.uniform(0.08, 0.3)
    o = rig.slab('shard', [(0, r), (r * rnd.uniform(0.5, 0.9), -r * 0.6), (-r * rnd.uniform(0.4, 0.9), -r * 0.4)], -0.012, 0.012, edge if i % 4 == 0 else glass, 0.0)
    o.location = HIT + d; o.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))
blue = bpy.data.lights.new('ward', 'POINT'); blue.energy = 350; blue.color = (0.4, 0.75, 1.0); blue.shadow_soft_size = 0.6
o = bpy.data.objects.new('ward', blue); sc.collection.objects.link(o); o.location = HIT + THROUGH * 0.2 + Vector((0, -1.2, 0.6))

LOOK = tuple(HIT)
rig.area('key', (-5, -9, 7), 4.0, 2000, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 700, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2400, rgb=(0.3, 0.7, 1.0), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 450, rgb=(0.8, 0.9, 1.0), look_at=LOOK)
rig.world((0.02, 0.06, 0.12), 0.7)
rig.camera(50)
rig.render(OUT)
