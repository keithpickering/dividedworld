"""SoVeryHappy card art: the old forum smiley, a head that is nearly all mouth, hanging in a dark room and staring
straight out of the card. It is lit from under its chin, so its shadow climbs the wall behind it, and a door stands
ajar at the back. (The card springs on the next cast on its post and locks that caster out of the thread for a day.)
The head is built from the smiley's own 17 by 26 pixel grid: `px` turns a pixel's column and row into the card's
x and z, so each feature sits where the smiley has it. Its cap reads SVH, as the larger drawings of it did."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy, bmesh
from mathutils import Vector, Quaternion
import rig

OUT = sys.argv[-1]
def setting(name, default): return tuple(float(v) for v in os.environ.get(name, default).split())
sc = rig.reset()
U, TOP = 0.21, 3.5                       # one pixel of the smiley, and the height of its top row
def px(col, row): return ((col - 8) * U, TOP - row * U)
EYE = Vector(setting('SVH_EYE', '0 -10.6 -0.2'))    # where the camera stands
AIM = Vector(setting('SVH_AIM', '0 0 0.45'))      # what it looks at
ROLL = setting('SVH_ROLL', '-3')[0]      # its tilt about its own line of sight, in degrees
FOG = setting('SVH_FOG', '0.004')[0]     # how thick the room's air is; 0 for none

# ---- the room: a tiled floor, papered walls, a door ajar at the back -------------------------------
G = -4.7                                 # the floor
rig.floor(G, rig.checker('floor', '#02060c', '#0b2238', 30, rough=0.12), size=60, y=6)
m, n, l, b = rig.material('paper')       # striped wallpaper, stained toward the ceiling
tc = n.new('ShaderNodeTexCoord'); wave = n.new('ShaderNodeTexWave'); wave.inputs['Scale'].default_value = 5.5; wave.inputs['Distortion'].default_value = 0.0
noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 1.3; noise.inputs['Detail'].default_value = 6
l.new(tc.outputs['Object'], wave.inputs['Vector']); l.new(tc.outputs['Object'], noise.inputs['Vector'])
stripes = rig.mix_color(n, l, wave.outputs['Fac'], rig.hexrgb('#0a1a2c'), rig.hexrgb('#1c3f63'))
l.new(rig.mix_color(n, l, noise.outputs['Fac'], rig.hexrgb('#03070c'), stripes), b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.7
BACK, SIDE, CEIL = 8.0, 6.5, 7.0
def wall(loc, rot, sx, sy):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=[math.radians(a) for a in rot])
    o = bpy.context.object; o.scale = (sx, sy, 1); o.data.materials.append(m)
    return o
DOOR_X, DOOR_W, DOOR_H = 3.3, 2.2, 6.6   # the doorway: its middle, its width and its height
for x0, x1 in ((-SIDE, DOOR_X - DOOR_W / 2), (DOOR_X + DOOR_W / 2, SIDE)):          # the back wall, either side of the doorway
    wall(((x0 + x1) / 2, BACK, (G + CEIL) / 2), (90, 0, 0), x1 - x0, CEIL - G)
wall((DOOR_X, BACK, (G + DOOR_H + CEIL) / 2), (90, 0, 0), DOOR_W, CEIL - G - DOOR_H)   # and above it
for sx in (-1, 1):
    wall((sx * SIDE, -4, (G + CEIL) / 2), (90, 0, 90), 24, CEIL - G)
wall((0, -4, CEIL), (0, 0, 0), 2 * SIDE, 24)
wood = rig.plastic('wood', rig.hexrgb('#1a0d08'), rough=0.35)
for x in (DOOR_X - DOOR_W / 2 - 0.12, DOOR_X + DOOR_W / 2 + 0.12):                  # the door's frame
    rig.box('jamb', 0.24, 0.3, DOOR_H + 0.24, wood, (x, BACK - 0.1, G))
rig.box('lintel', DOOR_W + 0.48, 0.3, 0.24, wood, (DOOR_X, BACK - 0.1, G + DOOR_H))
door = rig.box('door', DOOR_W, 0.12, DOOR_H, wood, (0, 0, 0))                       # hinged on its right, swung most of the way shut
hinge = bpy.data.objects.new('hinge', None); sc.collection.objects.link(hinge); hinge.location = (DOOR_X + DOOR_W / 2, BACK, G)
door.parent = hinge; door.location = (-DOOR_W / 2, 0, DOOR_H / 2); hinge.rotation_euler = (0, 0, math.radians(-48))
rig.ball((DOOR_X - DOOR_W / 2 + 0.5, BACK - 0.75, G + 3.0), 0.13, rig.plastic('knob', (0.9, 0.75, 0.4), rough=0.15, metallic=1.0), 'knob')
hall = rig.glow('hall', rig.hexrgb('#9fd8ff'), 5.0)                                 # the lit hall beyond it
bpy.ops.mesh.primitive_plane_add(size=1, location=(DOOR_X, BACK + 2.5, G + DOOR_H / 2), rotation=(math.radians(90), 0, 0))
o = bpy.context.object; o.scale = (6, DOOR_H + 2, 1); o.data.materials.append(hall)
rig.area('hall', (DOOR_X - 0.4, BACK + 1.5, G + 3.5), 1.2, 2600, rgb=(0.55, 0.8, 1.0), look_at=(DOOR_X - 2.5, 0, G), size_y=5.0)
if FOG > 0:                              # thin air, so the hall's light shows as a shaft
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -3, (G + CEIL) / 2)); o = bpy.context.object; o.scale = (2 * SIDE - 0.2, 21.5, CEIL - G - 0.2)
    fm = bpy.data.materials.new('fog'); fm.use_nodes = True; fn = fm.node_tree.nodes; fn.remove(fn['Principled BSDF'])
    vol = fn.new('ShaderNodeVolumePrincipled'); vol.inputs['Density'].default_value = FOG; vol.inputs['Color'].default_value = (0.7, 0.85, 1.0, 1)
    fm.node_tree.links.new(vol.outputs[0], fn['Material Output'].inputs['Volume']); o.data.materials.append(fm)

# ---- the head: a cap, two eyes and a nose over a mouth with no chin under it -----------------------
skin = rig.plastic('skin', rig.hexrgb('#f2b27a'), rough=0.3, coat=0.4)
red = rig.plastic('cap', rig.hexrgb('#e00008'), rough=0.16, coat=1.0)
black = rig.plastic('black', (0.004, 0.004, 0.005), rough=0.35)
white = rig.plastic('white', (0.92, 0.92, 0.88), rough=0.07, coat=1.0)
tooth = rig.plastic('tooth', rig.hexrgb('#f3ecd2'), rough=0.1, coat=1.0)
iris = rig.plastic('iris', rig.hexrgb('#ff0010'), rough=0.1, coat=1.0, emit=3.0)
gum = rig.plastic('gum', rig.hexrgb('#3a0206'), rough=0.12, coat=1.0)
tongue = rig.plastic('tongue', rig.hexrgb('#d0060c'), rough=0.14, coat=1.0, emit=0.12)
R = 1.52                                 # the skull
HZ = px(8, 9.5)[1]                       # its middle, at the eyes' row
rig.ball((0, 0, HZ), R, skin, 'head', 48, scale=(1.04, 1, 0.98))
rig.ball((0, 0.4, HZ + 0.05), R, black, 'hair', 48, scale=(1.07, 1, 1))             # shows as the dark at the temples
for sx in (-1, 1):
    rig.ball((sx * 1.62, 0.1, px(0, 12)[1]), 0.36, skin, 'ear', 32, scale=(0.55, 0.9, 1.1))
CZ = px(8, 5.6)[1]                       # the cap sits down on the brow
rig.lathe('cap', [(1.63, -0.1), (1.64, 0.15), (1.56, 0.5), (1.32, 0.86), (0.9, 1.1), (0.45, 1.2), (0.0, 1.22)], red, (0, 0.05, CZ))
brim = rig.ball((0, -1.2, CZ - 0.02), 1.0, red, 'brim', 48, scale=(1.62, 1.05, 0.2)); brim.rotation_euler.x = math.radians(9)
badge = rig.ball((0, -1.47, CZ + 0.62), 0.47, white, 'badge', 48, scale=(1, 0.2, 1)); badge.rotation_euler.x = math.radians(-24)
rig.text('SVH', 0.36, red, (0, -1.56, CZ + 0.63), depth=0.02, bevel=0.006, rot=(math.radians(-24), 0, 0))
for sx in (-1, 1):                       # the eyes: bulging out of the head, a red ring round a pinprick, looking dead ahead
    ex, ez = sx * 0.62, px(8, 10.1)[1]
    for r, mat, y, sy in ((0.62, white, -1.3, 0.82), (0.23, iris, -1.77, 0.3), (0.085, black, -1.82, 0.3)):
        rig.ball((ex - sx * 0.05 * (mat is not white), y, ez), r, mat, 'eye', 48, scale=(0.94, sy, 1.12))
    rig.tube('brow', [(sx * (0.1 + 1.1 * t), -1.86 + 0.55 * t * t, ez + 0.42 + 0.5 * t + 0.08 * math.sin(math.pi * t)) for t in (j / 10 for j in range(11))], 0.13, black, res=5)   # low over the nose, high at the temples
rig.ball((0, -1.98, px(8, 13)[1] + 0.08), 0.42, skin, 'nose', 40, scale=(1.12, 1, 1))     # out in front of the mustache
hair = rig.plastic('mustache', (0.006, 0.004, 0.003), rough=0.6)
MZ = px(8, 13.7)[1]
for sx in (-1, 1):                       # the mustache, which the smiley's few pixels run into the mouth: three lobes a side, the last turned up
    for x, y, dz, r in ((0.3, -1.64, 0.0, 0.38), (0.8, -1.54, -0.08, 0.4), (1.3, -1.3, 0.04, 0.32)):
        rig.ball((sx * x, y, MZ + dz), r, hair, 'mustache', 40, scale=(1.15, 0.7, 0.95))

# ---- the mouth: the smiley's own outline, a pit behind it, teeth round its rim ---------------------
def smooth(pts, passes=3):
    """Round a closed outline's corners."""
    for _ in range(passes):
        out = []
        for a, b in zip(pts, pts[1:] + pts[:1]):
            out += [(a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25), (a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75)]
        pts = out
    return pts
HALF = [(4.0, 12.9), (6.2, 13.1), (6.7, 14.6), (6.3, 17.0), (5.6, 19.2), (4.8, 21.2), (3.8, 23.0), (2.6, 24.6), (1.3, 25.8)]   # half its width, in pixels, down its rows
MOUTH = smooth([px(8 + w, r) for w, r in HALF] + [px(8, 26.2)] + [px(8 - w, r) for w, r in reversed(HALF)])
MC = px(8, 18.5)                         # the pit narrows toward this
Y0 = -1.38                               # the mouth's front
def pit(name, grow, depth, mat, rings=16):
    """The outline carried back and drawn in to a point: grow widens it, depth is how far back it goes."""
    bm = bmesh.new(); rows = []
    for k in range(rings):
        t = k / rings; s = grow * math.cos(t * math.pi / 2)
        rows.append([bm.verts.new((MC[0] + (x - MC[0]) * s, Y0 + depth * math.sin(t * math.pi / 2), MC[1] + (z - MC[1]) * s)) for x, z in MOUTH])
    tip = bm.verts.new((MC[0], Y0 + depth, MC[1])); N = len(MOUTH)
    for a, b in zip(rows, rows[1:]):
        for i in range(N): bm.faces.new((a[i], a[(i + 1) % N], b[(i + 1) % N], b[i]))
    for i in range(N): bm.faces.new((rows[-1][i], rows[-1][(i + 1) % N], tip))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for f in me.polygons: f.use_smooth = True
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); me.materials.append(mat)
    return o
pit('gullet', 1.0, 2.3, rig.plastic('gullet', (0.012, 0.0, 0.001), rough=0.22))
pit('jaw', 1.05, 2.45, skin)
rig.tube('rim', [(MC[0] + (x - MC[0]) * 1.03, Y0 - 0.02, MC[1] + (z - MC[1]) * 1.03) for x, z in MOUTH + MOUTH[:1]], 0.085, rig.plastic('lips', rig.hexrgb('#5a0c12'), rough=0.2, coat=1.0), res=5)
throat = bpy.data.lights.new('throat', 'POINT'); throat.energy = 14; throat.color = (1.0, 0.03, 0.02); throat.shadow_soft_size = 0.3
o = bpy.data.objects.new('throat', throat); sc.collection.objects.link(o); o.location = (0, Y0 + 1.5, MC[1] + 0.1)   # something glows a long way down

def teeth(xs, line, w, h, up):
    """A row of teeth along the line z = line(x), each square to it, with the gum they grow from."""
    for x in xs:
        z = line(x); slope = math.atan((line(x + 0.01) - line(x - 0.01)) / 0.02)
        o = rig.slab('tooth', rig.rrect(w, h, w * 0.32), -0.08, 0.08, tooth, 0.035)
        o.location = (x, Y0 + 0.1 + 0.22 * (x / 1.2) ** 2, z); o.rotation_euler.y = -slope
    lift = (0.42 if up else -0.42) * h   # the gum: behind the teeth's roots
    rig.tube('gum', [(x, Y0 + 0.2 + 0.22 * (x / 1.2) ** 2, line(x) - lift) for x in (xs[0] - w * 0.6 + (xs[-1] - xs[0] + w * 1.2) * j / 24 for j in range(25))], 0.17, gum, res=5)
upper = lambda x: px(8, 16.2)[1] + 0.42 * (x / 1.05) ** 2          # the smiley's grin: its ends two rows above its middle
teeth([-1.08 + 0.36 * j for j in range(7)], upper, 0.34, 0.5, False)
lower = lambda x: px(8, 24.5)[1] + 0.2 * (x / 0.42) ** 2           # and the few at the foot of it
teeth([-0.44 + 0.22 * j for j in range(5)], lower, 0.2, 0.32, True)
t = rig.ball((0, Y0 + 0.5, px(8, 22.3)[1]), 0.5, tongue, 'tongue', 40, scale=(1.05, 1.5, 0.5)); t.rotation_euler.x = math.radians(-14)

# ---- the light: from under the chin, with red behind ----------------------------------------------
LOOK = (0, 0, 0.6)
rig.area('under', (0, -6.5, -3.8), 1.2, 900, rgb=(0.62, 0.85, 1.0), look_at=LOOK)     # throws the head's shadow up the back wall
rig.area('red', (3.2, 5.5, 4.5), 1.6, 1100, rgb=(1.0, 0.05, 0.03), look_at=LOOK)
rig.area('cold', (-4.5, 4.5, 1.0), 2.0, 500, rgb=(0.25, 0.56, 0.82), look_at=LOOK, glossy=False)
rig.area('fill', (-2.5, -9, 5.5), 3.0, 110, rgb=(0.5, 0.75, 1.0), look_at=LOOK, glossy=False)                # just enough to read the cap
rig.world((0.01, 0.025, 0.05), 0.15)
cam = rig.camera(40)                     # close, level with its nose, the room a little off true
cam.location = EYE
cam.rotation_euler = ((AIM - EYE).to_track_quat('-Z', 'Y') @ Quaternion((0, 0, 1), math.radians(ROLL))).to_euler()
rig.render(OUT)
