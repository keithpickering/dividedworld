"""You Were Saying? card art: the old voice as an old beige computer, a post on its screen that it
has gone on writing in green, the green running out past the glass. (The card has an outdated model continue a
post; in play its words are Courier with a green tint, a block cursor at their end.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('SAYING_SEED', '3')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#140502'), (0.5, '#5a1c08'), (1.0, '#1c0703')])
G = -2.2
rig.floor(G, rig.checker('floor', '#1c0804', '#34100a', 30, rough=0.1))

beige = rig.plastic('case', rig.hexrgb('#d9cfae'), rough=0.45)
beige_dark = rig.plastic('case-shade', rig.hexrgb('#b3a882'), rough=0.5)
slot = rig.plastic('slot', (0.02, 0.02, 0.018), rough=0.4)
m, n, l, glass = rig.material('screen')                          # dark glass with a little of its own green
glass.inputs['Base Color'].default_value = (*rig.hexrgb('#02140a'), 1); glass.inputs['Roughness'].default_value = 0.04
glass.inputs['Emission Color'].default_value = (*rig.hexrgb('#0a5a2a'), 1); glass.inputs['Emission Strength'].default_value = 0.35
theirs = rig.glow('theirs', rig.hexrgb('#ff9a3a'), 1.5)           # the author's words, as they left them
green = rig.glow('old-voice', rig.hexrgb('#22e85a'), 1.5)         # and what the old voice added
cursor = rig.glow('cursor', rig.hexrgb('#c8ffd6'), 7.0)

# ---- the machine: a monitor on a desktop case, a keyboard before it ------------------------------
pc = []
def part(o, loc):
    o.location = loc; pc.append(o); return o
part(rig.slab('monitor', rig.rrect(3.7, 3.1, 0.3), -1.2, 0.5, beige, 0.12), (0, 0, 1.75))
part(rig.slab('monitor-back', rig.rrect(3.0, 2.5, 0.3), 0.4, 1.9, beige_dark, 0.15), (0, 0, 1.75))
part(rig.slab('bezel', rig.rrect(3.15, 2.45, 0.32), -1.26, -1.1, beige_dark, 0.04), (0, 0, 1.9))
part(rig.slab('screen', rig.rrect(2.85, 2.15, 0.26), -1.3, -1.2, m, 0.03), (0, 0, 1.9))
part(rig.ball((1.5, -1.22, 0.42), 0.05, rig.glow('led', rig.hexrgb('#4dff7a'), 6.0), 'led', 12), (1.5, -1.22, 0.42))
for k in range(2): part(rig.cone((0, 0, 0), (0, -0.08, 0), 0.07, 0.07, beige_dark, 16), (1.0 + 0.22 * k, -1.2, 0.42))
part(rig.cone((0, 0, 0), (0, 0, -0.25), 0.7, 1.0, beige_dark, 32), (0, -0.2, 0.2))            # its neck
part(rig.slab('desktop', rig.rrect(4.6, 1.05, 0.12), -1.6, 1.6, beige, 0.06), (0, 0, -0.6))
part(rig.slab('floppy-slot', rig.rrect(1.15, 0.1, 0.03), -1.63, -1.5, slot, 0.01), (1.2, 0, -0.45))
part(rig.slab('eject', rig.rrect(0.16, 0.1, 0.03), -1.66, -1.55, beige_dark, 0.01), (1.65, 0, -0.72))
part(rig.slab('badge', rig.rrect(0.5, 0.2, 0.04), -1.63, -1.58, rig.plastic('badge', rig.hexrgb('#ff5a1c'), rough=0.2, coat=1.0), 0.01), (-1.85, 0, -0.3))
for k in range(7): part(rig.slab('vent', rig.rrect(1.3, 0.035, 0.01), -1.62, -1.55, slot, 0.004), (-1.2, 0, -0.55 - 0.07 * k))
# what is on the screen: the post in the author's amber, then the old voice in green, then the cursor
z = 2.72; rows = []
for row in range(7):
    x = -1.22; mine = row < 3
    while x < 1.2:
        w = rnd.choice([0.2, 0.3, 0.42, 0.55])
        if x + w > 1.25 or (row == 2 and x > 0.1) or (row == 6 and x > -0.2): break
        part(rig.slab('glyphs', rig.rrect(w, 0.11, 0.03), -1.325, -1.3, theirs if mine and not (row == 2 and x > -0.35) else green, 0.004), (x + w / 2, 0, z))
        x += w + 0.1
    rows.append((x, z)); z -= 0.26
part(rig.slab('cursor', rig.rrect(0.13, 0.19, 0.01), -1.33, -1.3, cursor, 0.004), (rows[-1][0] + 0.07, 0, rows[-1][1]))
# and the green keeps going, off the glass and out into the room
x, y, z = rows[-1][0] + 0.35, -1.5, rows[-1][1]
for k in range(16):
    t = k / 15; w = rnd.choice([0.25, 0.35, 0.5]) * (1 + 1.3 * t)
    part(rig.slab('bleed', rig.rrect(w, 0.11 * (1 + 1.3 * t), 0.03), -0.01, 0.01, green, 0.004), (x + w / 2, y, z))
    x += w + 0.1 * (1 + t); y -= 0.2 + 0.18 * t; z -= 0.06 + 0.2 * t
    if x > 2.4: x = rnd.uniform(-0.4, 0.6) + 1.2 * t; z -= 0.25 * (1 + t)
# the keyboard
part(rig.slab('keyboard', rig.rrect(4.0, 0.22, 0.06), -0.75, 0.75, beige, 0.04), (-0.1, -3.0, -1.02))
keycap = rig.plastic('key', rig.hexrgb('#efe6c8'), rough=0.35)
for r in range(4):
    for c in range(15):
        if r == 3 and 4 <= c <= 9:
            if c == 4: part(rig.slab('space', rig.rrect(1.45, 0.1, 0.03), -0.1, 0.1, keycap, 0.02), (-0.1 - 1.8 + 0.25 * 6.5, -3.0 - 0.5 + 0.34 * (3 - r) - 0.02, -0.87))
            continue
        part(rig.slab('key', rig.rrect(0.2, 0.1, 0.03), -0.1, 0.1, keycap, 0.02), (-0.1 - 1.8 + 0.25 * c + 0.05, -3.0 - 0.5 + 0.34 * (3 - r) - 0.02, -0.87))
rig.group(pc, loc=(-0.15, 1.4, G + 1.42), rot=(0, 0, -17), scale=1.14)

# ---- on the floor beside it: the disks it came on ------------------------------------------------
for i, (hx, loc, rot) in enumerate((('#1c5aff', (2.15, -1.6, G + 0.03), (90, 0, 24)), ('#101010', (1.7, -2.3, G + 0.07), (90, 0, -12)), ('#e8301c', (-2.3, -2.6, G + 0.03), (90, 0, 40)))):
    d = [rig.slab('disk', rig.rrect(0.9, 0.94, 0.04), -0.02, 0.02, rig.plastic('disk', rig.hexrgb(hx), rough=0.3), 0.008),
         rig.slab('shutter', rig.rrect(0.5, 0.3, 0.01), -0.03, -0.015, rig.plastic('shutter', (0.8, 0.82, 0.85), rough=0.15, metallic=1.0), 0.004),
         rig.slab('label', rig.rrect(0.7, 0.4, 0.02), -0.028, -0.015, rig.plastic('label', (0.95, 0.93, 0.85), rough=0.5), 0.003)]
    d[1].location = (0.05, 0, 0.3); d[2].location = (0, 0, -0.22)
    rig.group(d, loc=loc, rot=rot)

gl = bpy.data.lights.new('phosphor', 'POINT'); gl.energy = 700; gl.color = (0.3, 1.0, 0.45); gl.shadow_soft_size = 0.25
go = bpy.data.objects.new('phosphor', gl); sc.collection.objects.link(go); go.location = (0.6, -1.8, G + 3.4)
rig.area('key', (-6, -9, 7), 4.0, 1400, rgb=(1.0, 0.92, 0.8), look_at=(0, 0, 0.3))
rig.area('window', (3.5, -8, 3), 1.0, 600, look_at=(0, 0, 0.5), size_y=6.0)
rig.area('rim', (6, 5, 4), 4.0, 2200, rgb=(1.0, 0.5, 0.2), look_at=(0, 1, 0), glossy=False)
rig.world((0.1, 0.035, 0.02), 0.7)
rig.camera(60, elev=10, target=(0, 0, 0.0))
rig.render(OUT)
