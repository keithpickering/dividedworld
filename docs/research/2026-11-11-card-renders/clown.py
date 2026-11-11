"""Class Clown card art exploration (the owner's idea): a clown's kit, floating: the wig, the nose, the horn,
over a vortex of every color."""
import sys, os, math, random, colorsys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('CLOWN_SEED', '9')))
sc = rig.reset()
C = Vector((0, 0, 1.0))                  # where the nose floats

# ---- behind it: every color, wound into a vortex (after the owner's own Feelin' Fab swirl) -------------------
# The backdrop is a flat card; the twist is in its shader. A point's color is its angle about the eye of the
# vortex plus TWIST times the log of its distance from it, so each band is a spiral arm; it is brightest at the
# eye and falls dark away from it, which is what lets the kit stand off it.
EYE = (float(os.environ.get('CLOWN_EYE_X', '0.9')), float(os.environ.get('CLOWN_EYE_Z', '2.7')))
TWIST = float(os.environ.get('CLOWN_TWIST', '0.5'))
ARMS = 2                                 # whole rainbows in one turn about the eye
m, n, l, b = rig.material('vortex')
def math_node(op, a, b2=None):
    nd = n.new('ShaderNodeMath'); nd.operation = op
    for k, v in enumerate((a, b2)):
        if v is None: continue
        if hasattr(v, 'is_linked'): l.new(v, nd.inputs[k])
        else: nd.inputs[k].default_value = v
    return nd.outputs[0]
tc = n.new('ShaderNodeTexCoord'); mp = n.new('ShaderNodeMapping')
mp.inputs['Scale'].default_value = (26, 30, 1); mp.inputs['Location'].default_value = (-13 - EYE[0], -15 - EYE[1], 0)   # to card units, about the eye
sx = n.new('ShaderNodeSeparateXYZ'); l.new(tc.outputs['UV'], mp.inputs['Vector']); l.new(mp.outputs['Vector'], sx.inputs[0])
x, y = sx.outputs['X'], sx.outputs['Y']
r = math_node('SQRT', math_node('ADD', math_node('MULTIPLY', x, x), math_node('MULTIPLY', y, y)))
turn = math_node('DIVIDE', math_node('ARCTAN2', y, x), math.tau)
band = math_node('FRACT', math_node('ADD', math_node('MULTIPLY', turn, float(ARMS)), math_node('MULTIPLY', math_node('LOGARITHM', math_node('ADD', r, 0.05), math.e), TWIST)))
ramp = n.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
STRIPES = ['#ff1c1c', '#ff8a1c', '#ffe81c', '#2fd24a', '#1cc8ff', '#2a4dff', '#b03df0', '#ff2ad0', '#ff1c1c']   # ends where it starts, so the turn closes
cr.elements[0].position = 0; cr.elements[0].color = (*rig.hexrgb(STRIPES[0]), 1)
cr.elements[1].position = 1; cr.elements[1].color = (*rig.hexrgb(STRIPES[-1]), 1)
for k in range(1, len(STRIPES) - 1):
    e = cr.elements.new(k / (len(STRIPES) - 1)); e.color = (*rig.hexrgb(STRIPES[k]), 1)
l.new(band, ramp.inputs['Fac'])
near = math_node('DIVIDE', 1.0, math_node('ADD', 1.0, math_node('POWER', math_node('DIVIDE', r, 2.6), 2.0)))   # 1 at the eye, falling off
white = rig.mix_color(n, l, math_node('POWER', near, 6.0), ramp.outputs['Color'], (1.0, 1.0, 1.0))          # the eye itself burns white
em = n.new('ShaderNodeEmission'); l.new(white, em.inputs['Color'])
l.new(math_node('ADD', 0.13, math_node('MULTIPLY', near, 0.95)), em.inputs['Strength'])
l.new(em.outputs[0], n['Material Output'].inputs['Surface'])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 14, 0), rotation=(math.radians(90), 0, 0))
bd = bpy.context.object; bd.scale = (26, 30, 1); bd.data.materials.append(m)
CONFETTI = ['#e8301c', '#ff8a1c', '#ffd21c', '#2fbf4a', '#1c8aff', '#8a3df0']

# ---- the wig: a rainbow of curls, around a head that is not there --------------------------------
for i in range(150):
    a = math.radians(rnd.uniform(-35, 215)); ring = rnd.uniform(0.0, 1.0)
    rad = 1.45 + 0.75 * ring; y = rnd.uniform(-0.3, 0.9)
    p = C + Vector((math.cos(a) * rad * 1.08, y, 0.75 + math.sin(a) * rad))
    hue = ((math.degrees(a) + 35) / 250 * 0.83 + rnd.uniform(-0.03, 0.03)) % 1.0
    rgb = colorsys.hsv_to_rgb(hue, 0.95, 1.0)
    rig.ball(p, rnd.uniform(0.3, 0.48), rig.plastic('curl', tuple(c ** 2.2 for c in rgb), rough=0.4, emit=0.22), 'curl', 20)

# ---- the nose: red, round, and very shiny --------------------------------------------------------
rig.ball(C, 0.62, rig.plastic('nose', rig.hexrgb('#f0101c'), rough=0.05, coat=1.0), 'nose', 64)

# ---- the horn: a brass bell, a bent neck, a black rubber bulb -----------------------------------
brass = rig.plastic('brass', rig.hexrgb('#ffc02a'), rough=0.08, metallic=1.0)
rubber = rig.plastic('bulb', rig.hexrgb('#1c5aff'), rough=0.2, coat=1.0, emit=0.1)
horn = [rig.cone((0, 0, 0), (1.0, 0, 0), 0.12, 0.12, brass, 32)]
import bmesh
bm = bmesh.new(); rings = []
for j in range(25):                                               # the bell: a flare, open toward +x
    t = j / 24; x = 1.0 + 1.1 * t; r = 0.12 + 0.75 * t ** 2.6
    rings.append([bm.verts.new((x, math.cos(q) * r, math.sin(q) * r)) for q in (math.tau * k / 40 for k in range(40))])
for a, b2 in zip(rings, rings[1:]):
    for k in range(40): bm.faces.new((a[k], a[(k + 1) % 40], b2[(k + 1) % 40], b2[k]))
me = bpy.data.meshes.new('bell'); bm.to_mesh(me); bm.free()
for f in me.polygons: f.use_smooth = True
bell = bpy.data.objects.new('bell', me); sc.collection.objects.link(bell); me.materials.append(brass)
bell.modifiers.new('thick', 'SOLIDIFY').thickness = 0.03
horn += [bell, rig.tube('lip', [(2.1, math.cos(q) * 0.87, math.sin(q) * 0.87) for q in (math.tau * k / 48 for k in range(49))], 0.045, brass, res=5),
         rig.ball((-0.55, 0, 0), 0.62, rubber, 'bulb', 48, scale=(1.15, 1, 1)), rig.cone((-0.05, 0, 0), (0.15, 0, 0), 0.2, 0.16, brass, 32)]
rig.group(horn, loc=C + Vector((-0.75, -0.9, -2.35)), rot=(0, -24, -32), scale=1.0)
honk = rig.glow('honk', (1, 1, 1), 3.0)                           # and the noise it makes
for k, (ang, ln) in enumerate(((-8, 0.55), (10, 0.7), (28, 0.55))):
    d = Vector((math.cos(math.radians(ang + 4)), -0.5, math.sin(math.radians(ang + 4))))
    o = C + Vector((1.25, -1.6, -1.55)) + d * 0.25
    rig.tube('honk', [o, o + d * ln], 0.04, honk, res=4)

# ---- and the rest: a bow tie, and confetti in the air -------------------------------------------
dots = rig.checker('tie', '#1c8aff', '#ffd21c', 9, rough=0.2)
tie = [rig.slab('tie', [(0, 0.12), (0.95, 0.5), (0.95, -0.5), (0, -0.12), (-0.95, -0.5), (-0.95, 0.5)], -0.12, 0.12, dots, 0.08),
       rig.ball((0, -0.05, 0), 0.2, rig.plastic('knot', rig.hexrgb('#e8301c'), rough=0.15, coat=1.0), 'knot', 24)]
rig.group(tie, loc=C + Vector((1.45, -0.4, -2.75)), rot=(0, 12, 14), scale=0.95)
for i in range(60):
    hx = rnd.choice(CONFETTI + ['#ffffff'])
    p = (rnd.uniform(-2.7, 2.7), rnd.uniform(-1.5, 3), rnd.uniform(-4.1, 4.1))
    bpy.ops.mesh.primitive_plane_add(size=rnd.uniform(0.08, 0.16), location=p, rotation=(rnd.uniform(0, 6), rnd.uniform(0, 6), rnd.uniform(0, 6)))
    bpy.context.object.data.materials.append(rig.plastic('confetti', rig.hexrgb(hx), rough=0.2, emit=0.4))

rig.area('key', (-6, -9, 7), 4.0, 2200, look_at=tuple(C))
rig.area('window', (3.5, -8, 3), 1.3, 1000, look_at=tuple(C), size_y=6.0)
rig.area('soft', (6, -6, -3), 8.0, 1500, rgb=(1.0, 0.95, 0.9), look_at=tuple(C))
for sx_ in (-1, 1):                                               # two lamps behind, for a white edge on everything
    rig.area('edge', (sx_ * 7, 7, 3 * sx_), 5.0, 2600, look_at=tuple(C))
rig.world((0.3, 0.28, 0.35), 0.9)
rig.camera(60)
rig.render(OUT)
