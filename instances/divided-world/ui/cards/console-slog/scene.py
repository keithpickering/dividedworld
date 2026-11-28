"""Console Slog card art: a beige CRT on a desk, a green prompt and a half-typed line on its screen, and a keyboard
in front of it with worn keys."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # rig.py is one folder up, shared by every card
sys.dont_write_bytecode = True           # no __pycache__ beside the card folders: the art guard reads every folder there as a card's
import bpy
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('SLOG_SEED', '3')))
sc = rig.reset()
rig.backdrop(26, [(0.0, '#10030a'), (0.45, '#7a1f4a'), (0.7, '#3a0c26'), (1.0, '#14040c')])
rig.world((0.12, 0.03, 0.07), 0.6)
DESK = -1.3
rig.floor(DESK, rig.plastic('desk', rig.hexrgb('#4a1630'), rough=0.5), y=2)

beige = rig.plastic('beige', rig.hexrgb('#d9ceb0'), rough=0.45)
beige_dk = rig.plastic('beige-dark', rig.hexrgb('#b5a98a'), rough=0.5)
yellowed = rig.plastic('yellowed', rig.hexrgb('#cdbb86'), rough=0.5)
worn = rig.plastic('worn', rig.hexrgb('#a89f88'), rough=0.12, coat=0.5)       # a key rubbed shiny
legend = rig.plastic('legend', rig.hexrgb('#3b352c'), rough=0.6)
slot = rig.plastic('slot', (0.02, 0.02, 0.02), rough=0.5)
green = rig.hexrgb('#22ff55')

# ---- the monitor: a deep tube behind a bezel and a bulging glass ---------------------------------------
CX, CZ = 0.0, DESK + 0.62            # the foot of the neck rests on the desk
W, H = 4.5, 3.7
FRONT = -0.4
rig.box('base', 2.4, 1.8, 0.22, beige_dk, (CX, 0.5, DESK), bevel=0.06)
rig.box('neck', 1.5, 1.4, 0.4, beige, (CX, 0.5, DESK + 0.2), bevel=0.05)
body_z = DESK + 0.62
rig.box('rear', W * 0.72, 2.4, H * 0.72, beige, (CX, 1.8, body_z + 0.3), bevel=0.2)
rig.box('mid', W * 0.88, 1.0, H * 0.9, beige, (CX, 0.6, body_z + 0.1), bevel=0.15)
rig.box('bezel', W, 0.9, H, beige, (CX, 0.0, body_z), bevel=0.2)
SZ = body_z + H / 2                    # the screen's center height
# vent slots on top of the rear shell
for i in range(7):
    rig.box('vent', 2.3, 0.05, 0.05, slot, (CX, 2.0 + 0.0, body_z + H * 0.72 + 0.28 - i * 0.0), bevel=0.005).location = (CX, 1.3 + i * 0.28, body_z + H * 0.72 + 0.32)
# the screen: a dark recess with a rim, then the glass
rig.slab('recess', rig.rrect(3.7, 2.95, 0.35, 8), FRONT - 0.03, FRONT + 0.2, rig.plastic('recess', rig.hexrgb('#9a8f74'), rough=0.5), 0.07).location = (CX, 0, SZ + 0.05)

m, n, l, b = rig.material('crt')
tc = n.new('ShaderNodeTexCoord'); sx = n.new('ShaderNodeSeparateXYZ')
wv = n.new('ShaderNodeTexWave'); wv.wave_type = 'BANDS'; wv.bands_direction = 'Z'; wv.inputs['Scale'].default_value = 5.0; wv.inputs['Distortion'].default_value = 0
rg = n.new('ShaderNodeValToRGB'); rg.color_ramp.elements[0].color = (0.45, 0.45, 0.45, 1); rg.color_ramp.elements[1].color = (1, 1, 1, 1)
l.new(tc.outputs['Generated'], wv.inputs['Vector']); l.new(wv.outputs['Color'], rg.inputs['Fac'])
base = rig.mix_color(n, l, 0.5, rig.hexrgb('#0b3a1c'), rig.hexrgb('#145a2c'))
em = n.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.1
mulc = n.new('ShaderNodeMix'); mulc.data_type = 'RGBA'; mulc.blend_type = 'MULTIPLY'; rig.sock(mulc.inputs, 'Factor_Float').default_value = 1.0
l.new(base, rig.sock(mulc.inputs, 'A_Color')); l.new(rg.outputs['Color'], rig.sock(mulc.inputs, 'B_Color')); l.new(rig.sock(mulc.outputs, 'Result_Color'), em.inputs['Color'])
l.new(em.outputs[0], n['Material Output'].inputs['Surface'])
glass = rig.slab('glass', rig.rrect(3.4, 2.7, 0.4, 8), FRONT - 0.08, FRONT + 0.0, m, 0.18); glass.location = (CX, 0, SZ + 0.05)

phos = rig.glow('phosphor', green, 2.2)
def line(s, y, size=0.27):
    t = rig.text(s, size, phos, (CX - 1.5, FRONT - 0.13, SZ + y), depth=0.01, bevel=0.002); t.data.align_x = 'LEFT'; return t
line('DIVIDED WORLD [v5.4]', 0.93, 0.2)
line('C:\\FORUM> DIR /W', 0.58, 0.24)
line('POST.TXT  REACTS.DAT', 0.28, 0.2)
line('C:\\FORUM> TYPE POST.T', -0.15, 0.27)
cur = rig.box('cursor', 0.2, 0.02, 0.34, phos, (CX - 1.5 + 3.12, FRONT - 0.13, SZ - 0.32), bevel=0.003)
# a faint green wash on the glass's near side, and the screen's light on the desk
gl = rig.glow('screenlight', green, 1.0, alpha=0.05)
#rig.slab('bloom', rig.rrect(3.9, 3.2, 0.5, 8), FRONT - 0.5, FRONT - 0.45, gl, 0.01).location = (CX, 0, SZ + 0.05)
# the monitor's chin: a power light, a floppy slot, two knobs
rig.ball((CX + 1.75, FRONT - 0.04, body_z + 0.38), 0.055, rig.glow('led', (0.4, 1, 0.5), 6), 'led', 12)
rig.box('badge', 0.9, 0.04, 0.12, beige_dk, (CX - 1.5, FRONT - 0.02, body_z + 0.3), bevel=0.01)
for kx in (CX + 1.1, CX + 1.4):
    rig.cone((kx, FRONT - 0.03, body_z + 0.38), (kx, FRONT - 0.13, body_z + 0.38), 0.07, 0.065, beige_dk, 16).rotation_euler = (math.radians(90), 0, 0)

# ---- the keyboard: a worn wedge in front of the monitor ---------------------------------------------
KY = -2.35
TILT = math.radians(7)
kb = []
kb.append(rig.box('deck', 4.7, 1.55, 0.2, beige, (0, KY, DESK), bevel=0.05))
ROWS = [(14, 0.0), (14, 0.0), (13, 0.12), (12, 0.22), (7, 0.0)]
pitch = 0.3
for r, (cnt, off) in enumerate(ROWS):
    z = DESK + 0.27 + r * 0.02
    y = KY + 0.52 - r * 0.24
    span = cnt * pitch
    for c in range(cnt):
        x = -span / 2 + off + c * pitch + pitch / 2
        w = 0.25
        if r == 4:                       # the space bar
            if c == 0:
                x, w = 0.0, 1.9
            elif c in range(1, 7): continue
        kind = rnd.random()
        mat = beige if kind < 0.55 else (yellowed if kind < 0.8 else worn)
        dip = 0.025 if rnd.random() < 0.08 else 0.0          # a pressed key
        rig.box('key', w, 0.2, 0.09 - dip, mat, (x, y, z - dip), bevel=0.02)
        if mat is worn:
            rig.box('legend', 0.06, 0.04, 0.012, legend, (x, y, z + 0.09 - dip), bevel=0.002)
        elif rnd.random() < 0.7:
            rig.box('legend', 0.07, 0.07, 0.012, legend, (x, y, z + 0.09 - dip), bevel=0.002)
# ---- lights -------------------------------------------------------------------------------------------
rig.area('key', (-5, -8, 6), 4.0, 1500, rgb=(1.0, 0.92, 0.85), look_at=(0, 0, 0.5))
rig.area('fill', (6, -8, 2), 4.0, 900, rgb=(1.0, 0.55, 0.75), look_at=(0, 0, 0), glossy=False)
rig.area('rim', (4, 6, 5), 4.0, 2200, rgb=(1.0, 0.35, 0.65), look_at=(0, 0, 0.5), glossy=False)
pl = bpy.data.lights.new('screenglow', 'POINT'); pl.energy = 120; pl.color = (0.4, 1.0, 0.55); pl.shadow_soft_size = 0.4
po = bpy.data.objects.new('screenglow', pl); sc.collection.objects.link(po); po.location = (CX, FRONT - 0.7, SZ - 0.2)
rig.camera(60, elev=22, target=(0, 0, 0.3))
rig.render(OUT)
