"""THIS card art: a post with a few of its words swiped in highlighter, THIS written under them in marker with an
arrow up to the place, and the marker that did it still in the air, its cap on the floor. (The card puts a short
note under a phrase in a post, pointing at it.)"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
rig.backdrop(18, [(0.0, '#1a0503'), (0.45, '#7a1c0e'), (0.8, '#f0803c'), (1.0, '#3a0c06')]).scale.x = 60
G = -3.4
rig.floor(G, rig.checker('floor', '#2a0906', '#8a2814', 40, rough=0.1))

# ---- the post: its box, an avatar, lines of words, one stretch of them highlighted -----------------
card = rig.plastic('post', rig.hexrgb('#cfd6de'), rough=0.35)
grey = rig.plastic('words', rig.hexrgb('#8a96a6'), rough=0.5)
ink = rig.plastic('marker', rig.hexrgb('#d8121c'), rough=0.25, coat=0.6, emit=0.15)
post = [rig.slab('post', rig.rrect(4.7, 4.3, 0.22), -0.06, 0.06, card, 0.03),
        rig.slab('avatar', rig.rrect(0.75, 0.75, 0.12), -0.1, -0.06, rig.plastic('avatar', rig.hexrgb('#3f8fd2'), rough=0.3), 0.015)]
post[1].location = (-1.75, 0, 1.55)
def words(x0, wide, z):
    o = rig.slab('line', rig.rrect(wide, 0.13, 0.06, 3), -0.085, -0.06, grey, 0.0); o.location = (x0 + wide / 2, 0, z); post.append(o)
for wide, z in ((2.6, 1.7), (3.0, 1.4)): words(-1.15, wide, z)
for wide, z in ((3.9, 0.85), (3.6, 0.52)): words(-2.1, wide, z)
words(-2.1, 0.9, 0.19); words(0.45, 1.5, 0.19)                    # the line with the phrase: words, the phrase, words
words(-1.05, 1.35, 0.19)
swipe = rig.slab('swipe', rig.rrect(1.6, 0.34, 0.1, 3), -0.098, -0.09, rig.glow('swipe', rig.hexrgb('#fff23a'), 1.4, alpha=0.6), 0.0); swipe.location = (-0.38, 0, 0.19); post.append(swipe)
for wide, z in ((3.7, -1.25), (2.4, -1.58)): words(-2.1, wide, z)     # the lines below, pushed down to make room for the note
post.append(rig.text('THIS', 0.92, ink, (0.72, -0.07, -0.56), depth=0.02, bevel=0.004, rot=(0, math.radians(-5), 0)))
P0, P1, P2 = Vector((-0.45, -0.1, -0.6)), Vector((-1.4, -0.1, -0.68)), Vector((-0.45, -0.1, -0.06))     # round from the word and up to the phrase, by hand
arrow = [P0 * (1 - t) ** 2 + P1 * 2 * t * (1 - t) + P2 * t * t for t in (j / 16 for j in range(17))]
post.append(rig.tube('arrow', [tuple(p) for p in arrow], 0.055, ink, res=4))
back = (arrow[-2] - arrow[-1]).normalized()
for turn in (-0.6, 0.6):                 # its head, two strokes
    d = Vector((back.x * math.cos(turn) - back.z * math.sin(turn), 0, back.x * math.sin(turn) + back.z * math.cos(turn)))
    post.append(rig.tube('head', [tuple(arrow[-1]), tuple(arrow[-1] + d * 0.34)], 0.055, ink, res=4))
board = rig.group(post, loc=(0.0, 1.0, 1.35), rot=(-4, 6, -3))
bpy.context.view_layer.update()

# ---- the marker, and its cap -----------------------------------------------------------------------
barrel = rig.plastic('barrel', rig.hexrgb('#e8e2d4'), rough=0.25, coat=0.6)
red = rig.plastic('cap', rig.hexrgb('#d8121c'), rough=0.2, coat=0.8)
pen = [rig.cone((0, 0, 0.75), (0, 0, 3.6), 0.3, 0.3, barrel, 40), rig.ball((0, 0, 3.6), 0.3, red, 'end', 32, scale=(1, 1, 0.5)),
       rig.cone((0, 0, 0.75), (0, 0, 0.35), 0.3, 0.17, red, 40), rig.cone((0, 0, 0.35), (0, 0, 0.0), 0.12, 0.05, ink, 24),
       rig.cone((0, 0, 1.5), (0, 0, 2.7), 0.305, 0.305, red, 40)]
END = board.matrix_world @ Vector((1.9, -0.1, -0.84))            # where the S ends
root = rig.group(pen, loc=tuple(END + Vector((0.02, -0.12, -0.02))))
root.rotation_euler = Vector((0, 0, 1)).rotation_difference(Vector((0.42, -0.5, -0.76)).normalized()).to_euler()   # tip to the page, barrel down toward us
lid = [rig.cone((0, 0, 0), (0, 0, 0.95), 0.34, 0.32, red, 40), rig.ball((0, 0, 0.95), 0.32, red, 'top', 32, scale=(1, 1, 0.4)),
       rig.slab('clip', rig.rrect(0.12, 0.8, 0.04, 2), -0.39, -0.35, red, 0.01)]
lid[2].location = (0, 0, 0.5)
rig.group(lid, loc=(-1.5, -1.6, G + 0.34), rot=(90, 0, 55))

LOOK = (0, 0, 0.5)
rig.area('key', (-5, -9, 7), 4.0, 1500, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 600, look_at=LOOK, size_y=6.0)
rig.area('rim', (5, 6, 6), 4.0, 2200, rgb=(1.0, 0.7, 0.3), look_at=LOOK, glossy=False)
rig.area('soft', (-7, -4, -1), 8.0, 450, rgb=(1.0, 0.85, 0.75), look_at=LOOK)
rig.world((0.12, 0.04, 0.02), 0.7)
rig.camera(50)
rig.render(OUT)
