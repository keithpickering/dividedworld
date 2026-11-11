"""Jimmy Wails card art: a donation jar making its personal appeal, with pleading eyes, a tear and a "please read"
tag round its neck. Coins drop toward it, and the nearest has a bite out of it: The System's overhead.
(The card puts a sob story on a donation banner under a post.) The jar is nobody: no person and no organization's
mark is pictured, since the card is a joke about the genre of appeal and never the real thing."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('WAILS_SEED', '3')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#021418'), (0.5, '#0a5a6c'), (0.78, '#18b4d0'), (1.0, '#063848')])
G = -1.55                                # the floor: the jar stands above the card's name plate
rig.floor(G, rig.checker('floor', '#04222b', '#0c4a5a', 46, rough=0.1))
J = Vector((-0.2, 0.6, G))               # the jar's foot

chrome = rig.plastic('chrome', (0.85, 0.95, 1.0), rough=0.06, metallic=1.0)
ink = rig.plastic('ink', (0.01, 0.03, 0.04), rough=0.25)
white = rig.plastic('white', (0.95, 0.98, 1.0), rough=0.08, coat=1.0, emit=0.15)
gold = rig.plastic('gold', rig.hexrgb('#ffc21c'), rough=0.18, metallic=0.9, emit=0.1)

# ---- the jar: see-through glass with a hard shine, a screw neck, coins in its foot -----------------
m, n, l, b = rig.material('glass')
b.inputs['Base Color'].default_value = (*rig.hexrgb('#0a6a80'), 1); b.inputs['Roughness'].default_value = 0.03
b.inputs['Emission Color'].default_value = (*rig.hexrgb('#2ee6ff'), 1); b.inputs['Emission Strength'].default_value = 0.35
tr = n.new('ShaderNodeBsdfTransparent'); mx = n.new('ShaderNodeMixShader'); mx.inputs[0].default_value = 0.42
l.new(tr.outputs[0], mx.inputs[1]); l.new(b.outputs[0], mx.inputs[2]); l.new(mx.outputs[0], n['Material Output'].inputs['Surface'])
R = 1.45                                 # the jar's widest
BODY = [(0.0, 0.0), (1.15, 0.0), (1.38, 0.12), (R, 0.5), (R, 2.35), (1.36, 2.75), (1.05, 3.05), (0.98, 3.2), (0.98, 3.5)]
rig.lathe('jar', BODY, m, J)
for k in range(3):                       # the neck's thread, and a rolled lip
    z = 3.24 + 0.1 * k
    rig.tube('thread', [J + Vector((math.cos(a) * 1.0, math.sin(a) * 1.0, z)) for a in (math.tau * j / 64 for j in range(65))], 0.035, m, res=3)
rig.tube('lip', [J + Vector((math.cos(a) * 0.98, math.sin(a) * 0.98, 3.5)) for a in (math.tau * j / 64 for j in range(65))], 0.06, white, res=4)

COIN = [(0.0, 0.0), (0.3, 0.0), (0.33, 0.03), (0.33, 0.08), (0.3, 0.11), (0.0, 0.11)]
saved = rig.plastic('saved', rig.hexrgb('#ffc21c'), rough=0.25, metallic=0.35, emit=0.3)   # less mirror: gold seen in gold goes red
def coin(loc, tilt=0.6, size=1.0, mat=gold):
    o = rig.lathe('coin', COIN, mat, loc, seg=24)
    o.rotation_euler = (rnd.uniform(-tilt, tilt), rnd.uniform(-tilt, tilt), 0); o.scale = (size,) * 3
    return o
for i in range(46):                      # not many: it is an appeal, after all
    r = 1.1 * math.sqrt(rnd.random()); a = rnd.uniform(0, math.tau)
    coin(J + Vector((math.cos(a) * r, math.sin(a) * r, 0.08 + rnd.uniform(0, 0.55) * (1 - 0.5 * r / 1.1))), mat=saved)
gl = bpy.data.lights.new('gold', 'POINT'); gl.energy = 25; gl.color = (1.0, 0.95, 0.8); gl.shadow_soft_size = 0.4
go = bpy.data.objects.new('gold', gl); sc.collection.objects.link(go); go.location = J + Vector((0, 0, 1.2))

# ---- its face: two wet, pleading eyes, brows tipped up in the middle, and a tear --------------------
def on_jar(x, z, lift=0.0):
    """A point on the jar's front at card position x, height z above its foot."""
    return J + Vector((x, -math.sqrt(max(0.0, (R + lift) ** 2 - x * x)), z))
tear = rig.plastic('tear', rig.hexrgb('#9af4ff'), rough=0.02, coat=1.0, emit=0.9)
for sx in (-1, 1):
    c = on_jar(sx * 0.6, 1.8)
    turn = (0, 0, math.asin(sx * 0.6 / R))
    for r, mat, lift, dx, dz in ((0.46, white, 0.0, 0, 0), (0.33, ink, 0.05, -sx * 0.04, 0.03), (0.12, white, 0.16, -sx * 0.04 - 0.1, 0.14), (0.06, white, 0.16, -sx * 0.04 + 0.1, -0.08)):
        o = rig.ball(on_jar(sx * 0.6 + dx, 1.8 + dz, lift - 0.02), r, mat, 'eye', 40, scale=(1, 0.3, 1.12)); o.rotation_euler = turn
    rig.tube('brow', [on_jar(sx * (0.22 + 0.75 * t), 2.62 - 0.3 * t - 0.12 * math.sin(math.pi * t), 0.04) for t in (j / 10 for j in range(11))], 0.065, ink, res=5)
rig.tube('mouth', [on_jar(-0.26 + 0.52 * t, 1.02 + 0.1 * math.sin(math.pi * t), 0.03) for t in (j / 10 for j in range(11))], 0.05, ink, res=5)
T = on_jar(-0.92, 1.12, 0.05)            # the tear, under the left eye
rig.ball(T, 0.15, tear, 'tear', 32, scale=(1, 0.6, 1.1))
rig.cone(T + Vector((0, 0, 0.1)), T + Vector((0.03, 0, 0.42)), 0.115, 0.0, tear, 32)
rig.ball(J + Vector((-1.75, -1.2, 0.03)), 0.2, tear, 'puddle', 32, scale=(1.3, 1, 0.12))

# ---- the tag: card on a string round the neck, in front of the jar's right shoulder -----------------
tagm = rig.plastic('tag', rig.hexrgb('#fff3c4'), rough=0.4)
red = rig.plastic('tag-ink', rig.hexrgb('#c8102a'), rough=0.3)
tag = [rig.slab('tag', [(-0.8, 0.5), (0.55, 0.5), (0.85, 0.2), (0.85, -0.2), (0.55, -0.5), (-0.8, -0.5)], -0.025, 0.025, tagm, 0.01),
       rig.text('PLEASE', 0.36, red, (-0.12, -0.035, 0.19), depth=0.01, bevel=0.003),
       rig.text('READ', 0.36, red, (-0.12, -0.035, -0.2), depth=0.01, bevel=0.003),
       rig.tube('eyelet', [(0.62 + math.cos(a) * 0.07, -0.03, math.sin(a) * 0.07) for a in (math.tau * j / 16 for j in range(17))], 0.02, chrome, res=3)]
TAG = J + Vector((1.8, -1.6, 1.15))
rig.group(tag, loc=TAG, rot=(-6, 0, -9), scale=0.95)
knot = TAG + Vector((0.7, 0.05, 0.02))
string = rig.plastic('string', (0.9, 0.85, 0.7), rough=0.6)
rig.tube('string', [knot + (J + Vector((0.95, -0.55, 3.06)) - knot) * t + Vector((0.25, 0, -0.3)) * math.sin(math.pi * t) for t in (j / 12 for j in range(13))], 0.022, string, res=3)
rig.tube('string', [J + Vector((math.cos(a) * 1.08, math.sin(a) * 1.08, 3.06)) for a in (math.tau * j / 48 for j in range(49))], 0.022, string, res=3)

# ---- the gifts: coins dropping to the jar, the nearest with The System's overhead bitten out --------
def bitten(r, bites, n=240):
    """A coin's outline with round bites out of its edge, (angle, radius) each: along every ray from the middle,
    the edge is the coin's own or the near side of a bite, whichever comes first."""
    out = []
    for j in range(n):
        a = math.tau * j / n; d = r
        for ba, br in bites:
            along = r * math.cos(a - ba); off = r * math.sin(a - ba)      # the bite's middle, along and across the ray
            if abs(off) < br and along > 0: d = min(d, along - math.sqrt(br * br - off * off))
        out.append((math.cos(a) * d, math.sin(a) * d))
    return out
BITES = [(math.radians(150), 0.4), (math.radians(118), 0.3), (math.radians(182), 0.3)]
big = [rig.slab('coin', bitten(0.8, BITES), -0.07, 0.07, gold, 0.03),
       rig.slab('star', rig.star(5, 0.36, 0.15), -0.1, -0.06, gold, 0.012)]
big[1].location = (0.12, 0, -0.1)
rig.tube('rim', [(math.cos(a) * 0.66, -0.075, math.sin(a) * 0.66) for a in (math.radians(-125 + 215 * j / 48) for j in range(49))], 0.025, gold, res=3)
big.append(bpy.context.scene.objects['rim'])
rig.group(big, loc=J + Vector((0.25, -0.4, 4.3)), rot=(-8, 6, -10))
for x, y, z, s in ((-0.95, 0.3, 5.0, 0.9), (1.1, 0.5, 5.1, 0.8)):
    o = coin(J + Vector((x, y, z)), tilt=1.2, size=s); o.rotation_euler.x += math.radians(70)
for x, y in ((-2.2, -0.9), (1.9, 0.5), (2.4, -1.9), (-1.3, -2.3)):   # the ones that missed
    coin((x, y, G), tilt=0.04)

for i in range(14):                      # soft lights hanging in the room
    hx = rnd.choice(['#2ee6ff', '#9af4ff', '#e6fdff', '#ffc21c'])
    rig.ball((rnd.uniform(-7, 7), rnd.uniform(8, 14), rnd.uniform(-2, 3.5)), rnd.uniform(0.25, 0.6), rig.glow('bokeh', rig.hexrgb(hx), 0.8, alpha=0.3), 'bokeh', 20)

LOOK = tuple(J + Vector((0, 0, 2.0)))
rig.area('key', (-6, -9, 7), 4.0, 1900, look_at=LOOK)
rig.area('window', (3.5, -8, 3), 1.0, 900, look_at=LOOK, size_y=7.0)   # the tall shine down the glass
rig.area('rim', (5, 6, 6), 4.0, 2000, rgb=(0.3, 0.9, 1.0), look_at=LOOK, glossy=False)
rig.area('soft', (-8, -5, 0), 8.0, 500, rgb=(0.7, 0.95, 1.0), look_at=LOOK)
rig.world((0.02, 0.09, 0.12), 0.7)
rig.camera(60, elev=6, target=(0, 0, -0.5))
rig.render(OUT)
