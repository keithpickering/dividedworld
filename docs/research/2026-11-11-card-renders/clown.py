"""Class Clown card art exploration (the owner's idea): a clown's kit, floating: the wig, the nose, the horn."""
import sys, os, math, random, colorsys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('CLOWN_SEED', '9')))
sc = rig.reset()
C = Vector((0, 0, 1.0))                  # where the nose floats

# ---- behind it: a big-top sunburst in every color ------------------------------------------------
m, n, l, b = rig.material('bigtop')
tc = n.new('ShaderNodeTexCoord'); mp = n.new('ShaderNodeMapping')
mp.inputs['Location'].default_value = (-0.5, -0.5 - C.z / 30, 0); mp.inputs['Scale'].default_value = (26 / 30, 1, 1)
gr = n.new('ShaderNodeTexGradient'); gr.gradient_type = 'RADIAL'
mul = n.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 3
fr = n.new('ShaderNodeMath'); fr.operation = 'FRACT'
ramp = n.new('ShaderNodeValToRGB'); cr = ramp.color_ramp; cr.interpolation = 'CONSTANT'
STRIPES = ['#e8301c', '#ff8a1c', '#ffd21c', '#2fbf4a', '#1c8aff', '#8a3df0']
cr.elements[0].position = 0; cr.elements[0].color = (*rig.hexrgb(STRIPES[0]), 1)
cr.elements[1].position = 1 / 6; cr.elements[1].color = (*rig.hexrgb(STRIPES[1]), 1)
for i in range(2, 6):
    e = cr.elements.new(i / 6); e.color = (*rig.hexrgb(STRIPES[i]), 1)
l.new(tc.outputs['UV'], mp.inputs['Vector']); l.new(mp.outputs['Vector'], gr.inputs['Vector'])
l.new(gr.outputs['Fac'], mul.inputs[0]); l.new(mul.outputs[0], fr.inputs[0]); l.new(fr.outputs[0], ramp.inputs['Fac'])
sph = n.new('ShaderNodeTexGradient'); sph.gradient_type = 'SPHERICAL'; mp2 = n.new('ShaderNodeMapping')
mp2.inputs['Location'].default_value = (-0.5 * 3.2, (-0.5 - C.z / 30) * 3.2, 0); mp2.inputs['Scale'].default_value = (26 / 30 * 3.2, 3.2, 1)
l.new(tc.outputs['UV'], mp2.inputs['Vector']); l.new(mp2.outputs['Vector'], sph.inputs['Vector'])
dim = rig.mix_color(n, l, 0.62, ramp.outputs['Color'], (0.01, 0.005, 0.02))      # stripes held back, so the kit stands off them
lit = rig.mix_color(n, l, sph.outputs['Fac'], dim, ramp.outputs['Color'])
em = n.new('ShaderNodeEmission'); l.new(lit, em.inputs['Color']); l.new(em.outputs[0], n['Material Output'].inputs['Surface'])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 14, 0), rotation=(math.radians(90), 0, 0))
bd = bpy.context.object; bd.scale = (26, 30, 1); bd.data.materials.append(m)

# ---- the wig: a rainbow of curls, around a head that is not there --------------------------------
for i in range(150):
    a = math.radians(rnd.uniform(-35, 215)); ring = rnd.uniform(0.0, 1.0)
    rad = 1.45 + 0.75 * ring; y = rnd.uniform(-0.3, 0.9)
    p = C + Vector((math.cos(a) * rad * 1.08, y, 0.75 + math.sin(a) * rad))
    hue = ((math.degrees(a) + 35) / 250 * 0.83 + rnd.uniform(-0.03, 0.03)) % 1.0
    rgb = colorsys.hsv_to_rgb(hue, 0.95, 1.0)
    rig.ball(p, rnd.uniform(0.3, 0.48), rig.plastic('curl', tuple(c ** 2.2 for c in rgb), rough=0.35, emit=0.12), 'curl', 20)

# ---- the nose: red, round, and very shiny --------------------------------------------------------
rig.ball(C, 0.62, rig.plastic('nose', rig.hexrgb('#f0101c'), rough=0.05, coat=1.0), 'nose', 64)

# ---- the horn: a brass bell, a bent neck, a black rubber bulb -----------------------------------
brass = rig.plastic('brass', rig.hexrgb('#ffc02a'), rough=0.08, metallic=1.0)
rubber = rig.plastic('bulb', (0.015, 0.012, 0.015), rough=0.25, coat=1.0)
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
    hx = rnd.choice(STRIPES + ['#ffffff'])
    p = (rnd.uniform(-2.7, 2.7), rnd.uniform(-1.5, 3), rnd.uniform(-4.1, 4.1))
    bpy.ops.mesh.primitive_plane_add(size=rnd.uniform(0.08, 0.16), location=p, rotation=(rnd.uniform(0, 6), rnd.uniform(0, 6), rnd.uniform(0, 6)))
    bpy.context.object.data.materials.append(rig.plastic('confetti', rig.hexrgb(hx), rough=0.2, emit=0.4))

rig.area('key', (-6, -9, 7), 4.0, 2400, look_at=tuple(C))
rig.area('window', (3.5, -8, 3), 1.3, 1000, look_at=tuple(C), size_y=6.0)
rig.area('soft', (6, -6, -3), 8.0, 900, rgb=(1.0, 0.9, 0.8), look_at=tuple(C))
rig.world((0.25, 0.2, 0.3), 0.8)
rig.camera(60)
rig.render(OUT)
