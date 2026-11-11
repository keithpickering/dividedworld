"""Off Day card art exploration: a luchador's mask hung limp on a locker's coat hook under one bare bulb,
with a small grey raincloud raining on it and on nothing else."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('OFF_DAY_SEED', '4')))
sc = rig.reset()

# ---- the locker room: a row of pink doors, a bench at their foot ---------------------------------
WALL = 1.6
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, WALL + 0.2, 0), rotation=(math.radians(90), 0, 0))
w = bpy.context.object; w.scale = (30, 30, 1); w.data.materials.append(rig.plastic('gap', rig.hexrgb('#2a0818'), rough=0.8))
door = rig.plastic('door', rig.hexrgb('#c8327a'), rough=0.3, metallic=0.3)
dark = rig.plastic('slot', rig.hexrgb('#3a0a22'), rough=0.5)
chrome = rig.plastic('chrome', (1.0, 0.85, 0.92), rough=0.08, metallic=1.0)
for k in (-1, 0, 1):
    o = rig.slab('door', rig.rrect(2.9, 10.5, 0.06), -0.1, 0.1, door, 0.04); o.location = (k * 3.0, WALL, 0.4)
    if k:
        for j in range(5):
            o = rig.slab('vent', rig.rrect(1.5, 0.12, 0.05), -0.03, 0.03, dark, 0.01); o.location = (k * 3.0, WALL - 0.1, 3.7 - 0.3 * j)
    o = rig.slab('handle', rig.rrect(0.16, 0.7, 0.07), -0.08, 0.08, chrome, 0.03); o.location = (k * 3.0 + 1.15, WALL - 0.14, -0.6)
wood = rig.plastic('bench', rig.hexrgb('#7a2a4a'), rough=0.35)
rig.box('bench', 7.0, 2.2, 0.3, wood, (0, 0.2, -3.2), bevel=0.06)

# ---- the hook, and the mask hanging off it ---------------------------------------------------------
HOOK = Vector((0.0, WALL - 0.1, 2.85))
rig.ball(HOOK, 0.2, chrome, 'plate', 24, scale=(1, 0.3, 1))
rig.tube('hook', [tuple(HOOK), tuple(HOOK + Vector((0, -0.45, 0.0))), tuple(HOOK + Vector((0, -0.6, -0.12))), tuple(HOOK + Vector((0, -0.62, -0.32))),
                  tuple(HOOK + Vector((0, -0.75, -0.42))), tuple(HOOK + Vector((0, -0.92, -0.3)))], 0.07, chrome, res=6)

M = Vector((0.1, 0.75, 0.95))                     # the mask's middle
RX, RY, RZ = 1.02, 0.3, 1.42
teal = rig.plastic('mask', rig.hexrgb('#12c4c8'), rough=0.22, coat=1.0)
gold = rig.plastic('trim', rig.hexrgb('#ffd21c'), rough=0.15, coat=1.0)
hole = rig.plastic('hole', (0.02, 0.01, 0.03), rough=0.7)
lace = rig.plastic('lace', (1.0, 0.95, 0.9), rough=0.5)
def mf(x, z, lift=0.0):
    k = max(0.0, 1 - (x / RX) ** 2 - (z / RZ) ** 2)
    return (x, -RY * math.sqrt(k) - lift, z)
mask = [rig.ball((0, 0, 0), 1.0, teal, 'mask', 64, scale=(RX, RY, RZ)),
        rig.ball((-0.42, 0.02, -1.0), 0.55, teal, 'jowl', 40, scale=(1, 0.45, 1.05)),      # an empty mask sags at the jaw
        rig.ball((0.4, 0.02, -1.08), 0.52, teal, 'jowl', 40, scale=(1, 0.45, 1.1))]
EYE = [(-0.3, 0.1), (-0.12, 0.2), (0.14, 0.14), (0.36, -0.14), (0.14, -0.2), (-0.2, -0.12)]   # the outer corner drooping
for sx in (-1, 1):
    for mat, s, lift in ((gold, 1.45, 0.02), (hole, 1.0, 0.05)):
        o = rig.slab('eye', [(x * s, z * s) for x, z in EYE], -0.03, 0.03, mat, 0.015)
        o.location = mf(sx * 0.42, 0.28, lift); o.scale = (sx, 1, 1); o.rotation_euler = (0, 0, -sx * 0.25)
        mask.append(o)
frown = lambda t: (t * 0.42, -0.62 - 0.16 * t * t)
mask.append(rig.tube('mouth-trim', [mf(*frown(t), 0.0) for t in (j / 16 * 2 - 1 for j in range(17))], 0.17, gold, res=6))
mask.append(rig.tube('mouth', [mf(*frown(t * 0.9), 0.09) for t in (j / 16 * 2 - 1 for j in range(17))], 0.1, hole, res=6))
o = rig.slab('star', rig.star(5, 0.3, 0.13), -0.03, 0.03, gold, 0.012); o.location = mf(0, 0.95, 0.02); o.rotation_euler = (math.radians(-12), 0, 0); mask.append(o)
for sx in (-1, 1):                                # flames up the cheeks
    o = rig.slab('flash', [(0, -0.5), (0.22, -0.1), (0.12, 0.0), (0.3, 0.45), (0.02, 0.15), (-0.06, 0.25), (-0.12, -0.15)], -0.02, 0.02, gold, 0.01)
    o.location = mf(sx * 0.82, -0.15, 0.0); o.scale = (sx, 1, 1); o.rotation_euler = (0, 0, -sx * 0.5); mask.append(o)
    # the laces, undone, hanging past the chin
    mask.append(rig.tube('lace', [(sx * (0.75 + 0.1 * math.sin(t * 7 + sx)), 0.1, -0.9 - 1.5 * t) for t in (j / 20 for j in range(21))], 0.03, lace, res=4))
mask.append(rig.tube('loop', [(-0.25, 0.0, 1.35), (-0.12, -0.05, 1.62), (-0.1, -0.1, 1.72), (0.0, -0.1, 1.62), (0.18, 0.0, 1.36)], 0.045, lace, res=5))
TILT = 8
rig.group(mask, loc=M, rot=(0, TILT, 0))

# ---- the bulb: bare, on its flex, up and to the left -----------------------------------------------
BULB = Vector((-1.75, 0.3, 2.75))
rig.tube('flex', [tuple(BULB + Vector((0, 0, 0.5))), tuple(BULB + Vector((0.02, 0, 3.0)))], 0.03, hole, res=4)
rig.cone(tuple(BULB + Vector((0, 0, 0.22))), tuple(BULB + Vector((0, 0, 0.55))), 0.15, 0.13, chrome, 24)
rig.ball(BULB, 0.3, rig.glow('bulb', rig.hexrgb('#fff0c0'), 14.0), 'bulb', 32, scale=(1, 1, 1.15))
bl = bpy.data.lights.new('bulb', 'POINT'); bl.energy = 1100; bl.color = (1.0, 0.86, 0.75); bl.shadow_soft_size = 0.25
bo = bpy.data.objects.new('bulb', bl); sc.collection.objects.link(bo); bo.location = BULB + Vector((0, -0.5, -0.1))

# ---- the cloud, its rain, and the puddle on the bench ----------------------------------------------
grey = rig.plastic('cloud', rig.hexrgb('#8088a0'), rough=0.55)
CL = Vector((0.35, 0.35, 3.55))
for x, z, r in ((-0.75, -0.05, 0.36), (-0.35, 0.16, 0.46), (0.15, 0.22, 0.5), (0.62, 0.08, 0.42), (0.95, -0.08, 0.3), (-0.2, -0.14, 0.4), (0.4, -0.16, 0.4)):
    rig.ball(CL + Vector((x, rnd.uniform(-0.1, 0.1), z)), r, grey, 'cloud', 32)
rain = rig.glow('rain', rig.hexrgb('#a8dcff'), 1.6, alpha=0.75)
for i in range(46):
    x = rnd.uniform(-0.95, 1.05); y = rnd.uniform(-0.35, 0.25); z = rnd.uniform(-2.9, 3.0); ln = rnd.uniform(0.22, 0.45)
    rig.tube('rain', [(CL.x + x, y, z), (CL.x + x - 0.03, y, z - ln)], 0.014, rain, res=3)
water = rig.plastic('water', rig.hexrgb('#6ac8ff'), rough=0.03, coat=1.0)
rig.ball((0.3, -0.2, -2.9), 1.0, water, 'puddle', 48, scale=(1.5, 0.75, 0.035))
for x, z in ((-0.35, -0.75), (0.5, -0.9)):       # drips off the jaw
    rig.ball((M.x + x, M.y - 0.3, M.z + z - 0.55), 0.07, water, 'drip', 16, scale=(1, 1, 1.5))

rig.area('front', (2, -9, 3), 6.0, 260, rgb=(1.0, 0.75, 0.85), look_at=tuple(M))
rig.area('low', (0, -8, -3), 6.0, 150, rgb=(1.0, 0.6, 0.8), look_at=(0, 0, -2.5))
rig.world((0.3, 0.06, 0.16), 0.25)
rig.camera(60)
rig.render(OUT)
