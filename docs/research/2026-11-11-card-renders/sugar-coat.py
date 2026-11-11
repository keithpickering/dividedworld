"""Sugar Coat card art exploration: a post dipped in thick glossy icing that runs down over its top half, sprinkles
on it, and a salt shaker and a slice of pepperoni bouncing off. (The card is a week's ward on a post that blocks
every card that is not Sweet.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('SUGAR_COAT_SEED', '6')))
sc = rig.reset()
rig.backdrop(18, [(0.0, '#03202e'), (0.5, '#0b6f8c'), (1.0, '#062c4a')])
G = -2.3
rig.floor(G, rig.checker('floor', '#063a4c', '#12a0c0', 30, rough=0.1))

# ---- the post: a pale slab with a few lines of text, and the icing over its top half ---------------
paper = rig.plastic('post', rig.hexrgb('#f4fbff'), rough=0.2, coat=1.0)
ink = rig.plastic('post-ink', rig.hexrgb('#0b3a4a'), rough=0.3)
icing = rig.plastic('icing', rig.hexrgb('#1fd0f2'), rough=0.04, coat=1.0, emit=0.12)
W2, TOPZ, BASE = 1.72, 2.12, 0.55
post = [rig.slab('post', rig.rrect(3.1, 4.0, 0.22), -0.16, 0.16, paper, 0.05)]
for k, w in enumerate((2.3, 2.5, 1.9, 2.4, 1.3)):
    post.append(rig.slab('line', rig.rrect(w, 0.16, 0.07), -0.2, -0.15, ink, 0.01)); post[-1].location = (-1.25 + w / 2, 0, -0.2 - 0.36 * k)
# the icing's outline: square shoulders over the top of the post, then drips of different lengths along the bottom
out = [(W2, BASE)] + [(W2 - 0.25 + math.cos(a) * 0.25, TOPZ - 0.25 + math.sin(a) * 0.25) for a in (math.radians(90 * j / 6) for j in range(7))]
out += [(-W2 + 0.25 + math.cos(a) * 0.25, TOPZ - 0.25 + math.sin(a) * 0.25) for a in (math.radians(90 + 90 * j / 6) for j in range(7))]
x = -W2; widths = [0.5, 0.62, 0.44, 0.7, 0.5, 0.68]
gap = (2 * W2 - sum(widths)) / (len(widths) - 1)
for i, w in enumerate(widths):
    ln = [0.9, 0.35, 1.5, 0.6, 1.15, 0.3][i] * rnd.uniform(0.85, 1.15); r = w / 2
    out += [(x + r - math.cos(a) * r, BASE - ln - math.sin(a) * r) for a in (math.pi * j / 10 for j in range(11))]
    x += w
    if i < len(widths) - 1:                                      # a shallow scallop between two drips
        out += [(x + gap / 2 - math.cos(a) * gap / 2, BASE - 0.12 + math.sin(a) * gap / 2 * 0.6) for a in (math.pi * j / 6 for j in range(1, 6))]
        x += gap
coat = rig.slab('icing', out, -0.46, 0.46, icing, 0.2); coat.modifiers['bevel'].segments = 8
coat.modifiers['bevel'].use_clamp_overlap = False       # the outline's short edges would clamp the roundness away
post.append(coat)
SPR = ['#ff3d9a', '#ffe21c', '#ffffff', '#ff8a1c', '#b06aff', '#2fd24a']
for i in range(34):
    p = Vector((rnd.uniform(-1.3, 1.4), -0.49, rnd.uniform(0.75, 1.95))); a = rnd.uniform(0, math.pi)
    d = Vector((math.cos(a), 0, math.sin(a))) * 0.11
    post.append(rig.tube('sprinkle', [p - d, p + d], 0.04, rig.plastic('sprinkle', rig.hexrgb(SPR[i % 6]), rough=0.15, coat=1.0, emit=0.2), res=4))
P = Vector((0.0, 0.3, 1.25))
rig.group(post, loc=P, rot=(-4, 6, -10), scale=1.0)
for x, z, r in ((-0.9, 0.0, 0.5), (0.5, 0.0, 0.34)):             # and what has dripped right off, on the floor
    rig.ball((x, 0.1, G + 0.02), r, icing, 'puddle', 32, scale=(1, 1, 0.14))

# ---- what bounces off: a salt shaker and a slice of pepperoni, a star where each hit ---------------
bang = rig.plastic('bang', rig.hexrgb('#fff06a'), rough=0.2, emit=1.3)
streak = rig.plastic('streak', (1, 1, 1), rough=0.2, emit=1.0)
def hit(at, away, s):
    o = rig.slab('bang', rig.star(7, s, s * 0.45, 0.2), -0.04, 0.04, bang, 0.01); o.location = at
    for k in (-1, 0, 1):                                         # speed lines along the way it flew off
        side = Vector((-away.z, 0, away.x)) * 0.2 * k
        rig.tube('streak', [at + away * (0.75 + 0.1 * abs(k)) + side, at + away * (1.15 - 0.12 * abs(k)) + side], 0.025, streak, res=3)
shaker = rig.plastic('shaker', (0.95, 0.96, 1.0), rough=0.08, coat=1.0)
chrome = rig.plastic('chrome', (0.85, 0.93, 1.0), rough=0.05, metallic=1.0)
pinkm = rig.plastic('salt-band', rig.hexrgb('#ff3d7f'), rough=0.2, emit=0.3)
salt = [rig.lathe('shaker', [(0.42, 0), (0.44, 0.1), (0.36, 0.95), (0.3, 1.2)], shaker),
        rig.lathe('band', [(0.43, 0.38), (0.415, 0.6)], pinkm, thick=0.03),
        rig.lathe('cap', [(0.32, 1.2), (0.32, 1.3), (0.24, 1.5), (0.1, 1.56)], chrome)]
S = Vector((-1.9, -0.9, 3.4))
rig.group(salt, loc=S, rot=(10, 152, 0), scale=0.75)
hit(Vector((-1.45, -0.75, 1.75)), Vector((-0.75, 0, 0.66)), 0.4)
for i in range(14):
    rig.ball(S + Vector((rnd.uniform(0.2, 1.3), rnd.uniform(-0.3, 0.3), rnd.uniform(-1.3, 0.2))), rnd.uniform(0.02, 0.04), shaker, 'grain', 6)
meat = rig.plastic('pepperoni', rig.hexrgb('#e02a12'), rough=0.2, coat=1.0, emit=0.15)
fat = rig.plastic('pepperoni-spot', rig.hexrgb('#8a120a'), rough=0.3)
pep = [rig.cone((0, -0.07, 0), (0, 0.07, 0), 0.62, 0.62, meat, 48), rig.tube('rind', [(math.cos(a) * 0.62, 0, math.sin(a) * 0.62) for a in (math.tau * j / 48 for j in range(49))], 0.075, fat, res=4)]
for x, z, r in ((-0.25, 0.22, 0.13), (0.22, 0.28, 0.1), (0.3, -0.15, 0.14), (-0.12, -0.3, 0.11), (-0.38, -0.1, 0.07), (0.02, 0.02, 0.08)):
    pep.append(rig.ball((x, -0.07, z), r, fat, 'spot', 16, scale=(1, 0.25, 1)))
PP = Vector((1.9, -1.1, 0.7))
rig.group(pep, loc=PP, rot=(-12, 25, 30), scale=1.0)
hit(Vector((1.45, -0.9, 1.3)), Vector((0.72, 0, -0.69)), 0.36)

rig.area('key', (-6, -9, 7), 4.0, 1800, look_at=tuple(P))
rig.area('window', (4, -8, 3), 1.2, 800, look_at=tuple(P), size_y=6.0)
rig.area('rim', (5, 6, 5), 4.0, 2000, rgb=(0.4, 0.95, 1.0), look_at=tuple(P), glossy=False)
rig.area('soft', (-7, -5, -1), 8.0, 600, rgb=(0.7, 0.95, 1.0), look_at=(0, 0, 0), glossy=False)
rig.world((0.03, 0.18, 0.26), 0.8)
rig.camera(60, elev=5, target=(0, 0, 0.0))
rig.render(OUT)
