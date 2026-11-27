"""Steel Chair card art: a folding chair caught at the end of its swing, its back already dented, over a wrestling
ring at night: the ropes and a corner post behind it, spotlights in the haze, flashbulbs in the dark. (The card dents
a post's box at one corner, stays, and covers none of its words.) Nobody holds the chair and nobody is hit: the
picture is the chair."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy, bmesh
from mathutils import Vector, Quaternion
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('CHAIR_SEED', '5')))
def setting(name, default): return tuple(float(v) for v in os.environ.get(name, default).split())
sc = rig.reset()
EYE = Vector(setting('CHAIR_EYE', '0 -9.6 -1.6'))    # where the camera stands: low, looking up at the swing
AIM = Vector(setting('CHAIR_AIM', '0 0 0.7'))
ROLL = setting('CHAIR_ROLL', '6')[0]     # its tilt about its own line of sight, in degrees
POSE = setting('CHAIR_POSE', '34 18 -32')            # the chair's turn, in degrees about x, y and z
AT = Vector(setting('CHAIR_AT', '0.1 0.8 -2.2'))     # where its feet's middle is
SIZE = setting('CHAIR_SIZE', '1.45')[0]

# ---- the arena: a mat, three ropes round a corner post, the dark beyond ----------------------------
rig.backdrop(26, [(0.0, '#010309'), (0.45, '#06203c'), (0.75, '#0f4a80'), (1.0, '#020814')]).scale = (90, 60, 1)
G = -3.6                                 # the mat
m, n, l, b = rig.material('mat'); b.inputs['Base Color'].default_value = (*rig.hexrgb('#27628f'), 1); b.inputs['Roughness'].default_value = 0.45
rig.box('ring', 30, 30, 0.6, m, (-9, 3, G - 0.6), bevel=0.08)      # its corner is at x 6, y 18
POST = Vector((6.0 - 0.5, 18.0 - 0.5, G))
steel = rig.plastic('post', (0.75, 0.8, 0.85), rough=0.2, metallic=1.0)
rig.cone(POST, POST + Vector((0, 0, 5.4)), 0.22, 0.22, steel)
pad = rig.plastic('pad', rig.hexrgb('#d8121c'), rough=0.3, coat=0.5)
for k, (z, mat) in enumerate(((1.5, rig.plastic('rope-a', rig.hexrgb('#e8eef5'), rough=0.4)), (3.1, rig.plastic('rope-b', rig.hexrgb('#3f8fd2'), rough=0.4)), (4.7, rig.plastic('rope-c', rig.hexrgb('#e8eef5'), rough=0.4)))):
    P = POST + Vector((-0.55, -0.55, z))
    rig.tube('rope', [P + Vector((-30, 0, 0)), P], 0.11, mat, res=4)                  # along the back
    rig.tube('rope', [P, P + Vector((0, -30, 0))], 0.11, mat, res=4)                  # and down the side toward the camera
    o = rig.box('turnbuckle', 0.9, 0.5, 0.75, pad, tuple(P + Vector((0.05, 0.05, -0.37))), bevel=0.12); o.rotation_euler.z = math.radians(45)
for i in range(46):                      # the crowd: flashbulbs a long way off
    hx = rnd.choice(['#ffffff', '#cfe8ff', '#3f8fd2', '#fff1c0'])
    rig.ball((rnd.uniform(-22, 22), rnd.uniform(21, 25), rnd.uniform(-5, 9)), rnd.uniform(0.18, 0.6), rig.glow('flash', rig.hexrgb(hx), rnd.uniform(0.6, 3.0), alpha=0.5), 'flash', 16)
beam = rig.glow('beam', rig.hexrgb('#bfe2ff'), 0.9, alpha=0.03)                       # two spotlights crossing in the haze
for x0, x1 in ((-9, 2.5), (10, -3.5)):
    rig.cone((x0, 16, 16), (x1, 12, G), 0.2, 2.4, beam, 48)

# ---- the chair: a tube frame, a seat, a back with a dent in it ------------------------------------
chrome = rig.plastic('chrome', (0.9, 0.93, 0.97), rough=0.05, metallic=1.0)
paint = rig.plastic('paint', rig.hexrgb('#8fa3b5'), rough=0.22, metallic=0.85, coat=0.6)   # the seat and back: grey enamel on steel
rubber = rig.plastic('rubber', (0.01, 0.01, 0.012), rough=0.5)
X = Vector((1, 0, 0))
FOOT, TOP = Vector((0, -0.95, 0)), Vector((0, 0.55, 3.75))       # the front legs run up into the back's frame
UP = (TOP - FOOT).normalized(); BACKWARD = Vector((0, UP.z, -UP.y))                      # along the frame, and square to it
HW, RAD, TUBE = 1.0, 0.32, 0.075
def at(z): return FOOT + UP * (z / UP.z)                          # the point on the frame's line at height z
pts = [FOOT - X * HW, TOP - X * HW - UP * RAD]
pts += [TOP - UP * RAD - X * (HW - RAD) - X * RAD * math.cos(a) + UP * RAD * math.sin(a) for a in (math.pi / 2 * j / 8 for j in range(1, 9))]
pts += [Vector((-p.x, p.y, p.z)) for p in reversed(pts)]
parts = [rig.tube('frame', [tuple(p) for p in pts], TUBE, chrome, res=6)]
PIVOT, REAR = at(2.15), Vector((0, 1.1, 0))                       # the back legs hinge on the frame and stand behind it
for sx in (-1, 1):
    parts.append(rig.tube('leg', [tuple(REAR + X * sx * 0.9), tuple(PIVOT + X * sx * 0.9)], TUBE, chrome, res=6))
    for foot in (FOOT + X * sx * HW, REAR + X * sx * 0.9):
        parts.append(rig.ball(tuple(foot), 0.1, rubber, 'foot', 16))
    parts.append(rig.ball(tuple(PIVOT + X * sx * 0.95), 0.09, chrome, 'rivet', 16))
parts.append(rig.tube('brace', [tuple(at(0.7) - X * HW), tuple(at(0.7) + X * HW)], TUBE * 0.8, chrome, res=6))
low = REAR.lerp(PIVOT, 0.3)
parts.append(rig.tube('brace', [tuple(low - X * 0.9), tuple(low + X * 0.9)], TUBE * 0.8, chrome, res=6))
seat = rig.slab('seat', rig.rrect(1.84, 1.7, 0.2), -0.05, 0.05, paint, 0.04)
seat.rotation_euler.x = math.radians(90 - 4); seat.location = (0, -0.05, 1.95); parts.append(seat)

def panel(name, base, across, tall, dent, at_s, at_t, nx=48, nt=28):
    """The back: a sheet across the frame from `base` up, bowed a little, with a dent `dent` deep at (at_s, at_t)."""
    bm = bmesh.new(); grid = []
    for j in range(nt + 1):
        row = []
        for i in range(nx + 1):
            s = across * (i / nx - 0.5); t = tall * j / nt
            r2 = (s - at_s) ** 2 + (t - at_t) ** 2
            d = 0.07 * (s / (across / 2)) ** 2 - 0.05                                    # bowed to a sitter's back
            d += dent * math.exp(-r2 / 0.07) + dent * 0.16 * math.sin(11 * s + 7 * t) * math.exp(-r2 / 0.22)   # the dent, and the crumple round it
            row.append(bm.verts.new(base + X * s + UP * t + BACKWARD * d))
        grid.append(row)
    for a, b_ in zip(grid, grid[1:]):
        for i in range(nx): bm.faces.new((a[i], a[i + 1], b_[i + 1], b_[i]))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for f in me.polygons: f.use_smooth = True
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); me.materials.append(paint)
    o.modifiers.new('thick', 'SOLIDIFY').thickness = 0.05
    return o
parts.append(panel('back', at(2.72), 1.86, 0.98, 0.3, 0.38, 0.52))
chair = rig.group(parts, loc=tuple(AT), rot=POSE, scale=SIZE)

# ---- the hit: a burst behind the dented corner, and what flew off it ------------------------------
bpy.context.view_layer.update()
HIT = chair.matrix_world @ (at(3.25) + X * 0.4 + BACKWARD * 0.5)
toward = (EYE - HIT).normalized()
for r_out, r_in, hx, glow_, back, turn in ((3.3, 1.5, '#ff8a1c', 2.2, 1.3, 0.2), (2.0, 0.95, '#fff4b0', 3.0, 1.1, 0.0)):
    o = rig.slab('burst', rig.star(11, r_out, r_in, turn), -0.03, 0.03, rig.glow('burst', rig.hexrgb(hx), glow_), 0.0)
    o.location = HIT - toward * back     # a slab stands flat to the card, and the camera is nearly square to it
spark = rig.glow('spark', rig.hexrgb('#fff0a0'), 9.0)
for i in range(26):
    a = rnd.uniform(0, math.tau); d = rnd.uniform(1.9, 3.5)
    p = HIT + Vector((math.cos(a) * d, rnd.uniform(-1.2, 0.2), math.sin(a) * d * 0.9))
    rig.tube('spark', [tuple(p), tuple(p + (p - HIT).normalized() * rnd.uniform(0.15, 0.5))], rnd.uniform(0.012, 0.03), spark, res=2)
hit = bpy.data.lights.new('hit', 'POINT'); hit.energy = 500; hit.color = (1.0, 0.75, 0.35); hit.shadow_soft_size = 0.5
o = bpy.data.objects.new('hit', hit); sc.collection.objects.link(o); o.location = HIT - toward * 0.4

LOOK = tuple(AT + Vector((0, 0, 2.0)))
rig.area('key', (-6, -8, 7), 4.0, 2300, look_at=LOOK)
rig.area('window', (4.5, -7, 1), 1.0, 1200, look_at=LOOK, size_y=8.0)                 # the long shine down the tubes
rig.area('rim', (6, 6, 5), 4.0, 2600, rgb=(0.25, 0.56, 0.95), look_at=LOOK)
rig.area('mat', (-4, 6, 6), 6.0, 500, rgb=(0.7, 0.85, 1.0), look_at=(0, 8, G), glossy=False)
rig.world((0.01, 0.04, 0.09), 0.6)
cam = rig.camera(35)
cam.location = EYE
cam.rotation_euler = ((AIM - EYE).to_track_quat('-Z', 'Y') @ Quaternion((0, 0, 1), math.radians(ROLL))).to_euler()
rig.render(OUT)
