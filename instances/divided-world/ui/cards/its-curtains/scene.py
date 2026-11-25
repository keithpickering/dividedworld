"""It's Curtains card art: a stage with red velvet curtains drawn back by gold tiebacks, a dark house behind, a bare
wooden stage and a white chicken with a red comb alone in a spotlight. (The card hangs a curtain over a forum post;
the curtain parts when the post is opened.)"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import numpy as np
import bpy, bmesh
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
rig.backdrop(14, [(0.0, '#020204'), (0.5, '#0a0a14'), (0.8, '#17172a'), (1.0, '#05050a')]).scale = (80, 50, 1)
G = -0.7                                 # the stage floor
TIE = 1.35                               # height of the tiebacks

# ---- the stage ---------------------------------------------------------------------------------------
m, n, l, b = rig.material('boards')      # long bare planks running toward the viewer, each its own shade
tc = n.new('ShaderNodeTexCoord'); mp = n.new('ShaderNodeMapping'); mp.inputs['Rotation'].default_value[2] = math.radians(90)
mp.inputs['Scale'].default_value = (0.55, 0.55, 0.55)
brick = n.new('ShaderNodeTexBrick'); brick.offset = 0.5
brick.inputs['Mortar Size'].default_value = 0.012; brick.inputs['Brick Width'].default_value = 3.5
brick.inputs['Row Height'].default_value = 0.5; brick.inputs['Mortar Smooth'].default_value = 0.3
brick.inputs['Color1'].default_value = (*rig.hexrgb('#8a5a2c'), 1); brick.inputs['Color2'].default_value = (*rig.hexrgb('#5e3818'), 1)
brick.inputs['Mortar'].default_value = (*rig.hexrgb('#1a0c04'), 1)
l.new(tc.outputs['Object'], mp.inputs['Vector']); l.new(mp.outputs['Vector'], brick.inputs['Vector'])
l.new(brick.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.32
b.inputs['Coat Weight'].default_value = 0.35; b.inputs['Coat Roughness'].default_value = 0.2
floor = rig.floor(G, m, size=20, y=3)
floor.location = (0, 3.0, G)
lip = rig.plastic('lip', rig.hexrgb('#3a200c'), rough=0.3, coat=0.4)
rig.box('lip', 20, 0.4, 5, lip, (0, -6.5, G - 5), bevel=0.03)

# ---- the curtains -------------------------------------------------------------------------------------
ZB, ZT = G - 0.02, 5.2                   # a curtain's foot and its top
KEYS = [(ZT, 0.25), (4.3, 0.45), (3.2, 1.0), (2.2, 1.6), (TIE + 0.3, 1.98), (TIE, 2.02), (TIE - 0.5, 1.9), (0.0, 1.55), (-0.5, 1.5), (ZB, 1.5)]
WIDTH = [(ZT, 3.4), (3.0, 3.0), (TIE + 0.3, 1.7), (TIE, 1.45), (TIE - 0.5, 1.6), (0.0, 2.2), (ZB, 2.7)]
def interp(keys, z):
    zs = [k[0] for k in keys][::-1]; vs = [k[1] for k in keys][::-1]
    return float(np.interp(z, zs, vs))
def smooth(keys, z, h=0.45):             # a smoothed lookup, so the edge flows
    ds = np.linspace(-1.2, 1.2, 25)
    return sum(interp(keys, z + d) * math.exp(-(d / h) ** 2) for d in ds) / sum(math.exp(-(d / h) ** 2) for d in ds)
def cpos(side, t, z, phase=0.0):
    """A point on the curtain on `side` (-1 left, 1 right): t is 0 at its inner edge, 1 at the outer; z its height."""
    xin = smooth(KEYS, z); w = smooth(WIDTH, z, 0.3)
    drop = (ZT - z) / (ZT - ZB)
    fold = 0.11 + 0.17 * min(1.0, max(0.0, 1.0 - abs(z - TIE) / 3.2)) + 0.07 * drop
    y = -0.45 - 0.14 * t + fold * (math.cos(math.tau * 7 * t + phase + 0.8 * math.sin(z * 1.3)) - 0.4 * math.cos(math.tau * 3.5 * t + 0.6))
    x = xin + w * t + 0.05 * math.sin(z * 4.0 + t * 7)
    return (side * x, y, z)
vm, vn, vl, vb = rig.material('velvet')
vb.inputs['Base Color'].default_value = (*rig.hexrgb('#b80610'), 1); vb.inputs['Roughness'].default_value = 0.55
vb.inputs['Sheen Weight'].default_value = 1.0; vb.inputs['Sheen Roughness'].default_value = 0.35; vb.inputs['Sheen Tint'].default_value = (*rig.hexrgb('#ff6a5a'), 1)
def curtain(side, NT=150, NZ=140):
    bm = bmesh.new(); vs = []
    for j in range(NZ + 1):
        z = ZT + (ZB - ZT) * j / NZ
        vs.append([bm.verts.new(cpos(side, i / NT, z)) for i in range(NT + 1)])
    for j in range(NZ):
        for i in range(NT):
            bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('curtain'); bm.to_mesh(me); bm.free()
    for f in me.polygons: f.use_smooth = True
    o = bpy.data.objects.new('curtain', me); bpy.context.scene.collection.objects.link(o); me.materials.append(vm)
    sd = o.modifiers.new('thick', 'SOLIDIFY'); sd.thickness = 0.05
    return o
for side in (-1, 1):
    curtain(side)

gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.22, metallic=0.9, emit=0.1)
deep = rig.plastic('goldDeep', rig.hexrgb('#b8860b'), rough=0.3, metallic=0.9, emit=0.05)
for side in (-1, 1):                     # the tiebacks: a gold band round the curtain, and a tassel off its inner edge
    for dz, r, mat in ((0.0, 0.08, gold), (0.2, 0.05, deep), (-0.2, 0.05, deep)):
        pts = [cpos(side, t, TIE + dz) for t in np.linspace(-0.02, 0.62, 36)]
        pts = [(p[0], p[1] - 0.13, p[2]) for p in pts]
        rig.tube('band', pts, r, mat, 5)
    ix, iy, iz = cpos(side, -0.02, TIE); ix += -side * 0.02; iy -= 0.2
    rig.ball((ix, iy, iz), 0.14, gold, 'knot', 20)
    rig.ball((ix, iy - 0.02, iz - 0.3), 0.08, deep, 'neck', 14)
    rig.cone((ix, iy, iz - 0.34), (ix, iy, iz - 1.0), 0.12, 0.2, gold, 20)
    for k in range(14):                  # the fringe
        a = math.tau * k / 14
        rig.tube('fringe', [(ix + math.cos(a) * 0.28, iy + math.sin(a) * 0.12, iz - 0.95), (ix + math.cos(a) * 0.36, iy + math.sin(a) * 0.15, iz - 1.55)], 0.032, deep, 4)

# ---- the chicken -----------------------------------------------------------------------------------------
fm, fn, fl, fb = rig.material('feather')
fb.inputs['Base Color'].default_value = (*rig.hexrgb('#fbf8f0'), 1); fb.inputs['Roughness'].default_value = 0.55
fb.inputs['Sheen Weight'].default_value = 0.4
red = rig.plastic('red', rig.hexrgb('#e0101c'), rough=0.25, coat=0.6)
beakm = rig.plastic('beak', rig.hexrgb('#ffb21c'), rough=0.3)
legm = rig.plastic('legs', rig.hexrgb('#f0a010'), rough=0.35)
inkm = rig.plastic('ink', (0.01, 0.01, 0.01), rough=0.05, coat=1.0)
parts = []
def P(o): parts.append(o); return o
P(rig.ball((0, 0, 0.0), 0.78, fm, 'body', 48, scale=(0.82, 1.05, 0.88)))                      # the body, plump
P(rig.ball((0, -0.5, 0.28), 0.5, fm, 'chest', 40, scale=(0.95, 0.85, 1.0)))                    # the chest
P(rig.ball((0, -0.55, 0.78), 0.36, fm, 'neck', 32, scale=(0.9, 0.9, 1.1)))
P(rig.ball((0, -0.62, 1.2), 0.36, fm, 'head', 40))
for sx in (-1, 1):                       # wings folded on the sides
    w = P(rig.ball((sx * 0.62, 0.0, 0.1), 0.5, fm, 'wing', 32, scale=(0.22, 0.95, 0.72))); w.rotation_euler = (math.radians(-12), 0, sx * math.radians(-6))
for a, s in ((-26, 0.5), (-8, 0.62), (10, 0.6), (28, 0.48)):                                    # tail feathers fanned up behind
    t = P(rig.ball((math.sin(math.radians(a)) * 0.5, 0.68, 0.75 + math.cos(math.radians(a)) * 0.3), s, fm, 'tail', 28, scale=(0.14, 0.3, 1.0)))
    t.rotation_euler = (math.radians(-12), 0, math.radians(-a * 0.6))
for x, z, s in ((-0.2, 1.58, 0.15), (-0.07, 1.64, 0.17), (0.07, 1.65, 0.16), (0.19, 1.59, 0.14)):   # the comb
    P(rig.ball((x * 0.9, -0.58, z), s, red, 'comb', 20, scale=(0.5, 1.0, 1.0)))
P(rig.ball((0, -0.58, 1.5), 0.2, red, 'combBase', 20, scale=(0.4, 1.0, 0.6)))
P(rig.ball((0, -0.86, 0.88), 0.11, red, 'wattle', 20, scale=(0.5, 0.6, 1.5)))               # wattle under the beak
P(rig.cone((0, -0.9, 1.22), (0, -1.28, 1.15), 0.12, 0.015, beakm, 20))
for sx in (-1, 1):
    P(rig.ball((sx * 0.2, -0.88, 1.27), 0.065, inkm, 'eye', 16))
    P(rig.ball((sx * 0.22, -0.935, 1.3), 0.017, rig.glow('glint', (1, 1, 1), 4.0), 'glint', 8))
for sx in (-1, 1):                       # legs and three-toed feet
    P(rig.tube('leg', [(sx * 0.26, -0.15, -0.55), (sx * 0.26, -0.15, -1.15)], 0.05, legm, 6))
    for ang in (-34, 0, 34):
        tx = math.sin(math.radians(ang)) * 0.28; ty = -math.cos(math.radians(ang)) * 0.3
        P(rig.tube('toe', [(sx * 0.26, -0.15, -1.15), (sx * 0.26 + tx, -0.15 + ty, -1.19)], 0.035, legm, 5))
    P(rig.tube('toe', [(sx * 0.26, -0.15, -1.15), (sx * 0.26, 0.05, -1.19)], 0.03, legm, 5))
rig.group(parts, loc=(0.0, 1.9, G + 1.43), rot=(0, 0, -26), scale=1.2)

# ---- light ---------------------------------------------------------------------------------------------
beam = rig.glow('beam', rig.hexrgb('#fff2d0'), 0.9, alpha=0.012)               # the spotlight's cone, from above the stage
rig.cone((0.2, 1.4, 6.6), (0.0, 1.9, G), 0.12, 1.6, beam, 48)
pool = rig.glow('pool', rig.hexrgb('#ffe9b8'), 0.7, alpha=0.07)                 # and its pool on the boards
bpy.ops.mesh.primitive_circle_add(vertices=64, radius=1.9, fill_type='NGON', location=(0, 1.9, G + 0.006)); po = bpy.context.object; po.data.materials.append(pool)
bpy.ops.object.light_add(type='SPOT', location=(0.6, -1.5, 7.6)); spot = bpy.context.object
spot.data.energy = 9000; spot.data.spot_size = math.radians(21); spot.data.spot_blend = 0.55; spot.data.color = (1.0, 0.93, 0.78)
spot.rotation_euler = (Vector((0, 1.9, G + 0.8)) - spot.location).to_track_quat('-Z', 'Y').to_euler()
rig.area('key', (-6, -9, 5), 5.0, 500, rgb=(1.0, 0.85, 0.8), look_at=(0, 0, 1.5), glossy=False)
rig.area('rimL', (-6, -2, 3), 3.0, 450, rgb=(1.0, 0.5, 0.45), look_at=(-2.2, -0.4, 1.0), glossy=False)
rig.area('rimR', (6.5, -3, 3), 3.0, 500, rgb=(1.0, 0.55, 0.45), look_at=(2.2, -0.4, 1.0), glossy=False)
rig.area('floorfill', (0, -6, 1), 6.0, 160, rgb=(1.0, 0.8, 0.6), look_at=(0, 0, G), glossy=False)
rig.world((0.02, 0.012, 0.015), 0.5)
rig.camera(50, elev=12, target=(0, 0, 0.3))
rig.render(OUT)
