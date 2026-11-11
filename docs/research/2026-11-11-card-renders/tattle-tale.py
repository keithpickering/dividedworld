"""Tattle-Tale card art exploration: a huge cartoon glove pointing the finger, a red beacon turning, and a
Mod Bot's boxy head swinging round to look where the finger points."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('TATTLE_TALE_SEED', '1')))
sc = rig.reset()
rig.backdrop(18, [(0.3, '#1a0410'), (0.52, '#b01c66'), (0.72, '#2a0618')])
G = -3.8
rig.floor(G, rig.checker('floor', '#3a0a22', '#c2327a', 50, rough=0.12))

# ---- the Mod Bot: boxy, an antenna, one glowing eye, turned to its left ---------------------------
B = Vector((0.7, 1.6, 1.95))
shell = rig.plastic('bot', rig.hexrgb('#16a8c4'), rough=0.18, metallic=0.4, coat=1.0)
dark = rig.plastic('bot-dark', rig.hexrgb('#06202a'), rough=0.3)
chrome = rig.plastic('chrome', (1.0, 0.88, 0.94), rough=0.06, metallic=1.0)
eye = rig.glow('eye', rig.hexrgb('#ffe23a'), 7.0)
bot = [rig.slab('head', rig.rrect(2.3, 1.8, 0.3), -0.85, 0.85, shell, 0.16),
       rig.slab('face', rig.rrect(1.95, 1.0, 0.2), -0.91, -0.8, dark, 0.03),
       rig.cone((0.0, -0.88, 0.25), (0.0, -1.08, 0.25), 0.44, 0.4, chrome, 48),
       rig.ball((0.0, -1.02, 0.25), 0.3, eye, 'eye', 32, scale=(1, 0.45, 1)),
       rig.ball((0.1, -1.16, 0.25), 0.11, dark, 'pupil', 20, scale=(1, 0.4, 1)),
       rig.cone((0, 0, 0.9), (0, 0, 1.45), 0.06, 0.04, chrome, 16), rig.ball((0, 0, 1.55), 0.15, rig.glow('tip', rig.hexrgb('#ff3a6a'), 6.0), 'tip', 24),
       rig.cone((0, 0, -0.9), (0, 0, -1.5), 0.42, 0.5, dark, 32)]
bot[1].location = (0, 0, 0.1)
for j in range(7):                                               # the grille it speaks through
    bot.append(rig.slab('grille', rig.rrect(0.1, 0.26, 0.04), -0.9, -0.84, dark, 0.01)); bot[-1].location = (-0.6 + 0.2 * j, 0, -0.62)
for sx in (-1, 1):
    bot.append(rig.cone((sx * 1.15, 0, 0.1), (sx * 1.38, 0, 0.1), 0.3, 0.24, chrome, 32))
rig.group(bot, loc=B, rot=(3, 6, 38))
body = rig.slab('body', rig.rrect(3.0, 2.6, 0.4), -0.7, 0.7, shell, 0.2); body.location = B + Vector((0, 0.3, -2.8))
panel = rig.slab('panel', rig.rrect(2.2, 0.9, 0.15), -0.03, 0.03, dark, 0.02); panel.location = B + Vector((0, -0.42, -2.3))
for j in range(5):
    rig.ball(tuple(B + Vector((-0.8 + 0.4 * j, -0.47, -2.3))), 0.11, rig.glow(f'led{j}', rig.hexrgb(rnd.choice(['#ff3a6a', '#ffe23a', '#3affc8'])), 4.0), 'led', 16)
el = bpy.data.lights.new('eye', 'POINT'); el.energy = 150; el.color = (1.0, 0.85, 0.3)
eo = bpy.data.objects.new('eye', el); sc.collection.objects.link(eo); eo.location = B + Vector((0.9, -1.6, 0.2))

# ---- the beacon: a red lamp on a pole, its two beams turning ---------------------------------------
L = Vector((-1.55, 1.2, 2.55))
rig.cone((L.x, L.y, G), (L.x, L.y, L.z - 0.45), 0.09, 0.09, dark, 16)
rig.cone(tuple(L + Vector((0, 0, -0.5))), tuple(L + Vector((0, 0, -0.28))), 0.5, 0.5, chrome, 40)
rig.lathe('dome', [(0.42, -0.28), (0.42, 0.2), (0.36, 0.42), (0.22, 0.56), (0.0, 0.6)], rig.plastic('dome', rig.hexrgb('#ff1c2a'), rough=0.05, coat=1.0, emit=2.5), tuple(L), seg=40)
beam = rig.glow('beam', rig.hexrgb('#ff2a3a'), 2.5, alpha=0.14)
C0 = L + Vector((0, 0, 0.1))
rig.cone(tuple(C0), tuple(C0 + Vector((6.0, -2.4, 0.7))), 0.1, 0.8, beam, 48)
rig.cone(tuple(C0), tuple(C0 + Vector((-6.0, 2.4, -0.7))), 0.1, 0.8, beam, 48)
ll = bpy.data.lights.new('beacon', 'POINT'); ll.energy = 700; ll.color = (1.0, 0.1, 0.15)
lo = bpy.data.objects.new('beacon', ll); sc.collection.objects.link(lo); lo.location = L + Vector((0.2, -0.9, 0.1))

# ---- the glove: in from the left, one finger out ---------------------------------------------------
glove = rig.plastic('glove', (1.0, 1.0, 0.98), rough=0.18, coat=1.0)
ink = rig.plastic('ink', (0.03, 0.01, 0.03), rough=0.4)
sleeve = rig.plastic('sleeve', rig.hexrgb('#ff2a8a'), rough=0.3, coat=0.5)
hand = [rig.ball((0, 0, 0), 0.85, glove, 'palm', 48, scale=(1.0, 0.72, 0.95)),
        rig.cone((0.45, 0, 0.42), (2.0, 0, 0.42), 0.29, 0.26, glove, 32), rig.ball((2.0, 0, 0.42), 0.26, glove, 'tip', 32),
        rig.ball((0.5, 0, 0.42), 0.33, glove, 'knuckle', 32),
        rig.ball((0.72, -0.12, -0.02), 0.31, glove, 'curl', 32), rig.ball((0.66, -0.12, -0.36), 0.3, glove, 'curl', 32), rig.ball((0.5, -0.12, -0.66), 0.27, glove, 'curl', 32),
        rig.cone((-0.15, -0.5, 0.25), (0.5, -0.62, 0.1), 0.25, 0.22, glove, 32), rig.ball((0.5, -0.62, 0.1), 0.22, glove, 'thumb', 32), rig.ball((-0.15, -0.5, 0.25), 0.25, glove, 'thumb', 32),
        rig.cone((-0.7, 0, 0), (-1.0, 0, 0), 0.7, 0.8, glove, 48),
        rig.ball((-1.05, 0, 0), 0.9, glove, 'cuff', 48, scale=(0.3, 1, 1)),
        rig.cone((-1.1, 0, 0), (-5.5, 0, 0), 0.55, 0.6, sleeve, 40)]
for k in range(3):                                               # the three darts on the back of a cartoon glove
    hand.append(rig.tube('dart', [(-0.5, -0.5 + 0.04 * abs(k - 1), -0.25 + 0.25 * k), (-0.05, -0.59 + 0.03 * abs(k - 1), -0.25 + 0.25 * k)], 0.035, ink, res=4))
rig.group(hand, loc=(-1.0, -1.6, -0.35), rot=(0, -9, 0), scale=1.0)

rig.area('key', (-5, -10, 6), 4.0, 1500, look_at=(0, 0, 0.8))
rig.area('fill', (6, -8, 0), 6.0, 500, rgb=(1.0, 0.7, 0.85), look_at=(0, 0, 0.5))
rig.area('rim', (6, 6, 5), 4.0, 3000, rgb=(1.0, 0.3, 0.6), look_at=tuple(B), glossy=False)
rig.world((0.14, 0.03, 0.08), 0.6)
rig.camera(60, elev=5)
rig.render(OUT)
