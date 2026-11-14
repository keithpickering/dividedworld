"""Whoopee Cushion card art: the cushion itself, mid-squeeze, letting go a small cloud out of its nozzle, with the noise
spelled out under it. (The card springs on the first common cast on its post, lets it land, and pays the setter a
share of what it draws.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('CUSHION_SEED', '2')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#1a0503'), (0.45, '#8a2412'), (0.8, '#f59a3c'), (1.0, '#3a0c06')]).scale.x = 60
G = -2.4
rig.floor(G, rig.checker('floor', '#2a0906', '#8a2814', 40, rough=0.1))

rubber = rig.plastic('rubber', rig.hexrgb('#f0452c'), rough=0.3, coat=0.5)
dark = rig.plastic('rubber-dark', rig.hexrgb('#a8200f'), rough=0.35, coat=0.3)
parts = [rig.lathe('cushion', [(0.0, -0.2), (1.25, -0.2), (1.68, -0.12), (1.86, 0.0), (1.68, 0.14), (1.25, 0.3), (0.6, 0.4), (0.0, 0.43)], rubber)]
for j in range(44):                      # the crimped seam round its edge
    a = math.tau * j / 44
    parts.append(rig.ball((math.cos(a) * 1.9, math.sin(a) * 1.9, 0.0), 0.1, dark, 'crimp', 12, scale=(1, 1, 0.6)))
star = rig.slab('star', rig.star(5, 0.62, 0.27), -0.03, 0.03, dark, 0.02); star.rotation_euler.x = math.radians(90); star.location = (0, 0, 0.42); parts.append(star)
NA = math.radians(-72)                   # the nozzle, in the cushion's own plane
out = Vector((math.cos(NA), math.sin(NA), 0))
parts.append(rig.cone(tuple(out * 1.7), tuple(out * 2.55), 0.26, 0.17, rubber, 32))
parts.append(rig.cone(tuple(out * 2.5), tuple(out * 2.75), 0.17, 0.33, dark, 32))
cushion = rig.group(parts, loc=(-0.45, 0, 2.0), rot=(64, 0, 8), scale=0.8)
bpy.context.view_layer.update()
MOUTH = cushion.matrix_world @ (out * 2.8); BLOW = (cushion.matrix_world.to_3x3() @ out).normalized()

puff = rig.plastic('puff', rig.hexrgb('#dff2a8'), rough=0.9, emit=0.04)       # the cloud, greener than is polite
for i in range(18):
    t = (i / 17) ** 0.8; d = 0.15 + 0.95 * t; spread = 0.06 + 0.3 * t
    p = MOUTH + BLOW * d + Vector((rnd.uniform(-spread, spread), rnd.uniform(-spread, spread), rnd.uniform(-spread, spread) + 0.55 * t * t))
    rig.ball(tuple(p), 0.1 + 0.17 * t * rnd.uniform(0.7, 1.2), puff, 'puff', 24)
gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.2, metallic=0.8, emit=0.15)
for ch, x, z, tilt in (('P', -1.5, -1.6, 14), ('F', -0.75, -1.85, 5), ('F', 0.0, -1.95, -3), ('F', 0.75, -1.85, -8), ('T', 1.5, -1.6, -16)):
    rig.text(ch, 1.05, gold, (x, -0.8, z), depth=0.14, bevel=0.03, rot=(0, math.radians(tilt), 0))

LOOK = (0, 0, 0.8)
rig.area('key', (-5, -9, 7), 4.0, 2000, look_at=LOOK)
rig.area('window', (4.5, -7, 3), 1.0, 700, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2200, rgb=(1.0, 0.7, 0.3), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 400, rgb=(1.0, 0.85, 0.75), look_at=LOOK)
rig.world((0.12, 0.04, 0.02), 0.7)
rig.camera(50, elev=6)
rig.render(OUT)
