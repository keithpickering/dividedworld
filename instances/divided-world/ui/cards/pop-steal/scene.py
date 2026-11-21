"""Pop Steal card art: a black glove on a striped sleeve come down out of the rigging and closed round the rail of the
studio's APPLAUSE sign, which is still lit as it goes: its chains snapped, its plug out of the wall. The sign is in
Sweet's cyan and everything round it in Salty's pink. (The card springs on the first Sweet common cast on its post and
catches it; a pop is the crowd's cheer. It is Rope Break's mirror, so the hand comes down where that one comes up.)"""
import sys, os, math, random, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy, bmesh
from mathutils import Vector
import rig

OUT = sys.argv[-1]
HERE = os.path.dirname(os.path.abspath(__file__))
FACE = os.path.join(HERE, '..', '..', 'fonts', 'Anton-Regular.woff2')      # the glass's display face
rnd = random.Random(int(os.environ.get('POP_SEED', '7')))
sc = rig.reset()

def smooth(pts, passes=3):
    """Round an open path's corners, keeping its ends."""
    pts = [Vector(p) for p in pts]
    for _ in range(passes):
        out = [pts[0]]
        for a, c in zip(pts, pts[1:]): out += [a * 0.75 + c * 0.25, a * 0.25 + c * 0.75]
        pts = out + [pts[-1]]
    return [tuple(p) for p in pts]

# ---- the stage: a curtain in folds, the pool of light the sign hung in, the crowd's flashbulbs low down --------------
rig.backdrop(24, [(0.0, '#0c0106'), (0.5, '#3a0a22'), (1.0, '#12020a')]).scale = (80, 50, 1)
def curtain(y, mat):
    bm = bmesh.new(); NX, NZ = 240, 2
    rows = [[bm.verts.new((-13 + 26 * i / NX, y + 0.45 * math.sin(i * 0.52) + 0.2 * math.sin(i * 1.31 + 1), -9 + 18 * j / NZ)) for i in range(NX + 1)] for j in range(NZ + 1)]
    for a, b in zip(rows, rows[1:]):
        for i in range(NX): bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    me = bpy.data.meshes.new('curtain'); bm.to_mesh(me); bm.free()
    for f in me.polygons: f.use_smooth = True
    o = bpy.data.objects.new('curtain', me); sc.collection.objects.link(o); me.materials.append(mat)
    return o
curtain(7.0, rig.plastic('velvet', rig.hexrgb('#a3124f'), rough=0.42, coat=0.3))
for i in range(34):
    hx = rnd.choice(['#ffffff', '#ffd0e4', '#ff7fb0', '#fff1c0'])
    rig.ball((rnd.uniform(-5.5, 5.5), rnd.uniform(3.5, 5.5), rnd.uniform(-6.0, -2.2)), rnd.uniform(0.07, 0.22), rig.glow('flash', rig.hexrgb(hx), rnd.uniform(0.8, 2.6), alpha=0.5), 'flash', 16)

# ---- the sign, built hanging under its rail (the rail runs along x through the origin), then swung as one ----------
SW, SH, SD = 4.1, 1.3, 0.5               # the sign's box
TOP = -0.62                              # its top edge, under the rail
C = Vector((0, 0, TOP - SH / 2))
case = rig.plastic('case', rig.hexrgb('#1a1320'), rough=0.18, metallic=0.9)
chrome = rig.plastic('chrome', (0.9, 0.9, 0.95), rough=0.08, metallic=1.0)
face = rig.plastic('face', rig.hexrgb('#06323e'), rough=0.25, emit=0.0)
lit = rig.plastic('lit', rig.hexrgb('#2ee6ff'), rough=0.2, emit=5.0)
hotw = rig.plastic('letters', rig.hexrgb('#eaffff'), rough=0.2, emit=7.0)
bulb = rig.plastic('bulb', rig.hexrgb('#fff3c4'), rough=0.1, emit=9.0)
dead = rig.plastic('bulb-out', rig.hexrgb('#5a4a50'), rough=0.1, coat=1.0)
sign = []
o = rig.slab('case', rig.rrect(SW, SH, 0.16), -SD / 2, SD / 2, case, 0.05); o.location = C; sign.append(o)
o = rig.slab('lit', rig.rrect(SW - 0.5, SH - 0.5, 0.06), -SD / 2 - 0.02, 0, lit, 0.01); o.location = C; sign.append(o)
o = rig.slab('face', rig.rrect(SW - 0.62, SH - 0.62, 0.04), -SD / 2 - 0.04, 0, face, 0.01); o.location = C; sign.append(o)
def word(body, height, mat, loc):
    from fontTools.ttLib import TTFont                    # Blender reads no WOFF2: unpack the face to a TTF it can
    with tempfile.TemporaryDirectory() as tmp:
        ttf = os.path.join(tmp, 'face.ttf'); f = TTFont(FACE); f.flavor = None; f.save(ttf)
        t = rig.text(body, 1.0, mat, loc, depth=0.05, bevel=0.008); t.data.font = bpy.data.fonts.load(ttf); t.data.space_character = 1.12
        bpy.context.view_layer.update()
        t.data.size = height / t.dimensions.y; t.data.extrude = 0.05
        bpy.context.view_layer.objects.active = t; t.select_set(True); bpy.ops.object.convert(target='MESH')   # a mesh from here: the face file is gone with the folder
    return t
sign.append(word('APPLAUSE', SH - 0.78, hotw, C + Vector((0, -SD / 2 - 0.08, 0))))
N = 15                                                   # bulbs round the frame; two are out
for k in range(N):
    x = -SW / 2 + 0.13 + (SW - 0.26) * k / (N - 1)
    for sz in (-1, 1):
        sign.append(rig.ball((C.x + x, -SD / 2 - 0.03, C.z + sz * (SH / 2 - 0.13)), 0.075, dead if (k, sz) in ((3, -1), (11, 1)) else bulb, 'bulb', 16))
for k in range(1, 4):
    for sx in (-1, 1):
        sign.append(rig.ball((C.x + sx * (SW / 2 - 0.13), -SD / 2 - 0.03, C.z - SH / 2 + 0.13 + (SH - 0.26) * k / 4), 0.075, bulb, 'bulb', 16))
RAIL = SW / 2 + 0.25
sign.append(rig.tube('rail', [(-RAIL, 0, 0), (RAIL, 0, 0)], 0.1, chrome, res=8))
for sx in (-1, 1):
    sign.append(rig.ball((sx * RAIL, 0, 0), 0.15, chrome, 'knob', 20))
    sign.append(rig.cone((sx * (SW / 2 - 0.45), 0, 0), (sx * (SW / 2 - 0.45), 0, TOP), 0.06, 0.06, chrome, 16))

def links(pts, mat):
    """A chain along the points, one link at each, every other one turned."""
    out = []
    for k, (a, b) in enumerate(zip(pts, pts[1:])):
        a, b = Vector(a), Vector(b)
        bpy.ops.mesh.primitive_torus_add(major_radius=0.11, minor_radius=0.032, location=(a + b) / 2, major_segments=24, minor_segments=8)
        t = bpy.context.object; t.scale = (1.0, 1.55, 1.0); t.data.materials.append(mat); bpy.ops.object.shade_smooth()
        t.rotation_euler = (b - a).to_track_quat('Y', 'Z').to_euler()
        t.rotation_euler.rotate_axis('Y', math.radians(90 * (k % 2)))
        out.append(t)
    return out
for sx, bend in ((-1, 0.9), (1, -0.6)):                  # what is left of each chain, thrown up off the rail's end
    p = Vector((sx * (RAIL - 0.35), 0, 0.1)); pts = [tuple(p)]
    for k in range(5):
        a = math.radians(90 + sx * (-34) + bend * 16 * k); p = p + Vector((math.cos(a), 0, math.sin(a))) * 0.27; pts.append(tuple(p))
    sign += links(pts, chrome)

# the flex out of the sign's foot, and the plug at its end, pulled
flex = rig.plastic('flex', rig.hexrgb('#14030a'), rough=0.35)
F0 = C + Vector((-SW / 2 + 0.6, 0.1, -SH / 2))
path = smooth([tuple(F0), tuple(F0 + Vector((0, 0, -0.6))), tuple(F0 + Vector((0.45, -0.2, -1.0))), tuple(F0 + Vector((-0.2, -0.3, -1.45))), tuple(F0 + Vector((0.45, -0.4, -1.8))), tuple(F0 + Vector((0.75, -0.4, -2.1)))], 4)
sign.append(rig.tube('flex', path, 0.045, flex, res=6))
PLUG = Vector(path[-1]); PD = (Vector(path[-1]) - Vector(path[-4])).normalized()
sign.append(rig.cone(tuple(PLUG - PD * 0.05), tuple(PLUG + PD * 0.3), 0.09, 0.16, flex, 24))
sign.append(rig.cone(tuple(PLUG + PD * 0.3), tuple(PLUG + PD * 0.38), 0.16, 0.16, flex, 24))
side = Vector((PD.z, 0, -PD.x))
for s in (-1, 1):
    sign.append(rig.cone(tuple(PLUG + PD * 0.38 + side * 0.07 * s), tuple(PLUG + PD * 0.62 + side * 0.07 * s), 0.025, 0.025, chrome, 12))

# ---- the hand: built as Rope Break's (fingers over the rail, the arm below), then turned over so the arm is above -----
glove = rig.plastic('glove', rig.hexrgb('#1a1014'), rough=0.34, coat=0.35)
trim = rig.plastic('trim', rig.hexrgb('#ff3d7f'), rough=0.3, coat=0.5, emit=0.15)
stud = rig.plastic('stud', (0.95, 0.9, 0.95), rough=0.06, metallic=1.0)
white = rig.plastic('stripe', rig.hexrgb('#fbf6ec'), rough=0.55)
black = rig.plastic('stripe-dark', rig.hexrgb('#17090f'), rough=0.55)
hand = []
for k, x in enumerate((-0.54, -0.18, 0.18, 0.54)):
    reach = (0.0, 0.07, 0.05, -0.06)[k]
    path = smooth([(x, -0.5, -0.62), (x, -0.5, -0.05), (x, -0.36, 0.36 + reach), (x, 0.02, 0.45 + reach), (x, 0.34, 0.22), (x, 0.36, -0.12)])
    hand.append(rig.tube('finger', path, 0.18, glove, res=6))
    hand.append(rig.ball((x, -0.5, -0.05), 0.205, glove, 'knuckle', 20))
    hand.append(rig.ball((x, -0.7, -0.05), 0.07, stud, 'stud', 16))
hand.append(rig.tube('thumb', smooth([(-0.55, -0.55, -1.0), (-1.02, -0.5, -0.62), (-1.0, -0.3, -0.3), (-0.72, -0.08, -0.24)]), 0.205, glove, res=6))
hand.append(rig.ball((0, -0.52, -0.92), 0.8, glove, 'palm', 40, scale=(1.0, 0.42, 0.78)))
WRIST = Vector((0.05, -0.55, -1.55)); AX = Vector((-0.5, -0.05, -1.0)).normalized()
hand.append(rig.cone(tuple(WRIST + Vector((0, 0, 0.3))), tuple(WRIST + AX * 0.45), 0.56, 0.74, glove, 40))      # the gauntlet's flare
hand.append(rig.cone(tuple(WRIST + AX * 0.45), tuple(WRIST + AX * 0.6), 0.76, 0.78, trim, 40))
r = 0.52
for k in range(26):                                      # the sleeve, in a burglar's hoops
    a, b = WRIST + AX * (0.55 + 0.25 * k), WRIST + AX * (0.55 + 0.25 * (k + 1))
    hand.append(rig.cone(tuple(a), tuple(b), r, r + 0.03, white if k % 2 else black, 40)); r += 0.012
HX = 0.75                                                # where along the rail the hand has it
rig.group(hand, loc=(HX, 0, 0), rot=(0, 180, 0), scale=0.88)
hroot = hand[0].parent; sign.append(hroot)
SWING = float(os.environ.get('POP_SWING', '-9'))
AT = Vector((-0.15, 0, 0.95))                             # the rail's middle
rig.group(sign, loc=tuple(AT), rot=(4, SWING, -6))

# ---- the snap: links and sparks -------------------------------------------------------------------------------------
gold = rig.glow('star', rig.hexrgb('#fff1a0'), 3.0)
for x, z, r, turn in ((-2.0, 2.5, 0.3, 0.2), (2.25, 1.7, 0.22, -0.3), (-2.2, -1.7, 0.2, 0.5), (1.9, -2.0, 0.26, 0.1), (-0.5, -3.3, 0.22, 0.3), (0.1, -2.0, 0.16, -0.2)):
    o = rig.slab('star', rig.star(4, r, r * 0.3, turn), -0.02, 0.02, gold, 0.0); o.location = (x, -0.6, z)
tick = rig.glow('tick', (1, 1, 1), 2.5)
for x, z, a in ((-2.4, 0.1, 200), (-2.35, -0.4, 185), (2.3, -0.25, -20), (2.38, -0.75, -5)):          # it swings
    o = rig.slab('tick', rig.rrect(0.42, 0.045, 0.02, 2), -0.01, 0.01, tick, 0.0); o.location = (x, -0.4, z); o.rotation_euler.y = -math.radians(a)

# ---- the light --------------------------------------------------------------------------------------------------------
LOOK = (0, 0, 0.8)
beam = rig.glow('beam', rig.hexrgb('#ff8fbf'), 0.7, alpha=0.03)
rig.cone((-4.5, 4.0, 9.5), (0.2, 4.0, -1.5), 0.3, 2.6, beam, 64)
sp = bpy.data.lights.new('spot', 'SPOT'); sp.energy = 9000; sp.spot_size = math.radians(30); sp.spot_blend = 0.12; sp.color = (1.0, 0.7, 0.85)
so = bpy.data.objects.new('spot', sp); sc.collection.objects.link(so); so.location = (-3, -8, 9)
so.rotation_euler = (Vector((0.2, 7.0, 0.2)) - Vector(so.location)).to_track_quat('-Z', 'Y').to_euler()   # its pool on the curtain, where the sign hung
rig.area('key', (-5, -9, 6), 4.0, 1700, look_at=LOOK)
rig.area('window', (4.5, -7, 3), 1.0, 500, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 5, 6), 4.0, 2600, rgb=(1.0, 0.45, 0.75), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 350, rgb=(1.0, 0.85, 0.95), look_at=LOOK)
cy = bpy.data.lights.new('cyan', 'POINT'); cy.energy = 120; cy.color = (0.2, 0.9, 1.0); cy.shadow_soft_size = 1.0
co = bpy.data.objects.new('cyan', cy); sc.collection.objects.link(co); co.location = (0, -1.6, 0.2)   # the sign's own light on the glove
rig.world((0.12, 0.02, 0.08), 0.6)
rig.camera(50)
rig.render(OUT)
