"""Glitter Bomb card art, after the placeholder art.svg: an envelope going off."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy, bmesh
from mathutils import Vector, Euler
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('GLITTER_SEED', '11')))
sc = rig.reset()
C = Vector((0, 0, 1.35))                 # the envelope's mouth, where it all comes out; high, so the envelope clears the name plate

# ---- behind it: a sunburst, its rays turning about the mouth -------------------------------------
m, n, l, b = rig.material('burst')
tc = n.new('ShaderNodeTexCoord'); mp = n.new('ShaderNodeMapping')
mp.inputs['Location'].default_value = (-0.5, -0.5 - C.z / 30, 0); mp.inputs['Scale'].default_value = (26 / 30, 1, 1)
gr = n.new('ShaderNodeTexGradient'); gr.gradient_type = 'RADIAL'
mul = n.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 16
fr = n.new('ShaderNodeMath'); fr.operation = 'FRACT'; gt = n.new('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.5
l.new(tc.outputs['UV'], mp.inputs['Vector']); l.new(mp.outputs['Vector'], gr.inputs['Vector'])
l.new(gr.outputs['Fac'], mul.inputs[0]); l.new(mul.outputs[0], fr.inputs[0]); l.new(fr.outputs[0], gt.inputs[0])
sph = n.new('ShaderNodeTexGradient'); sph.gradient_type = 'SPHERICAL'; mp2 = n.new('ShaderNodeMapping')
mp2.inputs['Location'].default_value = (-0.5 * 4.5, (-0.5 - C.z / 30) * 4.5, 0); mp2.inputs['Scale'].default_value = (26 / 30 * 4.5, 4.5, 1)
l.new(tc.outputs['UV'], mp2.inputs['Vector']); l.new(mp2.outputs['Vector'], sph.inputs['Vector'])
stripes = rig.mix_color(n, l, gt.outputs[0], rig.hexrgb('#3a0c04'), rig.hexrgb('#8a2408'))
lit = rig.mix_color(n, l, sph.outputs['Fac'], stripes, rig.hexrgb('#ffb04a'))
em = n.new('ShaderNodeEmission'); l.new(lit, em.inputs['Color']); l.new(em.outputs[0], n['Material Output'].inputs['Surface'])
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 14, 0), rotation=(math.radians(90), 0, 0))
bd = bpy.context.object; bd.scale = (26, 30, 1); bd.data.materials.append(m)

# ---- the envelope: a pocket, its flap thrown open ------------------------------------------------
paper = rig.plastic('envelope', rig.hexrgb('#e2491f'), rough=0.3)
shade = rig.plastic('envelope-fold', rig.hexrgb('#a82c10'), rough=0.3)
inner = rig.plastic('envelope-inside', rig.hexrgb('#ffe2b8'), rough=0.4, emit=0.1)
W, HH = 3.3, 2.0
env = [rig.slab('back', rig.rrect(W, HH, 0.08), 0.0, 0.1, shade, 0.01),
       rig.slab('pocket-left', [(-W / 2, HH / 2), (-W / 2, -HH / 2), (0.1, -0.05)], -0.1, -0.02, paper, 0.01),
       rig.slab('pocket-right', [(W / 2, HH / 2), (-0.1, -0.05), (W / 2, -HH / 2)], -0.1, -0.02, paper, 0.01),
       rig.slab('pocket-foot', [(-W / 2, -HH / 2), (W / 2, -HH / 2), (0, 0.1)], -0.14, -0.06, rig.plastic('envelope-front', rig.hexrgb('#f25a2a'), rough=0.3), 0.01)]
flap = rig.slab('flap', [(-W / 2, 0), (W / 2, 0), (0, 1.5)], -0.03, 0.03, inner, 0.01)
flap.location = (0, 0.12, HH / 2); flap.rotation_euler = (math.radians(28), 0, 0)
env.append(flap)
env.append(rig.cone((0, 0.9, HH / 2 + 1.25), (0, 0.84, HH / 2 + 1.28), 0.22, 0.2, rig.plastic('seal', rig.hexrgb('#c8102a'), rough=0.15, coat=1.0), 32))
tilt = (10, -14, 7)
rig.group(env, loc=C + Vector((0, 0, -HH / 2 - 0.1)), rot=tilt)

# ---- what comes out: light, rays, and a great deal of glitter ------------------------------------
rig.ball(C + Vector((0, 0.1, 0.1)), 0.5, rig.glow('flash', rig.hexrgb('#fff3c4'), 12.0), 'flash', 32, scale=(1.6, 0.4, 0.8))
lamp = bpy.data.lights.new('flash', 'POINT'); lamp.energy = 900; lamp.color = (1.0, 0.8, 0.5); lamp.shadow_soft_size = 0.5
lo = bpy.data.objects.new('flash', lamp); sc.collection.objects.link(lo); lo.location = C + Vector((0, -0.6, 0.5))
ray = rig.glow('ray', rig.hexrgb('#ffe9a0'), 1.2, alpha=0.1)
for j in range(9):
    a = math.radians(20 + 140 * j / 8 + rnd.uniform(-5, 5))
    d = Vector((math.cos(a), 0.15, math.sin(a))); ln = rnd.uniform(4.5, 7.5)
    rig.cone(C + d * 0.2, C + d * ln, 0.03, rnd.uniform(0.25, 0.5), ray, 16)

COLORS = ['#ffd21c', '#ff3d9a', '#2ee6ff', '#ffffff', '#b06aff', '#ff8a1c', '#5aff8a']
def fling():
    """Where a piece of glitter has got to: up and out of the mouth, thick near it, thin far off."""
    a = math.radians(rnd.gauss(90, 48)); d = 0.5 + abs(rnd.gauss(0, 2.1))
    return C + Vector((math.cos(a) * d * 0.95, rnd.uniform(-1.6, 1.4), math.sin(a) * d + 0.2 * d))
for ci, hx in enumerate(COLORS):                                  # flakes: one mesh a color, each flake a tilted square
    bm = bmesh.new()
    for i in range(70):
        p = fling(); s = rnd.uniform(0.035, 0.09)
        rot = Euler((rnd.uniform(0, math.tau), rnd.uniform(0, math.tau), rnd.uniform(0, math.tau))).to_matrix()
        bm.faces.new([bm.verts.new(p + rot @ Vector(c)) for c in ((-s, 0, -s), (s, 0, -s), (s, 0, s), (-s, 0, s))])
    me = bpy.data.meshes.new('flakes'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('flakes', me); sc.collection.objects.link(o)
    me.materials.append(rig.plastic(f'flake{ci}', rig.hexrgb(hx), rough=0.08, metallic=1.0, emit=0.35))
for i in range(30):                                               # and stars, the big pieces
    p = fling(); s = rnd.choice([0.1, 0.13, 0.17, 0.22, 0.3, 0.38])
    o = rig.slab('star', rig.star(4, s, s * 0.26, rnd.uniform(0, 0.6)), -0.02, 0.02,
                 rig.plastic('star', rig.hexrgb(rnd.choice(COLORS)), rough=0.1, coat=1.0, emit=0.9), 0.006)
    o.location = p + Vector((0, -0.8, 0)); o.rotation_euler = (rnd.uniform(-0.4, 0.4), rnd.uniform(-0.3, 0.3), rnd.uniform(-0.5, 0.5))
for i in range(14):                                               # a few chrome beads to catch the light
    rig.ball(fling() + Vector((0, -0.5, 0)), rnd.uniform(0.05, 0.11), rig.plastic('bead', rig.hexrgb(rnd.choice(COLORS)), rough=0.03, metallic=1.0), 'bead', 16)

rig.area('key', (-6, -9, 6), 4.0, 1300, look_at=tuple(C))
rig.area('window', (4, -8, 2), 1.5, 900, look_at=tuple(C), size_y=6.0)
rig.area('soft', (0, -9, -3), 8.0, 350, rgb=(1.0, 0.8, 0.6), look_at=tuple(C))
rig.world((0.2, 0.08, 0.04), 0.8)
rig.camera(60)
rig.render(OUT)
