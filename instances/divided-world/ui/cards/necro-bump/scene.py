"""Necro Bump card art: a headstone shot back up out of its own grave on a spring, an arrow cut into it under the
R.I.P., dirt still flying, a cold moon over its shoulder. (The card bumps an old post's thread to the top of its board and marks
the post "bumped" for a day.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector, Quaternion
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('BUMP_SEED', '9')))
sc = rig.reset()
rig.backdrop(22, [(0.0, '#04030c'), (0.3, '#1a1030'), (0.5, '#4a1c44'), (0.72, '#241238'), (1.0, '#0e0c24')]).scale = (260, 200, 1)
MOON = tuple(float(v) for v in os.environ.get('BUMP_MOON', '8.4 20 17.5').split())
rig.ball(MOON, 3.0, rig.glow('moon', rig.hexrgb('#e8f0ff'), 1.5), 'moon', 64, scale=(1, 0.05, 1))
G = -3.3
m, n, l, b = rig.material('ground'); b.inputs['Base Color'].default_value = (*rig.hexrgb('#1c0c08'), 1); b.inputs['Roughness'].default_value = 0.9
rig.floor(G, m)

# ---- stone: grey, pitted ---------------------------------------------------------------------------
sm, sn, sl, sb = rig.material('stone')
noise = sn.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 5.0; noise.inputs['Detail'].default_value = 8
sl.new(rig.mix_color(sn, sl, noise.outputs['Fac'], rig.hexrgb('#5a5e68'), rig.hexrgb('#b4b8c0')), sb.inputs['Base Color'])
bump = sn.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.5; sl.new(noise.outputs['Fac'], bump.inputs['Height']); sl.new(bump.outputs['Normal'], sb.inputs['Normal'])
sb.inputs['Roughness'].default_value = 0.7
def headstone(w, h):
    """An outline: straight sides and a round top."""
    return [(-w / 2, 0), (w / 2, 0)] + [(math.cos(a) * w / 2, h - w / 2 + math.sin(a) * w / 2) for a in (math.pi * j / 16 for j in range(17))]
for x, y, z, w, h, lean in ((-3.6, 9, G, 1.5, 2.4, 6), (3.9, 11, G, 1.4, 2.0, -8), (-1.2, 14, G, 1.3, 2.2, 3), (5.5, 16, G, 1.6, 2.6, 5)):   # the neighbors, staying put
    o = rig.slab('grave', headstone(w, h), -0.15, 0.15, sm, 0.04); o.location = (x, y, z); o.rotation_euler.y = math.radians(lean)

# ---- the one that came back -----------------------------------------------------------------------
cut = rig.plastic('cut', (0.03, 0.03, 0.035), rough=0.6)
hot = rig.plastic('arrow', rig.hexrgb('#ff5a1c'), rough=0.2, emit=2.2)
stone = [rig.slab('stone', headstone(2.6, 3.7), -0.3, 0.3, sm, 0.08),
         rig.text('R.I.P.', 0.62, cut, (0, -0.31, 2.75), depth=0.01, bevel=0.002),
         rig.slab('arrow', [(0, 2.25), (0.85, 1.35), (0.36, 1.35), (0.36, 0.45), (-0.36, 0.45), (-0.36, 1.35), (-0.85, 1.35)], -0.36, -0.3, hot, 0.02)]
BASE = Vector((0.05, 0, -0.75))
rig.group(stone, loc=tuple(BASE), rot=(6, -9, 0))
steel = rig.plastic('steel', (0.75, 0.78, 0.82), rough=0.15, metallic=1.0)
turns = 6.5
rig.tube('spring', [(BASE.x * (j / 260) + math.cos(j / 260 * math.tau * turns) * 0.55, math.sin(j / 260 * math.tau * turns) * 0.55, G + (BASE.z - G) * j / 260) for j in range(261)], 0.07, steel, res=5)
glow = bpy.data.lights.new('arrow', 'POINT'); glow.energy = 120; glow.color = (1.0, 0.4, 0.1); glow.shadow_soft_size = 0.4
o = bpy.data.objects.new('arrow', glow); sc.collection.objects.link(o); o.location = BASE + Vector((0, -1.2, 1.4))

dirt = rig.plastic('dirt', rig.hexrgb('#3a1c10'), rough=0.9)
for i in range(60):                      # the heap round the hole
    a = rnd.uniform(0, math.tau); d = rnd.uniform(0.75, 2.1)
    rig.ball((math.cos(a) * d * 1.25, math.sin(a) * d * 0.8, G + rnd.uniform(-0.1, 0.25) * (2.3 - d)), rnd.uniform(0.2, 0.5), dirt, 'heap', 12, scale=(1, 1, 0.7))
rig.ball((0, 0, G + 0.02), 1.0, rig.plastic('hole', (0.002, 0.001, 0.001), rough=1.0), 'hole', 32, scale=(1.1, 0.75, 0.05))
for i in range(26):                      # and what went up with the stone
    a = rnd.uniform(0, math.tau); d = rnd.uniform(0.6, 2.4)
    rig.ball((math.cos(a) * d, rnd.uniform(-1.2, 0.6), G + rnd.uniform(0.6, 3.2)), rnd.uniform(0.05, 0.16), dirt, 'clod', 10)
LOOK = (0, 0, 1.0)
rig.area('key', (-6, -7, 8), 4.0, 1500, rgb=(0.6, 0.75, 1.0), look_at=LOOK)       # moonlight
rig.area('rim', (5, 6, 7), 4.0, 2600, rgb=(0.3, 0.6, 1.0), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 220, rgb=(0.6, 0.7, 1.0), look_at=LOOK)
rig.world((0.01, 0.015, 0.04), 0.6)
cam = rig.camera(32)                     # low in the grass and tipped, looking up at it
EYE = Vector(tuple(float(v) for v in os.environ.get('BUMP_EYE', '-1.5 -7.8 -2.7').split())); AIM = Vector((0.4, 0, -0.3))
cam.location = EYE
cam.rotation_euler = ((AIM - EYE).to_track_quat('-Z', 'Y') @ Quaternion((0, 0, 1), math.radians(9))).to_euler()
rig.render(OUT)
