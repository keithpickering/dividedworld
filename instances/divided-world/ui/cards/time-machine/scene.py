"""Time Machine card art: the only time machine most houses ever had, a video recorder, falling back through a
tunnel of rings with its clock still flashing 12:00, its rewind button lit and a tape half out of it; clocks go by.
(The card shows a post as it was at an earlier point, for a week, and freezes it.)"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('TIME_SEED', '12')))
sc = rig.reset()
rig.backdrop(60, [(0.0, '#020005'), (0.5, '#0c0214'), (1.0, '#020005')]).scale = (200, 200, 1)

# ---- the tunnel: rings going away, each turned a little on from the last ---------------------------
for k in range(26):
    y = 2.5 + k * 1.9; turn = k * 0.33
    cx, cz = math.cos(turn) * 0.5 * k ** 0.6, 0.9 + math.sin(turn) * 0.5 * k ** 0.6
    hx = ('#ff5a1c', '#ffc21c', '#b43cff', '#ff2a6a')[k % 4]
    bpy.ops.mesh.primitive_torus_add(major_radius=4.6, minor_radius=0.11, major_segments=72, minor_segments=8, location=(cx, y, cz), rotation=(math.radians(90), 0, 0))
    o = bpy.context.object; bpy.ops.object.shade_smooth(); o.data.materials.append(rig.glow('ring', rig.hexrgb(hx), 3.2 * 0.93 ** k))
streak = rig.glow('streak', rig.hexrgb('#fff1c0'), 2.0, alpha=0.6)
for i in range(46):                      # stars drawn out into lines by the speed
    a = rnd.uniform(0, math.tau); r = rnd.uniform(2.6, 4.2); y = rnd.uniform(3, 30)
    rig.tube('streak', [(math.cos(a) * r, y, 0.9 + math.sin(a) * r), (math.cos(a) * r * 1.05, y - rnd.uniform(1.5, 4.0), 0.9 + math.sin(a) * r * 1.05)], 0.02, streak, res=2)

# ---- the recorder ----------------------------------------------------------------------------------
case = rig.plastic('case', (0.035, 0.035, 0.04), rough=0.3, coat=0.4)
panel = rig.plastic('panel', (0.012, 0.012, 0.015), rough=0.12, coat=1.0)
grey = rig.plastic('button', (0.3, 0.31, 0.33), rough=0.35)
lcd = rig.glow('lcd', rig.hexrgb('#3affd0'), 6.0)
lit = rig.glow('rew', rig.hexrgb('#ff7a1c'), 7.0)
W, D, H = 4.5, 3.0, 1.15
F = -D / 2                               # its front
vcr = [rig.box('case', W, D, H, case, (0, 0, 0), bevel=0.05),
       rig.slab('panel', rig.rrect(W - 0.16, H - 0.16, 0.05, 2), F - 0.02, F + 0.02, panel, 0.0)]
vcr[1].location = (0, 0, H / 2)
slot = rig.slab('slot', rig.rrect(2.3, 0.42, 0.04, 2), F - 0.03, F + 0.01, rig.plastic('slot', (0, 0, 0), rough=0.9), 0.0); slot.location = (-0.85, 0, H * 0.66); vcr.append(slot)
window = rig.slab('window', rig.rrect(1.45, 0.42, 0.04, 2), F - 0.03, F + 0.01, rig.plastic('window', (0.0, 0.03, 0.03), rough=0.05, coat=1.0), 0.0); window.location = (1.35, 0, H * 0.66); vcr.append(window)
vcr.append(rig.text('12:00', 0.36, lcd, (1.35, F - 0.035, H * 0.66), depth=0.004, bevel=0.0))
for k in range(5):                       # the buttons, with rewind lit
    x = -1.9 + 0.5 * k
    o = rig.slab('button', rig.rrect(0.4, 0.17, 0.03, 2), F - 0.06, F, lit if k == 0 else grey, 0.01); o.location = (x, 0, H * 0.24); vcr.append(o)
for dx in (0.0, 0.16):                   # the two arrowheads on it
    o = rig.slab('arrowhead', [(-0.08, 0), (0.06, 0.07), (0.06, -0.07)], F - 0.075, F - 0.06, panel, 0.0); o.location = (-1.98 + dx, 0, H * 0.24); vcr.append(o)
vcr.append(rig.ball((1.9, F - 0.02, H * 0.24), 0.05, rig.glow('led', rig.hexrgb('#ff1c1c'), 8.0), 'led', 12))
for sx in (-1, 1):                       # feet
    vcr.append(rig.box('foot', 0.5, 0.4, 0.1, panel, (sx * 1.8, F + 0.5, -0.1), bevel=0.02))

# ---- the tape: half way out of the slot, its label asking the usual thing -------------------------
tape = [rig.box('tape', 2.15, 1.5, 0.3, rig.plastic('tape', (0.015, 0.015, 0.018), rough=0.4), (0, 0, 0), bevel=0.02),
        rig.slab('label', rig.rrect(1.5, 0.2, 0.02, 1), -0.76, -0.75, rig.plastic('label', rig.hexrgb('#fff6d8'), rough=0.6), 0.0),
        rig.text('BE KIND, REWIND', 0.11, rig.plastic('pen', rig.hexrgb('#c8141c'), rough=0.4), (0, -0.765, 0.15), depth=0.003, bevel=0.0)]
tape[1].location = (0, 0, 0.15)
for sx in (-1, 1):                       # the reel windows on its top
    o = rig.lathe('reel', [(0.0, 0.0), (0.26, 0.0), (0.26, 0.012), (0.0, 0.012)], rig.plastic('reel', (0.75, 0.78, 0.8), rough=0.2, coat=0.5), (sx * 0.5, -0.2, 0.3), seg=24); tape.append(o)
t = rig.group(tape, loc=(-0.85, F - 0.25, H * 0.66 - 0.15)); t.parent = None
vcr.append(t)
machine = rig.group(vcr, loc=(0.0, 0, 1.3), rot=(17, -16, 10), scale=1.0)

# ---- clocks, going by ------------------------------------------------------------------------------
face = rig.plastic('face', rig.hexrgb('#fff6e0'), rough=0.2, coat=0.8, emit=0.15)
brass = rig.plastic('brass', rig.hexrgb('#ffc21c'), rough=0.18, metallic=0.9, emit=0.1)
ink = rig.plastic('hand', (0.01, 0.01, 0.012), rough=0.3)
for x, y, z, r in ((-2.0, 3.5, 3.3, 0.62), (2.1, 5.0, 2.7, 0.7), (-2.3, 6.5, -0.8, 0.8), (2.2, 4.0, -1.2, 0.55), (0.3, 9.0, 3.4, 0.9), (-0.6, 8.0, -2.4, 0.8)):
    clock = [rig.lathe('face', [(0.0, 0.0), (0.92, 0.0), (0.92, 0.06), (0.0, 0.06)], face, seg=40),
             rig.tube('bezel', [(math.cos(a) * 0.96, math.sin(a) * 0.96, 0.04) for a in (math.tau * j / 48 for j in range(49))], 0.09, brass, res=5)]
    for long, a in ((0.72, rnd.uniform(0, math.tau)), (0.48, rnd.uniform(0, math.tau))):
        clock.append(rig.tube('hand', [(0, 0, 0.09), (math.cos(a) * long, math.sin(a) * long, 0.09)], 0.045, ink, res=3))
    for j in range(12):
        a = math.tau * j / 12; clock.append(rig.ball((math.cos(a) * 0.78, math.sin(a) * 0.78, 0.07), 0.045, ink, 'hour', 8))
    rig.group(clock, loc=(x, y, z), rot=(90 + rnd.uniform(-25, 25), rnd.uniform(-30, 30), rnd.uniform(-30, 30)), scale=r)

LOOK = (0, 0, 1.2)
rig.area('key', (-5, -9, 7), 4.0, 1700, look_at=LOOK)
rig.area('window', (4.5, -7, 2), 1.0, 700, look_at=LOOK, size_y=6.0, glossy=False)
rig.area('rim', (5, 6, 6), 4.0, 2200, rgb=(1.0, 0.45, 0.2), look_at=LOOK, glossy=False)
rig.area('violet', (-6, 5, -2), 4.0, 1600, rgb=(0.6, 0.25, 1.0), look_at=LOOK, glossy=False)
rig.world((0.02, 0.005, 0.03), 0.5)
rig.camera(40)
rig.render(OUT)
