"""Whodunnit, a Minus World spell, as a 90s render. Its icon's alt text: "a generic anonymous detective lurks
stealthily against a brick wall in the dead of a rainy night"."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('WHODUNNIT_SEED', '2')))
sc = rig.reset()
# ---- the alley wall: bricks, a few of them paler, a pool of lamplight on it ----------------------
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 3.3, 0), rotation=(math.radians(90), 0, 0))
w = bpy.context.object; w.scale = (30, 30, 1); w.data.materials.append(rig.plastic('mortar', rig.hexrgb('#0e2238'), rough=0.8))
BR = [rig.plastic(f'brick{i}', rig.hexrgb(h), rough=0.7) for i, h in enumerate(['#27507a', '#2c5a88', '#234868', '#3a6c9a'])]
row = 0; z = -5.0
while z < 5.2:
    x = -4.6 - (0.5 if row % 2 else 0)
    while x < 4.6:
        if rnd.random() < 0.82:
            o = rig.slab('brick', rig.rrect(0.92, 0.36, 0.03), -0.06, 0.06, BR[3] if rnd.random() < 0.1 else rnd.choice(BR[:3]), 0.02); o.location = (x, 3.25, z)
        x += 1.0
    z += 0.44; row += 1

# ---- the figure -----------------------------------------------------------------------------------
coat = rig.plastic('coat', rig.hexrgb('#16283c'), rough=0.55)
coat_dark = rig.plastic('coat-dark', rig.hexrgb('#0c1826'), rough=0.6)
felt = rig.plastic('hat', rig.hexrgb('#101e30'), rough=0.5)
band = rig.plastic('band', rig.hexrgb('#22405c'), rough=0.4)
flesh = rig.plastic('shade', rig.hexrgb('#1a3444'), rough=0.85)
P = Vector((0.15, 1.5, 0))             # close against the wall
body = rig.lathe('coat', [(2.5, -5.2), (2.35, -2.2), (2.0, -1.2), (1.2, -0.55), (0.55, -0.3)], coat, P, seg=64); body.scale = (1, 0.55, 1)
rig.ball(P + Vector((0, -0.05, 0.55)), 0.78, flesh, 'head', 48, scale=(0.82, 0.85, 1.08))
for sx in (-1, 1):                                               # the collar, turned up either side of the face
    o = rig.slab('collar', [(0, -0.9), (0.95, -0.2), (0.75, 1.0), (0.1, 0.25)], -0.05, 0.05, coat_dark, 0.03)
    o.location = P + Vector((sx * 0.3, -0.62, -0.25)); o.rotation_euler = (math.radians(-8), math.radians(8 * sx), math.radians(sx * 28)); o.scale = (sx, 1, 1)
rig.tube('lapel', [P + Vector((-0.05, -1.25, -0.9)), P + Vector((0.1, -1.38, -2.4)), P + Vector((0.2, -1.36, -4.6))], 0.03, coat_dark, res=3)
for k in range(3): rig.ball(P + Vector((0.42, -1.33 - 0.01 * k, -1.7 - 0.8 * k)), 0.08, coat_dark, 'button', 16, scale=(1, 0.4, 1))
hat = [rig.lathe('brim', [(0.0, -0.03), (1.5, -0.06), (1.56, 0.0), (1.5, 0.05), (0.0, 0.05)], felt),
       rig.lathe('crown', [(0.8, 0.0), (0.78, 0.5), (0.7, 0.78), (0.45, 0.9), (0.0, 0.86)], felt),
       rig.lathe('band', [(0.82, 0.03), (0.82, 0.24), (0.8, 0.26)], band)]
hat[0].scale = (1, 0.85, 1)
rig.group(hat, loc=P + Vector((-0.05, -0.1, 1.04)), rot=(11, -7, 0))
# one eye, lit
eye = rig.glow('eye', rig.hexrgb('#e8f6ff'), 9.0)
o = rig.slab('eye', [(-0.3, 0.0), (-0.1, 0.075), (0.26, 0.04), (0.3, -0.02), (0.0, -0.06)], -0.02, 0.02, eye, 0.004)
o.location = P + Vector((-0.2, -0.74, 0.5)); o.rotation_euler = (0, math.radians(6), 0)
el = bpy.data.lights.new('eye', 'POINT'); el.energy = 40; el.color = (0.8, 0.93, 1.0)
eo = bpy.data.objects.new('eye', el); sc.collection.objects.link(eo); eo.location = P + Vector((-0.2, -1.1, 0.4))

# ---- the light: a lamp somewhere up and left, its beam in the damp air, rain in it ---------------
beam = rig.glow('beam', rig.hexrgb('#6aa8e0'), 0.6, alpha=0.05)
rig.cone((-4.5, 2.2, 8), (0.5, 2.2, -5), 0.4, 3.4, beam, 48)
sp = bpy.data.lights.new('lamp', 'SPOT'); sp.energy = 1300; sp.spot_size = math.radians(48); sp.spot_blend = 0.6; sp.color = (0.55, 0.78, 1.0)
so = bpy.data.objects.new('lamp', sp); sc.collection.objects.link(so); so.location = (-4.5, 0.5, 8)
so.rotation_euler = (Vector((0.8, 3.3, -0.5)) - Vector(so.location)).to_track_quat('-Z', 'Y').to_euler()
rain = rig.glow('rain', rig.hexrgb('#9ac8f0'), 1.2, alpha=0.5)
for i in range(120):
    x, y, z = rnd.uniform(-3.4, 3.4), rnd.uniform(-3.0, 2.8), rnd.uniform(-4.6, 4.6); ln = rnd.uniform(0.3, 0.75)
    rig.tube('rain', [(x, y, z), (x + ln * 0.22, y, z - ln)], 0.008, rain, res=2)
# a hard lamp low and to one side, so the figure throws a long shadow up the wall beside it
kl = bpy.data.lights.new('street', 'SPOT'); kl.energy = 6500; kl.spot_size = math.radians(60); kl.spot_blend = 0.5; kl.shadow_soft_size = 0.05; kl.color = (0.6, 0.82, 1.0)
ko = bpy.data.objects.new('street', kl); sc.collection.objects.link(ko); ko.location = (-5.5, -5.5, -1.5)
ko.rotation_euler = (Vector((0.6, 2.5, 0.6)) - Vector(ko.location)).to_track_quat('-Z', 'Y').to_euler()
rig.area('rim', (5, 2.5, 4), 3.0, 2600, rgb=(0.75, 0.9, 1.0), look_at=tuple(P), glossy=False)
rig.world((0.01, 0.03, 0.07), 0.6)
rig.camera(60)
rig.render(OUT)
