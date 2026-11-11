"""Publicity Tour card art exploration (the owner's idea): the red carpet seen by the one walking it, ropes
either side, the dark full of flashbulbs."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('TOUR_SEED', '8')))
sc = rig.reset()
G = -2.6                                 # the ground; the walker's eyes are 1.7 above it
rig.backdrop(70, [(0.0, '#01060c'), (0.5, '#04202e'), (1.0, '#010308')])
rig.floor(G, rig.plastic('street', rig.hexrgb('#05080c'), rough=0.2), size=200, y=40)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 28, G + 0.02))
cp = bpy.context.object; cp.scale = (3.2, 80, 1); cp.data.materials.append(rig.plastic('carpet', rig.hexrgb('#c8081c'), rough=0.75))
for sx in (-1, 1):                                               # the carpet's gold edging
    rig.tube('edging', [(sx * 1.6, -12, G + 0.03), (sx * 1.6, 68, G + 0.03)], 0.03, rig.plastic('edging', rig.hexrgb('#ffc21c'), rough=0.15, metallic=1.0), res=3)

gold = rig.plastic('post', rig.hexrgb('#ffc83a'), rough=0.08, metallic=1.0)
velvet = rig.plastic('rope', rig.hexrgb('#d0102a'), rough=0.7)
POSTS = [-4.5, -1.5, 1.8, 5.5, 9.5, 14, 19, 25, 32, 40, 50]
for sx in (-1, 1):
    x = sx * 2.05
    for y in POSTS:
        rig.cone((x, y, G), (x, y, G + 0.07), 0.26, 0.22, gold, 32)
        rig.cone((x, y, G + 0.07), (x, y, G + 1.25), 0.055, 0.055, gold, 20)
        rig.ball((x, y, G + 1.33), 0.11, gold, 'knob', 24)
    for y0, y1 in zip(POSTS, POSTS[1:]):                         # the rope hangs between each pair
        rig.tube('rope', [(x, y0 + (y1 - y0) * t, G + 1.2 - 0.38 * math.sin(math.pi * t)) for t in (j / 16 for j in range(17))], 0.055, velvet, res=6)

# ---- the crowd: shapes in the dark behind the ropes, and their cameras going off -----------------
shade = rig.plastic('crowd', rig.hexrgb('#03080d'), rough=0.9)
flash = rig.glow('flash', (1.0, 1.0, 1.0), 30.0)
halo = rig.glow('halo', rig.hexrgb('#b8f8ff'), 6.0)
for i in range(420):                                             # they stand on risers, so the dark is full of them
    sx = rnd.choice((-1, 1)); y = rnd.uniform(-2, 58); x = sx * (2.9 + rnd.uniform(0, 1) ** 1.5 * (9 + y * 0.25))
    h = rnd.uniform(1.45, 1.85) + (abs(x) - 2.9) * 0.62
    rig.ball((x, y, G + h), 0.17, shade, 'head', 12)
    rig.ball((x, y, G + h - 0.85), 0.3, shade, 'body', 12, scale=(1, 0.7, 2.6))
    if rnd.random() < 0.3:                                       # a flash: a point of light and a four-pointed glint
        p = Vector((x - sx * 0.25, y - 0.3, G + h - 0.12)); s = rnd.uniform(0.12, 0.3) * (1 + y / 30)
        rig.ball(p, 0.04 * (1 + y / 25), flash, 'flash', 8)
        o = rig.slab('glint', rig.star(4, s, s * 0.12, rnd.uniform(0, 0.3)), -0.01, 0.01, halo, 0.002); o.location = p
        if y < 14 and rnd.random() < 0.25:
            pl = bpy.data.lights.new('flash', 'POINT'); pl.energy = 60; pl.color = (0.85, 0.95, 1.0)
            po = bpy.data.objects.new('flash', pl); sc.collection.objects.link(po); po.location = p + Vector((-sx * 0.3, -0.2, 0.1))

# ---- where it leads: a lit doorway, a star over it, searchlights behind --------------------------
door = rig.glow('door', rig.hexrgb('#e6fdff'), 2.5)
o = rig.slab('door', rig.rrect(4.4, 6.5, 1.6), -0.1, 0.1, door, 0.02); o.location = (0, 62, G + 3.2)
o = rig.slab('door-star', rig.star(5, 2.0, 0.84), -0.2, 0.2, rig.glow('star', rig.hexrgb('#2ee6ff'), 6.0), 0.02); o.location = (0, 61, G + 9.6)
beam = rig.glow('beam', rig.hexrgb('#2ee6ff'), 1.0, alpha=0.05)
for x, lean in ((-14, 0.5), (15, -0.42), (-5, -0.2), (7, 0.25)):
    rig.cone((x, 58, G), (x + lean * 45, 58, G + 45), 0.3, 3.5, beam, 32)
dl = bpy.data.lights.new('door', 'AREA'); dl.energy = 9000; dl.size = 5; dl.color = (0.8, 0.97, 1.0)
do = bpy.data.objects.new('door', dl); sc.collection.objects.link(do); do.location = (0, 58, G + 4); do.rotation_euler = (math.radians(-90), 0, 0)

rig.area('walker', (0, -8, 3), 5.0, 700, rgb=(1.0, 0.95, 0.9), look_at=(0, 4, G))
rig.world((0.01, 0.03, 0.05), 0.6)
cam = rig.camera(28)
cam.location = (0, -7.5, G + 1.7); cam.rotation_euler = (math.radians(90 - 8), 0, 0)
rig.render(OUT)
