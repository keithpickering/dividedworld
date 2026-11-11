"""Hall Pass card art exploration, after the placeholder art.svg: a pass on a lanyard, held up to a Mod Bot."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
rig.backdrop(18, [(0.0, '#010608'), (0.5, '#083642'), (1.0, '#021a22')])
G = -3.6
rig.floor(G, rig.checker('hall', '#04222b', '#0a3a48', 30, rough=0.1))
locker = rig.plastic('locker', rig.hexrgb('#0b3f4d'), rough=0.35, metallic=0.6)
for k in range(-4, 5):                                           # the hall: a row of lockers down the back
    o = rig.slab('locker', rig.rrect(1.5, 5.4, 0.05), -0.1, 0.1, locker, 0.03); o.location = (k * 1.6, 9, G + 2.75)
    for j in range(3): rig.tube('vent', [(k * 1.6 - 0.4, 8.85, G + 4.6 - 0.18 * j), (k * 1.6 + 0.4, 8.85, G + 4.6 - 0.18 * j)], 0.03, rig.plastic('vent', rig.hexrgb('#041c24'), rough=0.4), res=2)

# ---- the Mod Bot: a boxy head, one red visor, an antenna ------------------------------------------
B = Vector((-0.6, 2.2, 2.5))
shell = rig.plastic('bot', rig.hexrgb('#16a8c4'), rough=0.18, metallic=0.4, coat=1.0)
dark = rig.plastic('bot-dark', rig.hexrgb('#041c24'), rough=0.3)
chrome = rig.plastic('chrome', (0.85, 0.95, 1.0), rough=0.06, metallic=1.0)
visor = rig.glow('visor', rig.hexrgb('#ff3a2a'), 5.0)
bot = [rig.slab('head', rig.rrect(3.0, 2.3, 0.4), -0.9, 0.9, shell, 0.2),
       rig.slab('face', rig.rrect(2.5, 1.0, 0.25), -0.96, -0.85, dark, 0.03),
       rig.slab('visor', rig.rrect(2.2, 0.62, 0.18), -1.0, -0.94, visor, 0.02),
       rig.cone((0, 0, 1.15), (0, 0, 1.75), 0.07, 0.05, chrome, 16), rig.ball((0, 0, 1.85), 0.16, visor, 'tip', 24),
       rig.cone((0, 0, -1.15), (0, 0, -1.9), 0.5, 0.6, dark, 32),
       rig.slab('body', rig.rrect(4.2, 3.4, 0.5), -0.8, 0.8, shell, 0.2)]
bot[-1].location = (0, 0, -3.5)
bot[2].location = (0, 0, 0.2); bot[1].location = (0, 0, 0.2)
for j in range(9):                                               # the grille it speaks through
    bot.append(rig.slab('grille', rig.rrect(0.1, 0.3, 0.04), -0.94, -0.88, dark, 0.01)); bot[-1].location = (-0.8 + 0.2 * j, 0, -0.72)
for sx in (-1, 1):
    bot.append(rig.cone((sx * 1.5, 0, 0.1), (sx * 1.75, 0, 0.1), 0.35, 0.3, chrome, 32))
rig.group(bot, loc=B, rot=(4, 0, -12))
vl = bpy.data.lights.new('visor', 'POINT'); vl.energy = 350; vl.color = (1.0, 0.25, 0.15)
vo = bpy.data.objects.new('visor', vl); sc.collection.objects.link(vo); vo.location = B + Vector((0, -1.6, 0.1))

# ---- the pass: a badge on a lanyard, swung up in front of the visor ------------------------------
P = Vector((1.0, -0.6, 0.75))            # the whole pass sits above the card's name plate
paper = rig.plastic('pass', rig.hexrgb('#e6fdff'), rough=0.18, coat=1.0)
cyan = rig.plastic('pass-ink', rig.hexrgb('#18c8e8'), rough=0.15, coat=1.0, emit=0.2)
navy = rig.plastic('pass-dark', rig.hexrgb('#06323e'), rough=0.2)
badge = [rig.slab('edge', rig.rrect(2.0, 2.9, 0.2), -0.05, 0.05, cyan, 0.02),
         rig.slab('face', rig.rrect(1.8, 2.7, 0.14), -0.07, -0.03, paper, 0.012),
         rig.slab('band', rig.rrect(1.8, 0.5, 0.1), -0.085, -0.06, cyan, 0.008),
         rig.text('HALL PASS', 0.24, navy, (0, -0.09, 1.08), depth=0.01, bevel=0.003),
         rig.cone((0, -0.07, 0.15), (0, -0.09, 0.15), 0.55, 0.55, navy, 48),
         rig.ball((0, -0.1, 0.3), 0.19, paper, 'head', 24, scale=(1, 0.3, 1)),
         rig.ball((0, -0.1, -0.2), 0.36, paper, 'shoulders', 32, scale=(1, 0.25, 0.62)),
         rig.slab('clip', rig.rrect(0.5, 0.42, 0.06), -0.1, 0.1, chrome, 0.02)]
badge[2].location = (0, 0, 1.08); badge[-1].location = (0, 0, 1.5)
for k in range(3):
    badge.append(rig.slab('line', rig.rrect(1.3 - 0.3 * k, 0.09, 0.04), -0.085, -0.06, navy, 0.005)); badge[-1].location = (-0.15 * k, 0, -0.68 - 0.21 * k)
badge.append(rig.tube('check', [(0.42, -0.1, -0.95), (0.52, -0.1, -1.07), (0.72, -0.1, -0.82)], 0.035, cyan, res=5))
tilt = (-8, 14, -14)
rig.group(badge, loc=P, rot=tilt, scale=0.86)
# the lanyard: a flat strap from the clip up and off the top of the card
from mathutils import Euler
top = P + Euler(tuple(math.radians(a) for a in tilt), 'XYZ').to_matrix() @ (Vector((0, 0, 1.7)) * 0.86)
import bmesh
for sx in (-1, 1):
    bm = bmesh.new(); prev = None
    for k in range(31):
        t = k / 30
        c = top + Vector((sx * 0.5 * math.sin(t * math.pi * 0.5) + 0.9 * t, 0.2 * t, 5.2 * t))
        a = (bm.verts.new(c + Vector((-0.09, 0.02 * sx, 0))), bm.verts.new(c + Vector((0.09, -0.02 * sx, 0))))
        if prev: bm.faces.new((prev[0], prev[1], a[1], a[0]))
        prev = a
    me = bpy.data.meshes.new('lanyard'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('lanyard', me); sc.collection.objects.link(o)
    o.data.materials.append(rig.checker('lanyard', '#e6fdff', '#18c8e8', 60, rough=0.4)); o.modifiers.new('thick', 'SOLIDIFY').thickness = 0.03
rig.ball(top, 0.1, chrome, 'ring', 16)

rig.area('key', (-6, -9, 6), 4.0, 2000, look_at=tuple(P))
rig.area('window', (4, -8, 3), 1.2, 700, look_at=tuple(P), size_y=6.0)
rig.area('rim', (6, 5, 5), 4.0, 2400, rgb=(0.3, 0.9, 1.0), look_at=tuple(B), glossy=False)
rig.area('soft', (-8, -5, -1), 8.0, 900, rgb=(0.7, 0.95, 1.0), look_at=tuple(B))
rig.world((0.02, 0.09, 0.12), 0.7)
rig.camera(60, elev=3)
rig.render(OUT)
