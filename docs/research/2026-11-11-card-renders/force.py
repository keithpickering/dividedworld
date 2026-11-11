"""Force Field card art exploration, after the placeholder art.svg: a dome of light over a post, a card bouncing off."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
rig.backdrop(18, [(0.0, '#010608'), (0.45, '#0a4a5c'), (1.0, '#010608')])
G = -1.2                                 # the ground
rig.floor(G, rig.plastic('floor', rig.hexrgb('#02161c'), rough=0.12))
wire = rig.glow('grid', rig.hexrgb('#2ee6ff'), 1.6)
for k in range(-12, 13):                 # the grid the 90s put under everything
    rig.tube('grid', [(k * 1.1, -4, G + 0.01), (k * 1.1, 16, G + 0.01)], 0.012, wire, res=2)
for k in range(-3, 15):
    rig.tube('grid', [(-14, k * 1.1, G + 0.01), (14, k * 1.1, G + 0.01)], 0.012, wire, res=2)

# ---- the dome: a geodesic half shell, its struts lit, its skin barely there ----------------------
D = Vector((0, 1.5, G)); R = 2.35
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=R, location=D)
shell = bpy.context.object
import bmesh
bm = bmesh.new(); bm.from_mesh(shell.data)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0.001), plane_no=(0, 0, 1), clear_inner=True)
bm.to_mesh(shell.data); bm.free()
m, n, l, b = rig.material('skin')                                # glass that glows at its edge
fres = n.new('ShaderNodeLayerWeight'); fres.inputs['Blend'].default_value = 0.35
em = n.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*rig.hexrgb('#2ee6ff'), 1); em.inputs['Strength'].default_value = 1.4
tr = n.new('ShaderNodeBsdfTransparent'); mx = n.new('ShaderNodeMixShader')
l.new(fres.outputs['Facing'], mx.inputs[0]); l.new(tr.outputs[0], mx.inputs[1]); l.new(em.outputs[0], mx.inputs[2])
l.new(mx.outputs[0], n['Material Output'].inputs['Surface'])
shell.data.materials.append(m); bpy.ops.object.shade_smooth()
struts = shell.copy(); struts.data = shell.data.copy(); sc.collection.objects.link(struts)
struts.data.materials.clear(); struts.data.materials.append(rig.glow('strut', rig.hexrgb('#7ff2ff'), 2.2))
wf = struts.modifiers.new('wire', 'WIREFRAME'); wf.thickness = 0.035; wf.use_replace = True
rig.tube('rim', [D + Vector((math.cos(a) * R, math.sin(a) * R, 0.03)) for a in (math.tau * j / 96 for j in range(97))], 0.07, rig.plastic('rim', rig.hexrgb('#2ee6ff'), rough=0.1, metallic=1.0, emit=0.6), res=6)

# ---- what it guards: the emitter, and a post lying under it --------------------------------------
chrome = rig.plastic('chrome', (0.85, 0.95, 1.0), rough=0.05, metallic=1.0)
rig.cone(D, D + Vector((0, 0, 0.18)), 0.55, 0.45, chrome, 48)
rig.cone(D + Vector((0, 0, 0.18)), D + Vector((0, 0, 1.25)), 0.09, 0.07, chrome, 24)
rig.ball(D + Vector((0, 0, 1.45)), 0.26, rig.glow('orb', rig.hexrgb('#b8f8ff'), 6.0), 'orb', 32)
rig.tube('ray', [D + Vector((0, 0, 1.6)), D + Vector((0, 0, R - 0.02))], 0.03, rig.glow('ray', rig.hexrgb('#b8f8ff'), 4.0), res=4)
orb = bpy.data.lights.new('orb', 'POINT'); orb.energy = 500; orb.color = (0.5, 0.95, 1.0)
oo = bpy.data.objects.new('orb', orb); sc.collection.objects.link(oo); oo.location = D + Vector((0, 0, 1.45))
page = rig.plastic('post', rig.hexrgb('#d8f6ff'), rough=0.3)
inkm = rig.plastic('post-ink', rig.hexrgb('#0d5466'), rough=0.3)
post = [rig.slab('post', rig.rrect(1.5, 1.0, 0.08), -0.05, 0.05, page, 0.015)]
for k in range(4):
    post.append(rig.slab('line', rig.rrect(1.1 - 0.25 * (k % 2), 0.08, 0.03), -0.07, -0.04, inkm, 0.005)); post[-1].location = (-0.1 * (k % 2), 0, 0.28 - 0.19 * k)
rig.group(post, loc=D + Vector((-0.95, -0.55, 0.08)), rot=(90, 0, 18))

# ---- the card that tried: knocked back off the dome, sparks where it struck ---------------------
hit = D + Vector((1.25, -1.35, 1.45))                                 # on the dome's near side, up and right
paper = rig.plastic('card', rig.hexrgb('#e6fdff'), rough=0.15, coat=1.0)
cedge = rig.plastic('card-edge', rig.hexrgb('#2ee6ff'), rough=0.15, coat=1.0, emit=0.3)
card = [rig.slab('card', rig.rrect(1.0, 1.45, 0.1), -0.035, 0.035, cedge, 0.015), rig.slab('face', rig.rrect(0.84, 1.29, 0.06), -0.05, -0.02, paper, 0.008)]
card.append(rig.cone((0, -0.055, 0.0), (0, -0.07, 0.0), 0.22, 0.22, cedge, 32))
rig.group(card, loc=hit + Vector((0.5, -0.6, 1.2)), rot=(-25, 30, -38))
spark = rig.glow('spark', (1.0, 1.0, 1.0), 9.0)
rig.ball(hit, 0.12, spark, 'strike', 20)
for j in range(16):
    a = j / 16 * math.tau; ln = 0.45 + 0.4 * ((j * 7) % 5) / 4
    d = Vector((math.cos(a), -0.25, math.sin(a))).normalized()
    rig.cone(hit + d * 0.18, hit + d * (0.18 + ln), 0.022, 0.0, spark, 8)
for j in range(3):                                                    # the rings a field shows where it is struck
    rig.tube('ripple', [hit + Vector((math.cos(a) * (0.3 + 0.22 * j), -0.02 * j, math.sin(a) * (0.3 + 0.22 * j))) for a in (math.tau * k / 48 for k in range(49))], 0.014, rig.glow('ripple', rig.hexrgb('#b8f8ff'), 3.0 - 0.8 * j), res=3)
for x, y, z, s in ((-2.2, 6, 3.6, 0.05), (2.3, 8, 3.0, 0.04), (-1.7, 9, 2.4, 0.03), (0.6, 7, 3.9, 0.035), (2.0, 5, 1.2, 0.03), (-2.4, 7, 1.0, 0.04)):
    rig.ball((x, y, z), s * 2, rig.glow('far', rig.hexrgb('#e6fdff'), 3.0), 'far', 8)

rig.area('key', (-6, -8, 7), 4.0, 1500, rgb=(0.8, 0.95, 1.0), look_at=tuple(D + Vector((0, 0, 1))))
rig.area('rim', (5, 6, 5), 4.0, 1800, rgb=(0.3, 0.9, 1.0), look_at=tuple(D), glossy=False)
rig.world((0.01, 0.06, 0.08), 0.7)
rig.camera(60, elev=10, target=(0, 0, -0.35))
rig.render(OUT)
