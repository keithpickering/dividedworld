"""Below the Fold card art: it collapses a post behind a "click to expand" toggle. A newspaper sheet
folded so that only its top strip shows its print, the rest bent away behind the crease, a tree-view disclosure
arrow beside the fold and a mouse pointer on its way to it."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy, bmesh
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
rig.backdrop(20, [(0.0, '#12020a'), (0.45, '#8a1848'), (0.55, '#b82a68'), (1.0, '#2a0618')])
G = -3.4
rig.floor(G, rig.checker('floor', '#2a0616', '#7a1444', 56, rough=0.14))

paper = rig.plastic('paper', rig.hexrgb('#fff2f7'), rough=0.35)
ink = rig.plastic('ink', rig.hexrgb('#2a0618'), rough=0.7)
grey = rig.plastic('photo', rig.hexrgb('#c0507c'), rough=0.5)
pink = rig.plastic('toggle', rig.hexrgb('#ff2f7f'), rough=0.06, coat=1.0, emit=0.15)
dark = rig.plastic('toggle-base', rig.hexrgb('#2a0616'), rough=0.15, coat=1.0)
white = rig.plastic('pointer', (1.0, 1.0, 1.0), rough=0.1, coat=1.0)

# ---- the sheet: its cross-section runs down the front, round the crease and away behind ------------
W, TOP, FR, BEND, TAIL = 3.7, 3.25, 0.16, 62, 5.5       # width, the strip's height, the crease's radius, its angle, the hidden length
prof = [(0.0, TOP), (0.0, FR)]
for k in range(1, 13):
    a = math.radians(180 + BEND * k / 12); prof.append((FR + FR * math.cos(a), FR + FR * math.sin(a)))
a = math.radians(180 + BEND); d = (-math.sin(a), math.cos(a))
for k in range(1, 9): prof.append((prof[12 + 1][0] + d[0] * TAIL * k / 8, prof[12 + 1][1] + d[1] * TAIL * k / 8))
bm = bmesh.new(); rows = [(bm.verts.new((-W / 2, y, z)), bm.verts.new((W / 2, y, z))) for y, z in prof]
for p, q in zip(rows, rows[1:]): bm.faces.new((p[0], p[1], q[1], q[0]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new('sheet'); bm.to_mesh(me); bm.free()
for f in me.polygons: f.use_smooth = True
sheet = bpy.data.objects.new('sheet', me); sc.collection.objects.link(sheet); me.materials.append(paper)
sheet.modifiers.new('thick', 'SOLIDIFY').thickness = 0.05
parts = [sheet]
def bar(wd, h, x, z, mat=ink):
    o = rig.slab('print', rig.rrect(wd, h, min(0.04, h / 3)), -0.05, -0.01, mat, 0.006); o.location = (x + wd / 2, 0, z); parts.append(o)
L = -W / 2 + 0.25
bar(W - 0.5, 0.42, L, TOP - 0.42)                                 # the masthead
bar(W - 0.5, 0.05, L, TOP - 0.76)
bar(2.0, 0.2, L, TOP - 1.08)                                      # a headline
COL = (W - 0.5 - 0.2) / 2
for k in range(7):                                                # two columns, and a picture in the second
    bar(COL if k % 4 != 3 else COL * 0.6, 0.085, L, TOP - 1.5 - 0.2 * k)
    if k >= 4: bar(COL if k != 6 else COL * 0.75, 0.085, L + COL + 0.2, TOP - 1.5 - 0.2 * k)
bar(COL, 0.72, L + COL + 0.2, TOP - 1.72, grey)
rig.group(parts, loc=(0.62, 0.9, 0.25), rot=(-5, 0, -20))

# ---- the toggle: a chunky disclosure arrow on its button, level with the crease --------------------
T = Vector((-1.75, -0.5, 0.45))
tog = [rig.slab('button', rig.rrect(1.3, 1.3, 0.2), -0.12, 0.12, dark, 0.05),
       rig.slab('arrow', [(-0.34, 0.44), (0.46, 0.0), (-0.34, -0.44)], -0.36, -0.1, pink, 0.07)]
rig.group(tog, loc=tuple(T), rot=(-6, 18, 0), scale=1.15)
tl = bpy.data.lights.new('toggle', 'POINT'); tl.energy = 60; tl.color = (1.0, 0.4, 0.7)
to = bpy.data.objects.new('toggle', tl); sc.collection.objects.link(to); to.location = T + Vector((0, -1.2, 0.3))

# ---- the pointer, about to click it ---------------------------------------------------------------
ARROW = [(0, 0), (0, -1.0), (0.24, -0.78), (0.42, -1.18), (0.57, -1.11), (0.39, -0.72), (0.72, -0.72)]
ptr = [rig.slab('pointer-edge', ARROW, -0.06, 0.06, dark, 0.02), rig.slab('pointer', ARROW, -0.1, -0.02, white, 0.02)]
ptr[0].scale = (1.16, 1, 1.12); ptr[0].location = (-0.05, 0, 0.07)
rig.group(ptr, loc=(T.x + 0.3, T.y - 0.7, T.z - 0.25), rot=(-10, -12, 8), scale=1.25)

rig.area('key', (-5, -9, 7), 4.0, 1700, look_at=(0.3, 0, 1.6))
rig.area('fill', (6, -7, 1), 6.0, 500, rgb=(1.0, 0.8, 0.9), look_at=(0, 0, 1))
rig.area('rim', (-6, 6, 5), 4.0, 2600, rgb=(1.0, 0.4, 0.7), look_at=(0, 1, 0), glossy=False)
rig.world((0.22, 0.04, 0.12), 0.7)
rig.camera(60, elev=7, target=(0, 0, 0.2))
rig.render(OUT)
