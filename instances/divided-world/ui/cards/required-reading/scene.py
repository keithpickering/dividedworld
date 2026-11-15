"""Required Reading card art: a stack of very thick books, an apple for the teacher on top and a pair of reading
glasses left leaning on the pile. (The card pays its post a flat amount for each calm, positive vote, for a week.)"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
rig.backdrop(18, [(0.0, '#2a0618'), (0.45, '#b03a78'), (0.8, '#ffb0d4'), (1.0, '#5a1238')]).scale.x = 60
G = -1.5
rig.floor(G, rig.checker('floor', '#3a0a22', '#c04a88', 40, rough=0.1))
pages = rig.plastic('pages', rig.hexrgb('#fff4d8'), rough=0.6)
gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.2, metallic=0.9, emit=0.12)

def book(z, w, d, h, hexcolor, title, turn, dx=0.0):
    """A book lying flat with its spine to the camera: boards, a page block, and a title down the spine."""
    cover = rig.plastic('cover', rig.hexrgb(hexcolor), rough=0.3, coat=0.5)
    parts = [rig.box('board', w, d, 0.07, cover, (0, 0, 0), bevel=0.02), rig.box('board', w, d, 0.07, cover, (0, 0, h - 0.07), bevel=0.02),
             rig.box('spine', w, 0.1, h, cover, (0, -d / 2 + 0.05, 0), bevel=0.04),
             rig.box('pages', w - 0.14, d - 0.16, h - 0.14, pages, (0, 0.02, 0.07), bevel=0.01),
             rig.text(title, min(0.4, h * 0.55, (w - 1.3) / (len(title) * 0.62)), gold, (0, -d / 2 - 0.01, h / 2), depth=0.015, bevel=0.004)]
    for sx in (-1, 1):                   # the bands either side of the title
        parts.append(rig.box('band', 0.07, 0.02, h - 0.02, gold, (sx * (w / 2 - 0.3), -d / 2 - 0.005, 0.01), bevel=0.004))
    return rig.group(parts, loc=(dx, 0.3, z), rot=(0, 0, turn))
z = G
for w, d, h, hx, title, turn, dx in ((4.3, 3.0, 0.95, '#7a1848', 'ALL OF IT', -7, 0.1), (4.0, 2.8, 0.8, '#e86fa8', 'THE REST OF IT', 6, -0.15),
                                     (3.7, 2.6, 1.05, '#3a8f9a', 'THE FOOTNOTES', -3, 0.1), (3.2, 2.3, 0.6, '#f2e2c0', 'APPENDIX Q', 11, -0.1)):
    book(z, w, d, h, hx, title, turn, dx); z += h
apple = rig.plastic('apple', rig.hexrgb('#e2101c'), rough=0.12, coat=1.0)        # the apple, with one leaf
A = Vector((-0.8, 0.25, z + 0.62))
rig.ball(tuple(A), 0.72, apple, 'apple', 48, scale=(1.05, 1.05, 0.92))
rig.ball(tuple(A + Vector((0, 0, 0.6))), 0.2, rig.plastic('dimple', rig.hexrgb('#7a0810'), rough=0.3), 'dimple', 24, scale=(1, 1, 0.35))
rig.cone(tuple(A + Vector((0, 0, 0.55))), tuple(A + Vector((0.1, 0, 0.98))), 0.035, 0.045, rig.plastic('stem', rig.hexrgb('#4a2a12'), rough=0.6), 12)
leaf = rig.ball(tuple(A + Vector((0.42, 0, 0.9))), 0.3, rig.plastic('leaf', rig.hexrgb('#3fae3a'), rough=0.3, coat=0.6), 'leaf', 24, scale=(1.2, 0.5, 0.14)); leaf.rotation_euler.y = math.radians(-28)

glasses = []                             # the glasses: left on the pile's corner, one arm down its side
for sx in (-1, 1):
    bpy.ops.mesh.primitive_torus_add(major_radius=0.36, minor_radius=0.04, major_segments=48, minor_segments=12, location=(sx * 0.44, 0, 0), rotation=(math.radians(90), 0, 0))
    o = bpy.context.object; bpy.ops.object.shade_smooth(); o.data.materials.append(gold); glasses.append(o)
    lens = rig.ball((sx * 0.44, 0, 0), 0.34, rig.glow('lens', (0.8, 0.95, 1.0), 0.6, alpha=0.25), 'lens', 32, scale=(1, 0.05, 1)); glasses.append(lens)
    glasses.append(rig.tube('arm', [(sx * 0.8, 0, 0.05), (sx * 0.84, 0.9, 0.08), (sx * 0.84, 1.15, -0.1)], 0.03, gold, res=4))
glasses.append(rig.tube('bridge', [(-0.09, 0, 0.1), (0, 0, 0.16), (0.09, 0, 0.1)], 0.03, gold, res=4))
rig.group(glasses, loc=(0.85, -0.55, z + 0.37), rot=(-8, 0, -12), scale=1.0)

LOOK = (0, 0, 0.8)
rig.area('key', (-5, -9, 8), 4.0, 2100, look_at=LOOK)
rig.area('window', (4.5, -7, 3), 1.0, 600, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2000, rgb=(1.0, 0.6, 0.85), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, 0), 8.0, 450, rgb=(1.0, 0.85, 0.92), look_at=LOOK)
rig.world((0.12, 0.03, 0.07), 0.7)
rig.camera(50, elev=10, target=(0, 0, 0.1))
rig.render(OUT)
