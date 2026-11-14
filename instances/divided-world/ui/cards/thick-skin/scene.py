"""Thick Skin card art: a coconut, the three marks on its shell making a face that could not care less, with darts
bouncing off it bent. (The card halves its character's losses from reactions, for 3 days.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('SKIN_SEED', '4')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#2a0618'), (0.45, '#b03a78'), (0.8, '#ffb0d4'), (1.0, '#5a1238')]).scale.x = 60
G = -3.4
rig.floor(G, rig.checker('floor', '#3a0a22', '#c04a88', 40, rough=0.1))

# ---- the coconut ----------------------------------------------------------------------------------
m, n, l, b = rig.material('shell')       # brown and stringy: stretched noise for the fibres, as color and as bump
tc = n.new('ShaderNodeTexCoord'); mp = n.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (9, 9, 0.9)
noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 3.0; noise.inputs['Detail'].default_value = 8
l.new(tc.outputs['Object'], mp.inputs['Vector']); l.new(mp.outputs['Vector'], noise.inputs['Vector'])
l.new(rig.mix_color(n, l, noise.outputs['Fac'], rig.hexrgb('#3a1c0a'), rig.hexrgb('#a8642c')), b.inputs['Base Color'])
bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = 0.6; l.new(noise.outputs['Fac'], bump.inputs['Height']); l.new(bump.outputs['Normal'], b.inputs['Normal'])
b.inputs['Roughness'].default_value = 0.55
C, R = Vector((0, 0, 1.15)), 1.45
rig.ball(tuple(C), R, m, 'coconut', 64, scale=(1.0, 0.96, 1.08))
pore = rig.plastic('pore', (0.02, 0.01, 0.005), rough=0.5)
def on_shell(x, z, lift=0.0):
    """A point on the coconut's front at x, z from its middle."""
    return C + Vector((x, -math.sqrt(max(0.0, (R + lift) ** 2 - x * x - (z / 1.08) ** 2)) * 0.96, z))
for sx in (-1, 1):                       # two eyes, half shut
    rig.ball(tuple(on_shell(sx * 0.47, 0.3, -0.05)), 0.21, pore, 'eye', 32, scale=(1.15, 0.4, 0.85))
    rig.tube('lid', [tuple(on_shell(sx * (0.2 + 0.52 * t), 0.49 - 0.06 * t, 0.03)) for t in (j / 8 for j in range(9))], 0.05, pore, res=4)
rig.ball(tuple(on_shell(0, -0.36, -0.05)), 0.17, pore, 'mouth', 32, scale=(1.0, 0.4, 0.8))    # and the third mark, a mouth saying "oh"
husk = rig.plastic('husk', rig.hexrgb('#c8904a'), rough=0.7)
for i in range(16):                      # a tuft of husk left on top
    a = rnd.uniform(0, math.tau); d = rnd.uniform(0.0, 0.35); top = C + Vector((math.cos(a) * d, math.sin(a) * d, R * 1.07))
    rig.tube('husk', [tuple(top), tuple(top + Vector((math.cos(a) * d * 0.8, math.sin(a) * d * 0.8, rnd.uniform(0.25, 0.55)))), tuple(top + Vector((math.cos(a) * (d + 0.3), math.sin(a) * (d + 0.3), rnd.uniform(0.4, 0.75))))], 0.022, husk, res=2)

# ---- the darts: each one bounced, its point bent, a flash where it hit ----------------------------
steel = rig.plastic('steel', (0.8, 0.85, 0.9), rough=0.12, metallic=1.0)
brass = rig.plastic('brass', rig.hexrgb('#ffc21c'), rough=0.2, metallic=0.9)
flash = rig.glow('flash', rig.hexrgb('#ffe45a'), 1.6)
def dart(hit, away, color, spin):
    """A dart leaving the shell at `hit` along `away`: its tail leads, its bent point trails."""
    flight = rig.plastic('flight', rig.hexrgb(color), rough=0.3, coat=0.5)
    parts = [rig.tube('point', [(0.0, 0, 0.16), (0.22, 0, 0.1), (0.36, 0, -0.02), (0.6, 0, 0.0)], 0.035, steel, res=4),
             rig.cone((0.6, 0, 0), (1.45, 0, 0), 0.1, 0.13, brass, 24), rig.cone((1.45, 0, 0), (2.2, 0, 0), 0.045, 0.045, steel, 12)]
    for turn in (0, 90):
        f = rig.slab('flight', [(1.85, 0.0), (2.1, 0.34), (2.75, 0.34), (2.5, 0.0), (2.75, -0.34), (2.1, -0.34)], -0.012, 0.012, flight, 0.0)
        f.rotation_euler.x = math.radians(turn + spin); parts.append(f)
    root = rig.group(parts, loc=tuple(hit + away * 0.3), scale=0.72)
    root.rotation_euler = Vector((1, 0, 0)).rotation_difference(away).to_euler()
    o = rig.slab('flash', rig.star(8, 0.34, 0.13, rnd.uniform(0, 1)), -0.02, 0.02, flash, 0.0); o.location = hit + Vector((0, -0.25, 0))
for x, z, away, color, spin in ((-1.0, 0.8, (-0.8, -0.35, 0.75), '#3fb8e8', 20), (1.1, 0.5, (0.9, -0.3, 0.45), '#ffc21c', 50),
                                (-1.05, -0.65, (-0.9, -0.3, -0.45), '#6fd86a', 35), (0.9, -0.85, (0.75, -0.4, -0.7), '#e2101c', 10)):
    dart(on_shell(x, z), Vector(away).normalized(), color, spin)

LOOK = tuple(C)
rig.area('key', (-5, -9, 7), 4.0, 2300, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 600, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2400, rgb=(1.0, 0.6, 0.85), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 500, rgb=(1.0, 0.85, 0.92), look_at=LOOK)
rig.world((0.12, 0.03, 0.07), 0.7)
rig.camera(50)
rig.render(OUT)
