"""Trap Card card art, after the placeholder art.svg: a sprung-open trap with a card for bait."""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
rig.backdrop(16, [(0.0, '#12020a'), (0.5, '#3a0a22'), (1.0, '#0c0106')])
rig.floor(0.0, rig.checker('floor', '#2a0616', '#48102a', 26, rough=0.22))

steel = rig.plastic('jaw', rig.hexrgb('#ff3d7f'), rough=0.12, metallic=1.0)
dark = rig.plastic('iron', rig.hexrgb('#2a0a18'), rough=0.25, metallic=1.0)
tooth = rig.plastic('tooth', (0.95, 0.9, 0.95), rough=0.06, metallic=1.0)
H = Vector((0, 0, 0.3))                 # the middle of the hinge line, which runs along x
R = 2.3

def jaw(lean, radial):
    """One jaw: a half hoop on the hinge, leaning `lean` degrees from upright (toward the camera when negative).
    Its teeth point at the hinge's middle when `radial`, and across at the other jaw when not."""
    a = math.radians(lean); up = Vector((0, math.sin(a), math.cos(a))); out = []
    pts = [H + Vector((math.cos(t) * R, 0, 0)) + up * math.sin(t) * R for t in (math.pi * j / 48 for j in range(49))]
    out.append(rig.tube('jaw', pts, 0.14, steel, res=8))
    for j in range(1, 14):                                       # teeth point at the other jaw
        t = math.pi * j / 14
        p = H + Vector((math.cos(t) * R, 0, 0)) + up * math.sin(t) * R
        inward = Vector((0, -math.cos(a), math.sin(a))) * (1 if lean > 0 else -1)
        tip = (H - p).normalized() * 0.62 if radial else inward * 0.7 + (H - p).normalized() * 0.15
        out.append(rig.cone(p, p + tip, 0.15, 0.0, tooth, 16))
    return out
jaw(-74, False); jaw(6, True)
rig.tube('hinge', [H + Vector((-R - 0.5, 0, 0)), H + Vector((R + 0.5, 0, 0))], 0.12, dark, res=8)
for sx in (-1, 1):                                               # springs: a coil on each end of the hinge
    c = H + Vector((sx * (R + 0.15), 0, 0))
    rig.tube('spring', [c + Vector((sx * (k / 60) * 0.5, math.cos(k * 0.7) * 0.26, math.sin(k * 0.7) * 0.26)) for k in range(61)], 0.045, tooth, res=6)
rig.cone(H + Vector((0, 0, -0.05)), H + Vector((0, 0, 0.06)), 0.75, 0.75, dark, 48)   # the plate the bait stands on
rig.cone(H + Vector((0, 0, 0.06)), H + Vector((0, 0, 0.1)), 0.55, 0.55, steel, 48)

# the bait: a card, upright on the plate, glowing a little
paper = rig.plastic('card', rig.hexrgb('#ffd9e6'), rough=0.2, coat=1.0, emit=0.12)
edge = rig.plastic('card-edge', rig.hexrgb('#ff3d7f'), rough=0.2, coat=1.0, emit=0.2)
card = [rig.slab('card', rig.rrect(1.5, 2.15, 0.13), -0.04, 0.04, edge, 0.02),
        rig.slab('card-face', rig.rrect(1.3, 1.95, 0.08), -0.06, -0.02, paper, 0.01)]
card.append(rig.cone((0, -0.07, 0.35), (0, -0.05, 0.35), 0.32, 0.32, edge, 40))
card.append(rig.tube('check', [(-0.15, -0.09, 0.35), (-0.04, -0.09, 0.24), (0.17, -0.09, 0.47)], 0.04, paper, res=6))
for k in range(3):
    card.append(rig.slab('line', rig.rrect(0.9 - 0.2 * k, 0.07, 0.03), -0.075, -0.05, edge, 0.005)); card[-1].location = (0, 0, -0.25 - 0.2 * k)
rig.group(card, loc=H + Vector((0, -0.25, 1.15)), rot=(2, 0, 5), scale=0.92)

# a hard pink light straight down on it, and the beam it comes in
beam = rig.glow('beam', rig.hexrgb('#ff5a94'), 0.6, alpha=0.035)
rig.cone(H + Vector((0, 0.2, 9)), H + Vector((0, 0.2, 0)), 0.4, 2.2, beam, 64)
sp = bpy.data.lights.new('spot', 'SPOT'); sp.energy = 4500; sp.spot_size = math.radians(38); sp.color = (1.0, 0.6, 0.8)
so = bpy.data.objects.new('spot', sp); sc.collection.objects.link(so); so.location = H + Vector((0, -0.5, 9))
rig.area('key', (-6, -8, 6), 4.0, 1300, look_at=tuple(H + Vector((0, 0, 1))))
rig.area('rim', (5, 5, 5), 4.0, 2500, rgb=(1.0, 0.5, 0.8), look_at=tuple(H), glossy=False)
rig.world((0.12, 0.02, 0.08), 0.6)
cam = rig.camera(60, elev=13, target=(0, 0, 0.95))
cam.data.sensor_height = 36 / 1.16         # a little closer: the trap was small in its frame
rig.render(OUT)
