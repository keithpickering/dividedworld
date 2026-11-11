"""Autocorrect card art, after the placeholder art.svg: a strip of label tape laid over a post's words."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy, bmesh
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('AUTOCORRECT_SEED', '2')))
sc = rig.reset()
# the post: a dark page facing the camera, its words raised bars
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.3, 0), rotation=(math.radians(90), 0, 0))
pg = bpy.context.object; pg.scale = (16, 20, 1); pg.data.materials.append(rig.plastic('page', rig.hexrgb('#1a0806'), rough=0.65))
word = rig.plastic('word', rig.hexrgb('#5c241a'), rough=0.2, coat=1.0)
wrong = rig.plastic('wrong', rig.hexrgb('#ff5a1c'), rough=0.15, coat=1.0, emit=0.7)
TAPE_Z = 1.35                                                     # the row the tape lies on
z = 4.4; row = 0; hot_row = None
while z > -4.6:
    x = -2.9 + (0.5 if row % 5 == 0 else 0)
    while x < 2.7:
        w = rnd.choice([0.35, 0.5, 0.7, 0.9, 1.2])
        if x + w > 2.9: break
        if hot_row is None and z < TAPE_Z - 0.85: hot_row = row
        hot = row == hot_row and -0.9 < x < 0.1                    # one more of the phrase, not yet covered
        o = rig.slab('word', rig.rrect(w, 0.2, 0.09), 0.14, 0.3, wrong if hot else word, 0.03); o.location = (x + w / 2, 0, z)
        x += w + 0.2
    if rnd.random() < 0.18: z -= 0.3                                # a paragraph's gap
    z -= 0.42; row += 1

# ---- the tape: a cream strip across the post, peeling up toward the camera at its ends ----------
cream = rig.plastic('tape', rig.hexrgb('#f6e3ae'), rough=0.22, coat=1.0)
inkm = rig.plastic('tape-ink', (0.015, 0.012, 0.01), rough=0.15, coat=1.0)
def lift(x):                                                      # how far off the page the tape is at x
    return -0.02 - 0.9 * max(0.0, abs(x) - 2.3) ** 2
bm = bmesh.new(); prev = None
for k in range(81):
    x = -3.6 + 7.2 * k / 80
    a = (bm.verts.new((x, lift(x), -0.62)), bm.verts.new((x, lift(x), 0.62)))
    if prev: bm.faces.new((prev[0], a[0], a[1], prev[1]))
    prev = a
me = bpy.data.meshes.new('tape'); bm.to_mesh(me); bm.free()
for f in me.polygons: f.use_smooth = True
tape = bpy.data.objects.new('tape', me); sc.collection.objects.link(tape); me.materials.append(cream)
tape.modifiers.new('thick', 'SOLIDIFY').thickness = 0.05
parts = [tape, rig.text('OK', 1.0, inkm, (-0.75, -0.06, 0.0), depth=0.035, bevel=0.012)]
parts.append(rig.tube('flourish', [(0.55 + 0.9 * t, -0.08, -0.22 + 0.09 * math.sin(t * 9) * (1 - t)) for t in (j / 40 for j in range(41))], 0.045, inkm, res=5))
for sx in (-1, 1):                                                # the punched edges a label maker leaves
    for k in range(17):
        x = -3.2 + 0.4 * k
        parts.append(rig.ball((x, lift(x) - 0.03, sx * 0.52), 0.03, inkm, 'punch', 8, scale=(1, 0.3, 1)))
rig.group(parts, loc=(0, 0.1, TAPE_Z), rot=(0, -6, 0))

rig.area('key', (-6, -9, 7), 4.0, 2600, look_at=(0, 0, TAPE_Z))
rig.area('window', (3.5, -8, 3), 1.2, 900, look_at=(0, 0, TAPE_Z), size_y=6.0)
rig.area('warm', (5, -4, -4), 6.0, 1200, rgb=(1.0, 0.5, 0.25), look_at=(0, 0, -1), glossy=False)
rig.world((0.12, 0.04, 0.03), 0.6)
rig.camera(60, elev=0)
sc.camera.location.x = 1.6; sc.camera.rotation_euler = (math.radians(90), 0, math.radians(6.5))   # a little off to one side, so the bars have depth
rig.render(OUT)
