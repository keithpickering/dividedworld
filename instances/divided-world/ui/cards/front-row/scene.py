"""Front Row card art: the three best seats in the house, seen from the ring: red plush, a spotlight on the middle
one, a tub of popcorn on it and a foam finger propped in the next. (The card pays its character a flat amount for
each vote on its card Acts, for 3 days.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('ROW_SEED', '3')))
sc = rig.reset()
rig.backdrop(22, [(0.0, '#0a0102'), (0.45, '#3a0a0a'), (0.8, '#a8321c'), (1.0, '#160304')]).scale = (80, 50, 1)
for i in range(40):                      # the rest of the house, in the dark
    hx = rnd.choice(['#ffffff', '#ffd9b0', '#d24a2c', '#fff1c0'])
    rig.ball((rnd.uniform(-18, 18), rnd.uniform(17, 21), rnd.uniform(-1, 9)), rnd.uniform(0.15, 0.5), rig.glow('flash', rig.hexrgb(hx), rnd.uniform(0.6, 2.5), alpha=0.5), 'flash', 16)
G = -2.5
rig.floor(G, rig.checker('floor', '#120303', '#4a100a', 40, rough=0.12))

# ---- the seats -------------------------------------------------------------------------------------
m, n, l, b = rig.material('plush'); b.inputs['Base Color'].default_value = (*rig.hexrgb('#a00a12'), 1); b.inputs['Roughness'].default_value = 0.7
b.inputs['Sheen Weight'].default_value = 0.3
wood = rig.plastic('wood', rig.hexrgb('#2a120a'), rough=0.25, coat=0.8)
gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.2, metallic=0.9, emit=0.12)
SW = 1.62                                # a seat's width, arm to arm
for k in (-1, 0, 1):
    x = k * (SW + 0.2)
    back = rig.slab('back', rig.rrect(SW, 2.5, 0.42), -0.2, 0.2, m, 0.14); back.location = (x, 0.75, G + 2.35); back.rotation_euler.x = math.radians(-8)
    rig.box('cushion', SW - 0.06, 1.35, 0.36, m, (x, -0.05, G + 1.0), bevel=0.14)
    rig.box('base', SW - 0.3, 1.0, 1.0, wood, (x, 0.1, G), bevel=0.03)
    for j in range(2):                   # two buttons in each back
        rig.ball((x, 0.5, G + 2.3 + 0.75 * j), 0.07, gold, 'button', 12)
    rig.text('A%d' % (k + 2), 0.2, gold, (x, 0.42, G + 3.42), depth=0.012, bevel=0.003, rot=(math.radians(-8), 0, 0))
for k in range(4):                       # the arms between them
    x = (k - 1.5) * (SW + 0.2)
    rig.box('arm', 0.2, 1.5, 1.55, wood, (x, 0.0, G), bevel=0.04)
    rig.box('rest', 0.26, 1.3, 0.12, m, (x, -0.05, G + 1.55), bevel=0.05)

# ---- popcorn, in the middle seat ------------------------------------------------------------------
pm, pn, pl, pb = rig.material('tub')     # red and white stripes round it
tc = pn.new('ShaderNodeTexCoord'); wave = pn.new('ShaderNodeTexWave'); wave.inputs['Scale'].default_value = 2.2; wave.wave_profile = 'SAW'
ramp = pn.new('ShaderNodeValToRGB'); ramp.color_ramp.interpolation = 'CONSTANT'; ramp.color_ramp.elements[0].color = (*rig.hexrgb('#f8f4ea'), 1); ramp.color_ramp.elements[1].position = 0.5; ramp.color_ramp.elements[1].color = (*rig.hexrgb('#e2101c'), 1)
pl.new(tc.outputs['Object'], wave.inputs['Vector']); pl.new(wave.outputs['Fac'], ramp.inputs['Fac']); pl.new(ramp.outputs['Color'], pb.inputs['Base Color']); pb.inputs['Roughness'].default_value = 0.35
TUB = Vector((0, -0.15, G + 1.36))
rig.lathe('tub', [(0.0, 0.0), (0.42, 0.0), (0.62, 1.15), (0.0, 1.15)], pm, tuple(TUB))
corn = rig.plastic('corn', rig.hexrgb('#fff2c0'), rough=0.6, emit=0.1)
for i in range(70):
    a = rnd.uniform(0, math.tau); d = 0.6 * math.sqrt(rnd.random())
    rig.ball(tuple(TUB + Vector((math.cos(a) * d, math.sin(a) * d, 1.12 + (0.62 - d) * 0.75 + rnd.uniform(-0.05, 0.08)))), rnd.uniform(0.09, 0.15), corn, 'corn', 10)
for x, y in ((-0.75, -0.6), (0.6, -0.75), (0.95, -0.45), (-0.3, -0.85)):       # and some that got away
    rig.ball((x, y, G + 0.08), 0.1, corn, 'corn', 10)

# ---- a foam finger, in the seat on the right -------------------------------------------------------
foam = rig.plastic('foam', rig.hexrgb('#ffc21c'), rough=0.6)
FINGER = [(-0.62, -1.0), (0.62, -1.0), (0.66, 0.35), (0.18, 0.45), (0.18, 1.7), (-0.26, 1.7), (-0.26, 0.45), (-0.66, 0.35)]
parts = [rig.slab('finger', FINGER, -0.2, 0.2, foam, 0.14), rig.text('#1', 0.62, rig.plastic('ink', rig.hexrgb('#c8141c'), rough=0.4), (0, -0.21, -0.35), depth=0.012, bevel=0.003)]
rig.group(parts, loc=(SW + 0.3, -0.2, G + 2.5), rot=(-14, 0, -11), scale=0.95)

beam = rig.glow('beam', rig.hexrgb('#ffe2b0'), 0.9, alpha=0.035)               # the spot on the middle seat
rig.cone((-2.5, 3, 12), (0, 0, G + 1.2), 0.25, 1.9, beam, 48)
LOOK = (0, 0, G + 2.0)
bpy.ops.object.light_add(type='SPOT', location=(-1.2, -3.5, 9)); spot = bpy.context.object; spot.data.energy = 5000; spot.data.spot_size = math.radians(24); spot.data.color = (1.0, 0.9, 0.75)
spot.rotation_euler = (Vector((0, -0.1, G + 1.8)) - spot.location).to_track_quat('-Z', 'Y').to_euler()
rig.area('key', (-5, -9, 6), 4.0, 900, look_at=LOOK)
rig.area('rim', (5, 6, 6), 4.0, 2200, rgb=(1.0, 0.5, 0.25), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 250, rgb=(1.0, 0.8, 0.7), look_at=LOOK)
rig.world((0.06, 0.015, 0.01), 0.6)
rig.camera(50, elev=9, target=(0, 0, -0.9))
rig.render(OUT)
