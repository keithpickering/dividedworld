"""Feelin' Fab card art, after Minus World's original icon: a grinning cloud with a rainbow
standing out of it, the sun low behind hills, daisies at the foot. Seen from the grass, looking up at the cloud,
at sunset."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
C = Vector((0.0, 0.0, 1.9))              # the cloud's middle
RX, RY, RZ = 1.75, 1.0, 1.0              # the cloud's face is the front of this ellipsoid
EYE = Vector((1.9, -5.8, -0.35))         # where the camera stands: low in the grass, off to one side
G = -1.75                                # the grass under it

# ---- the sky: a sunset, banded by height above the horizon as the period's skies were -----------
w = bpy.data.worlds.new('sunset'); sc.world = w; w.use_nodes = True
n, l = w.node_tree.nodes, w.node_tree.links
tc = n.new('ShaderNodeTexCoord'); sx = n.new('ShaderNodeSeparateXYZ'); ramp = n.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
SKY = [(0.0, '#2a1030'), (0.49, '#7a2a3a'), (0.505, '#ffc04a'), (0.55, '#ff8a3a'), (0.62, '#f0508a'), (0.72, '#8a3aa8'), (0.86, '#2a2a8a'), (1.0, '#0c1040')]
cr.elements[0].position, cr.elements[0].color = SKY[0][0], (*rig.hexrgb(SKY[0][1]), 1)
cr.elements[1].position, cr.elements[1].color = SKY[-1][0], (*rig.hexrgb(SKY[-1][1]), 1)
for pos, hx in SKY[1:-1]:
    e = cr.elements.new(pos); e.color = (*rig.hexrgb(hx), 1)
half = n.new('ShaderNodeMath'); half.operation = 'MULTIPLY_ADD'; half.inputs[1].default_value = 0.5; half.inputs[2].default_value = 0.5   # up is 1, the horizon 0.5
l.new(tc.outputs['Generated'], sx.inputs[0]); l.new(sx.outputs['Z'], half.inputs[0]); l.new(half.outputs[0], ramp.inputs['Fac'])
l.new(ramp.outputs['Color'], n['Background'].inputs['Color']); n['Background'].inputs['Strength'].default_value = 1.0

# ---- the rainbow: six glossy pipes standing out of the cloud, leaning as they climb --------------
BANDS = ['#ff2a2a', '#ff8a1c', '#ffe21c', '#2fd24a', '#2a7dff', '#9a3df0']
PIPE = 0.26
for i, hx in enumerate(BANDS):
    x0 = (i - 2.5) * PIPE * 1.9
    pts = []
    for k in range(41):
        t = k / 40; z = C.z + 0.3 + t * 9.0
        pts.append((x0 * (1 + 0.28 * t) - 0.75 * t * t - 0.05, 0.55 + 0.5 * t, z))   # fans a little, leans left
    rig.tube('band', pts, PIPE, rig.plastic(f'band{i}', rig.hexrgb(hx), rough=0.08, coat=1.0, emit=0.25), res=8)

# ---- the cloud: one broad body for the face, lumps around its rim --------------------------------
fluff = rig.plastic('cloud', (0.8, 0.8, 0.86), rough=0.55)
rig.ball(C, 1.0, fluff, 'cloud', 64, scale=(RX, RY, RZ))
LUMPS = [(-1.55, 0.45, 0.8), (-0.85, 0.85, 0.85), (0.05, 0.95, 0.9), (0.95, 0.8, 0.85), (1.6, 0.35, 0.8),
         (-1.95, -0.25, 0.7), (1.95, -0.3, 0.72), (-1.3, -0.7, 0.75), (-0.35, -0.85, 0.8), (0.65, -0.82, 0.8), (1.4, -0.7, 0.7)]
for x, z, r in LUMPS:
    rig.ball(C + Vector((x, 0.35, z)), r, fluff, 'lump', 40)

def face(x, z, lift=0.0):
    """The point on the cloud's front over (x, z), measured from its middle, lifted off it by `lift`."""
    k = max(0.0, 1 - (x / RX) ** 2 - (z / RZ) ** 2)
    return C + Vector((x, -RY * math.sqrt(k) - lift, z))

ink = rig.plastic('ink', (0.02, 0.025, 0.05), rough=0.6)
tooth = rig.plastic('tooth', (1.0, 1.0, 0.97), rough=0.1, coat=1.0)
for side in (-1, 1):                                             # eyes shut in a grin: two arcs, ends down
    rig.tube('eye', [face(side * 0.62 + math.cos(a) * 0.3, 0.3 + math.sin(a) * 0.2, 0.02) for a in (math.radians(20 + 140 * j / 16) for j in range(17))], 0.07, ink, res=6)
# the grin: a dark bed, curved up at the corners, and a row of teeth standing on it
smile = lambda t: (t * 0.95, -0.34 + 0.22 * t * t)                # t from -1 to 1
rig.tube('grin', [face(*smile(t), 0.0) for t in (j / 24 * 2 - 1 for j in range(25))], 0.26, ink, res=8)
TEETH = 7
for j in range(TEETH):
    t = (j + 0.5) / TEETH * 2 - 1
    x, z = smile(t * 0.9)
    p = face(x, z, 0.24)
    bpy.ops.mesh.primitive_cube_add(size=1, location=p)
    o = bpy.context.object; o.scale = (0.225, 0.12, 0.3); o.rotation_euler = (0, -math.atan(0.44 * t * 0.9), -x * 0.45)
    md = o.modifiers.new('bevel', 'BEVEL'); md.width = 0.035; md.segments = 3
    o.data.materials.append(tooth)

# ---- the sun, going down behind the far hills ----------------------------------------------------
SUN = Vector((-17.0, 60.0, EYE.z + 3.0))
rig.ball(SUN, 3.6, rig.glow('sun', rig.hexrgb('#fff2b0'), 3.0), 'sun', 48)
for r, a in ((6.5, 0.22), (11.0, 0.1), (17.0, 0.05)):             # its glow, in three soft shells
    rig.ball(SUN + Vector((0, 2, 0)), r, rig.glow('glow', rig.hexrgb('#ffb04a'), 1.6, alpha=a), 'glow', 32)
far = rig.plastic('far-hill', rig.hexrgb('#3a4a5a'), rough=0.7, emit=0.2)
mid = rig.plastic('mid-hill', rig.hexrgb('#2a8a3c'), rough=0.5, emit=0.22)
for x, y, r, k, m_ in ((-24, 48, 16, 0.04, far), (4, 52, 20, 0.02, far), (30, 46, 15, 0.06, far), (-12, 26, 9, 0.3, mid), (14, 24, 10, 0.26, mid), (-2, 15, 6, 0.24, mid)):
    rig.ball((x, y, EYE.z - 0.9), r, m_, 'hill', 64, scale=(1, 1, k + 0.12))

# ---- the near hill, and the daisies on it ----------------------------------------------------------
hill = rig.plastic('hill', rig.hexrgb('#2fae3a'), rough=0.35)
H0 = Vector((0.6, 0.6, G - 7.0)); HR = 7.0
rig.ball(H0, HR, hill, 'near-hill', 96)
rig.floor(G - 1.2, far, size=400, y=60)
petal = rig.plastic('petal', (1.0, 0.97, 0.95), rough=0.25)
heart = rig.plastic('heart', rig.hexrgb('#ffc21c'), rough=0.2, coat=1.0)
for x, y, s in ((-1.6, -1.4, 1.0), (0.2, -0.6, 1.1), (2.6, -1.2, 1.0), (-0.5, 1.0, 0.9), (1.7, 0.8, 0.9), (3.4, 0.6, 0.8), (-2.6, 0.4, 0.9), (0.9, 2.4, 0.8), (-1.6, 2.6, 0.8), (3.0, 2.8, 0.8)):
    z = H0.z + math.sqrt(max(0.0, HR * HR - (x - H0.x) ** 2 - (y - H0.y) ** 2))
    p = Vector((x, y, z + 0.5 * s))
    rig.cone((x, y, z - 0.05), p, 0.025 * s, 0.02 * s, rig.plastic('stem', rig.hexrgb('#1f8a2a'), rough=0.4), 8)
    facing = (EYE - p).normalized(); side = facing.cross(Vector((0, 0, 1))).normalized(); up = side.cross(facing)
    for j in range(8):
        a = j / 8 * math.tau
        rig.ball(p + (side * math.cos(a) + up * math.sin(a)) * 0.2 * s, 0.11 * s, petal, 'petal', 16)
    rig.ball(p + facing * 0.06 * s, 0.13 * s, heart, 'heart', 20)

# ---- the first stars, high in the dark of the sky ---------------------------------------------------
glint = rig.glow('star', (1.0, 1.0, 1.0), 2.5)
for x, z, s in ((-7, 21, 0.5), (5, 24, 0.4), (10, 16, 0.32), (-12, 14, 0.3), (1, 28, 0.3), (14, 26, 0.25)):
    o = rig.slab('star', rig.star(4, s, s * 0.24), -0.05, 0.05, glint, 0.02); o.location = (x, 30, z)
    o.rotation_euler = (math.radians(-25), 0, 0)

# ---- light: the low sun from behind, warm from under, a cool lamp from the camera's side -----------
sl = bpy.data.lights.new('sunlight', 'SUN'); sl.energy = 3.5; sl.color = (1.0, 0.6, 0.3); sl.angle = math.radians(3)
so = bpy.data.objects.new('sunlight', sl); sc.collection.objects.link(so)
so.rotation_euler = (C - SUN).to_track_quat('-Z', 'Y').to_euler()
rig.area('under', (-3.5, 1.5, -2.0), 4.0, 1100, rgb=(1.0, 0.5, 0.3), look_at=tuple(C), glossy=False)
rig.area('face', (4.5, -8, 2.5), 5.0, 480, rgb=(0.85, 0.8, 1.0), look_at=tuple(C))
rig.area('grass', (0, -6, 3), 4.0, 700, rgb=(1.0, 0.85, 0.8), look_at=(0.5, -1.5, G))

cam = rig.camera(28)                                              # wide and close, looking up
cam.location = EYE
cam.rotation_euler = (Vector((0.25, 0.0, 0.8)) - EYE).to_track_quat('-Z', 'Y').to_euler()
rig.render(OUT)
