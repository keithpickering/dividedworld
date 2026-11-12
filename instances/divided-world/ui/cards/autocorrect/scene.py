"""Autocorrect card art: masking tape pulled off its roll and laid over a post's words, the new words written on
it with a black marker (the owner's idea, 2026-11-11; the page of words is the first version's)."""
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
TAPE_Z = 1.75                                                     # the row the tape lies on
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

# ---- the tape: masking tape, off its roll and across the post, the new words written on it in marker ----------
cream = rig.plastic('tape', rig.hexrgb('#e4cd92'), rough=0.6)
core = rig.plastic('core', rig.hexrgb('#a9824f'), rough=0.7)
inkm = rig.plastic('marker-ink', (0.015, 0.012, 0.01), rough=0.35)
HALF = 0.62                                                       # half the tape's width
X0 = -1.55                                                        # where the strip leaves the roll
def lift(x):                                                      # how far off the page the tape is at x: flat, then peeling up at its torn end
    return -0.02 - 0.9 * max(0.0, x - 2.3) ** 2
bm = bmesh.new(); prev = None
for k in range(61):
    x = X0 + (3.6 - X0) * k / 60
    a = (bm.verts.new((x, lift(x), -HALF)), bm.verts.new((x, lift(x), HALF)))
    if prev: bm.faces.new((prev[0], a[0], a[1], prev[1]))
    prev = a
me = bpy.data.meshes.new('tape'); bm.to_mesh(me); bm.free()
for f in me.polygons: f.use_smooth = True
tape = bpy.data.objects.new('tape', me); sc.collection.objects.link(tape); me.materials.append(cream)
tape.modifiers.new('thick', 'SOLIDIFY').thickness = 0.04
parts = [tape, rig.text('OK', 0.95, inkm, (0.1, -0.05, 0.0), depth=0.012, bevel=0.004)]
parts.append(rig.tube('flourish', [(1.1 + 0.65 * t, -0.06, -0.22 + 0.09 * math.sin(t * 9) * (1 - t)) for t in (j / 40 for j in range(41))], 0.04, inkm, res=5))

def ring(name, r_in, r_out, depth, mat, bevel=0.03):
    """A flat ring turned about the vertical: a roll of tape, or its cardboard core. It lies in the object's xy plane, `depth` tall."""
    bmr = bmesh.new(); prof = [(r_in, 0), (r_out, 0), (r_out, depth), (r_in, depth)]; seg = 96
    loops = [[bmr.verts.new((math.cos(q) * r, math.sin(q) * r, z)) for q in (math.tau * k / seg for k in range(seg))] for r, z in prof]
    for a, b2 in zip(loops, loops[1:] + loops[:1]):
        for k in range(seg): bmr.faces.new((a[k], a[(k + 1) % seg], b2[(k + 1) % seg], b2[k]))
    bmesh.ops.recalc_face_normals(bmr, faces=bmr.faces)
    m_ = bpy.data.meshes.new(name); bmr.to_mesh(m_); bmr.free()
    for f in m_.polygons: f.use_smooth = True
    o = bpy.data.objects.new(name, m_); sc.collection.objects.link(o); m_.materials.append(mat)
    md = o.modifiers.new('bevel', 'BEVEL'); md.width = bevel; md.segments = 3; md.limit_method = 'ANGLE'
    return o
# the roll: standing on the strip's start, tipped toward the camera so its face and its hole show
roll = [ring('roll', 0.6, 1.08, 2 * HALF, cream), ring('core', 0.54, 0.61, 2 * HALF, core, bevel=0.01)]
wound = rig.plastic('wound', rig.hexrgb('#b3965a'), rough=0.6)
for r in (0.7, 0.8, 0.9, 1.0):                                    # the wound layers, as rings on both its faces
    for z in (-0.004, 2 * HALF + 0.004):
        roll.append(rig.tube('layer', [(math.cos(q) * r, math.sin(q) * r, z) for q in (math.tau * k / 96 for k in range(97))], 0.014, wound, res=2))
parts.append(rig.group(roll, loc=(X0 - 0.8, -1.25, -HALF * 0.75), rot=(-62, 0, -14)))
rig.group(parts, loc=(0.7, 0.1, TAPE_Z), rot=(0, -6, 0))

# ---- the marker that wrote it: black, capped end down, its tip just off the last stroke -------------
black = rig.plastic('marker', (0.012, 0.012, 0.015), rough=0.18, coat=1.0)
grey = rig.plastic('marker-band', (0.75, 0.76, 0.8), rough=0.3)
tipm = rig.plastic('marker-tip', (0.03, 0.03, 0.035), rough=0.6)
from mathutils import Vector
T = Vector((2.3, -0.35, TAPE_Z - 0.55)); D = Vector((-0.5, -0.5, -0.84)).normalized()   # the tip, and which way the marker runs back from it
rig.cone(T, T + D * 0.22, 0.035, 0.1, tipm, 20)                    # the felt tip
rig.cone(T + D * 0.22, T + D * 0.5, 0.1, 0.17, black, 32)          # the collar
rig.cone(T + D * 0.5, T + D * 2.5, 0.17, 0.17, black, 32)          # the barrel
rig.cone(T + D * 1.05, T + D * 1.75, 0.172, 0.172, grey, 32)       # its label
rig.cone(T + D * 2.5, T + D * 2.56, 0.17, 0.12, black, 32)         # the end
C0 = Vector((1.75, -0.3, TAPE_Z - 2.35)); CD = Vector((0.9, -0.1, 0.3)).normalized()      # its cap, lying beside it
rig.cone(C0, C0 + CD * 0.72, 0.19, 0.19, black, 32)
rig.cone(C0 + CD * 0.72, C0 + CD * 0.78, 0.19, 0.14, black, 32)
rig.cone(C0 + CD * 0.1, C0 + CD * 0.62, 0.193, 0.193, rig.plastic('cap-clip', (0.02, 0.02, 0.025), rough=0.3), 6)

rig.area('key', (-6, -9, 7), 4.0, 1500, look_at=(0, 0, TAPE_Z))
rig.area('window', (3.5, -8, 3), 1.2, 900, look_at=(0, 0, TAPE_Z), size_y=6.0)
rig.area('warm', (5, -4, -4), 6.0, 1200, rgb=(1.0, 0.5, 0.25), look_at=(0, 0, -1), glossy=False)
rig.world((0.12, 0.04, 0.03), 0.6)
rig.camera(60, elev=0)
sc.camera.location.x = 1.6; sc.camera.rotation_euler = (math.radians(90), 0, math.radians(6.5))   # a little off to one side, so the bars have depth
rig.render(OUT)
