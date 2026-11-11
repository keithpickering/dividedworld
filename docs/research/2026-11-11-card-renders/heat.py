"""Heat Magnet card art exploration (the owner's idea): a big horseshoe magnet, on fire, in the dark."""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, bmesh
from mathutils import Vector
import rig

OUT = sys.argv[-1]
rnd = random.Random(int(os.environ.get('HEAT_SEED', '6')))
sc = rig.reset()
rig.backdrop(16, [(0.0, '#0a0206'), (0.4, '#2a0612'), (1.0, '#050103')])
G = -3.3
rig.floor(G, rig.checker('floor', '#12040a', '#240814', 30, rough=0.08))
C = Vector((0, 0, 0.6))

# ---- the magnet: a red horseshoe, poles up, steel at its tips -----------------------------------
red = rig.plastic('magnet', rig.hexrgb('#e8102a'), rough=0.1, coat=1.0)
steel = rig.plastic('pole', (0.82, 0.84, 0.9), rough=0.12, coat=1.0)
RB, TH, LEG = 1.05, 0.44, 1.5            # the bend's radius, the bar's half thickness, a leg's length
def shoe(r_in, r_out):
    out = [(-r_out, LEG * 0.55), (-r_out, 0)]
    out += [(math.cos(a) * r_out, math.sin(a) * r_out) for a in (math.pi + math.pi * j / 40 for j in range(1, 40))]
    out += [(r_out, 0), (r_out, LEG * 0.55), (r_in, LEG * 0.55), (r_in, 0)]
    out += [(math.cos(a) * r_in, math.sin(a) * r_in) for a in (math.tau - math.pi * j / 40 for j in range(1, 40))]
    out += [(-r_in, 0), (-r_in, LEG * 0.55)]
    return out
mag = [rig.slab('shoe', shoe(RB - TH, RB + TH), -0.42, 0.42, red, 0.06)]
for sx in (-1, 1):
    o = rig.slab('pole', rig.rrect(TH * 2, LEG * 0.5, 0.02), -0.42, 0.42, steel, 0.06); o.location = (sx * RB, 0, LEG * 0.8)
    mag.append(o)
tilt = (-10, -24, 14)
rig.group(mag, loc=C + Vector((0, 0, -0.3)), rot=tilt, scale=1.25)

# ---- the fire: tongues of it, each three skins deep, hottest inside ------------------------------
def flame_skin(name, foot, tip, strength):
    """Fire's own light, graded from its foot color to its tip color up the tongue, and held under white so it keeps its color."""
    m, n, l, b = rig.material(name)
    tc = n.new('ShaderNodeTexCoord'); sx = n.new('ShaderNodeSeparateXYZ'); ramp = n.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*rig.hexrgb(foot), 1); ramp.color_ramp.elements[1].color = (*rig.hexrgb(tip), 1)
    l.new(tc.outputs['Generated'], sx.inputs[0]); l.new(sx.outputs['Z'], ramp.inputs['Fac'])
    em = n.new('ShaderNodeEmission'); l.new(ramp.outputs['Color'], em.inputs['Color']); em.inputs['Strength'].default_value = strength
    l.new(em.outputs[0], n['Material Output'].inputs['Surface'])
    return m
DIM = float(os.environ.get('HEAT_FIRE', '1.0'))                  # the fire's brightness: 1 is as committed
SKINS = [(flame_skin('fire-out', '#e81c3a', '#5a0618', 0.7 * DIM), 1.0), (flame_skin('fire-mid', '#ff7a14', '#c82a14', 0.85 * DIM), 0.66), (flame_skin('fire-in', '#ffd84a', '#ff8a1c', 0.95 * DIM), 0.36)]
def tongue(base, height, radius, sway, phase, depth=0.0):
    """A flame: a flat teardrop on a wavering spine, drawn three times over, each smaller, hotter and nearer."""
    for i, (mat, k) in enumerate(SKINS):
        bm = bmesh.new(); rings = []; n = 28
        for j in range(n + 1):
            t = j / n
            r = radius * k * (math.sin(math.pi * min(1, t * 1.9 + 0.12)) ** 0.9 if t < 0.46 else (1 - t) ** 0.75 * 1.52)
            c = Vector(base) + Vector((math.sin(t * 4 + phase) * sway * t, depth - 0.22 * i, height * t * (1 - 0.14 * i)))
            rings.append([bm.verts.new(c + Vector((math.cos(a) * r, math.sin(a) * r * 0.16, 0))) for a in (math.tau * q / 20 for q in range(20))])
        for a, b in zip(rings, rings[1:]):
            for q in range(20): bm.faces.new((a[q], a[(q + 1) % 20], b[(q + 1) % 20], b[q]))
        me = bpy.data.meshes.new('tongue'); bm.to_mesh(me); bm.free()
        for f in me.polygons: f.use_smooth = True
        o = bpy.data.objects.new('tongue', me); sc.collection.objects.link(o); me.materials.append(mat)
STYLE = os.environ.get('HEAT_STYLE', 'tongues')                   # 'tongues': flat cartoon fire; 'volume': soft fire with depth

def volume_fire():
    """One material for every column of soft fire: a noise-shaken cone of light inside a box, read in the box's own
    coordinates (-1 to 1 each way), so a box of any size holds one flame. No simulation: the shape is a formula."""
    m = bpy.data.materials.new('volume-fire'); m.use_nodes = True; n, l = m.node_tree.nodes, m.node_tree.links
    def mth(op, a, b2=None, clamp=False):
        nd = n.new('ShaderNodeMath'); nd.operation = op; nd.use_clamp = clamp
        for k, v in enumerate((a, b2)):
            if v is None: continue
            if hasattr(v, 'is_linked'): l.new(v, nd.inputs[k])
            else: nd.inputs[k].default_value = v
        return nd.outputs[0]
    tc = n.new('ShaderNodeTexCoord'); sx = n.new('ShaderNodeSeparateXYZ'); l.new(tc.outputs['Object'], sx.inputs[0])
    x, y, z = sx.outputs['X'], sx.outputs['Y'], sx.outputs['Z']
    h = mth('MULTIPLY', mth('ADD', z, 1.0), 0.5)                          # 0 at the foot, 1 at the top
    info = n.new('ShaderNodeObjectInfo'); mp = n.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.6, 1.6, 2.6)
    comb = n.new('ShaderNodeCombineXYZ'); l.new(mth('MULTIPLY', info.outputs['Random'], 50.0), comb.inputs['X'])
    l.new(tc.outputs['Object'], mp.inputs['Vector']); l.new(comb.outputs[0], mp.inputs['Location'])
    noise = n.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 1.7; noise.inputs['Detail'].default_value = 4.0
    noise.inputs['Distortion'].default_value = 0.8; l.new(mp.outputs['Vector'], noise.inputs['Vector'])
    shake = mth('MULTIPLY', mth('SUBTRACT', noise.outputs['Fac'], 0.5), mth('ADD', 0.35, mth('MULTIPLY', h, 1.5)))   # wilder higher up
    r = mth('ADD', mth('SQRT', mth('ADD', mth('MULTIPLY', x, x), mth('MULTIPLY', y, y))), shake)
    width = mth('MULTIPLY', mth('POWER', mth('SUBTRACT', 1.0, h, clamp=True), 0.65), mth('ADD', 0.72, mth('MULTIPLY', mth('MULTIPLY', h, 5.0, clamp=True), 0.12)))
    heat = mth('SUBTRACT', 1.0, mth('DIVIDE', r, mth('MAXIMUM', width, 0.001)), clamp=True)   # 1 at the core, 0 at the edge
    ramp = n.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
    cr.elements[0].position = 0.0; cr.elements[0].color = (*rig.hexrgb('#3a0410'), 1)
    cr.elements[1].position = 1.0; cr.elements[1].color = (*rig.hexrgb('#fff0a0'), 1)
    for pos, hx in ((0.25, '#c8142a'), (0.5, '#ff5a14'), (0.78, '#ffc23a')):
        e = cr.elements.new(pos); e.color = (*rig.hexrgb(hx), 1)
    l.new(heat, ramp.inputs['Fac'])
    vol = n.new('ShaderNodeVolumePrincipled'); vol.inputs['Color'].default_value = (0.02, 0.005, 0.005, 1)
    l.new(mth('MULTIPLY', heat, 0.6), vol.inputs['Density'])
    l.new(ramp.outputs['Color'], vol.inputs['Emission Color'])
    l.new(mth('MULTIPLY', mth('POWER', heat, 1.6), 5.0 * DIM), vol.inputs['Emission Strength'])
    out = n['Material Output']
    for lk in list(out.inputs['Surface'].links): l.remove(lk)
    l.new(vol.outputs[0], out.inputs['Volume'])
    return m

if STYLE == 'volume':
    vf = volume_fire()
    COLUMNS = [(-1.9, 1.3, G, 5.4, 1.5), (-0.7, 1.6, G, 7.0, 1.8), (0.6, 1.6, G, 6.4, 1.7), (1.8, 1.3, G, 5.0, 1.4), (-2.8, 1.0, G, 3.6, 1.1),
               (2.8, 1.0, G, 3.8, 1.1), (0.0, 2.0, G, 7.6, 1.5), (-1.6, -1.0, G, 2.3, 1.0), (-0.3, -1.1, G, 2.8, 1.1), (1.0, -1.0, G, 2.4, 1.0), (2.2, -0.9, G, 1.8, 0.8), (-2.7, -0.8, G, 1.7, 0.8)]
    for x, y, z, h, r in COLUMNS:                                 # a box each: foot at (x, y, z), h tall, r wide either way
        bpy.ops.mesh.primitive_cube_add(size=2, location=(x, y, z + h / 2)); o = bpy.context.object; o.scale = (r, r, h / 2); o.data.materials.append(vf)
else:
    for x, y, z, h, r in ((-1.9, 1.2, -1.9, 3.9, 0.8), (-0.7, 1.4, -2.1, 5.0, 1.0), (0.6, 1.4, -2.2, 4.5, 0.95), (1.8, 1.2, -1.8, 3.5, 0.75),
                          (-2.6, 1.0, -2.2, 2.4, 0.55), (2.6, 1.0, -2.3, 2.5, 0.55), (0.0, 1.6, -1.6, 5.6, 0.8)):
        tongue((x, y, z), h, r, rnd.uniform(0.25, 0.5), rnd.uniform(0, 6))
    for x, z, h, r in ((-1.5, -2.5, 1.5, 0.4), (-0.3, -2.7, 1.9, 0.5), (1.0, -2.6, 1.6, 0.42), (2.0, -2.5, 1.1, 0.3), (-2.3, -2.6, 1.0, 0.3)):   # licking up in front
        tongue((x, -0.9, z), h, r, rnd.uniform(0.15, 0.3), rnd.uniform(0, 6))
ember = rig.glow('ember', rig.hexrgb('#ffb04a'), 2.0)
for i in range(40):
    rig.ball((rnd.uniform(-2.6, 2.6), rnd.uniform(-1, 2), rnd.uniform(-1, 4.1)), rnd.uniform(0.015, 0.045), ember, 'ember', 8)
# the pull: arcs of it leaping from pole to pole
arc = rig.glow('arc', rig.hexrgb('#ff9ac4'), 1.6)
from mathutils import Euler
M = Euler(tuple(math.radians(a) for a in tilt), 'XYZ').to_matrix()
tip = lambda sx: C + Vector((0, 0, -0.3)) + M @ (Vector((sx * RB, -0.1, LEG * 1.05)) * 1.25)
for k in range(3):
    a, b = tip(-1), tip(1); up = (M @ Vector((0, 0, 1))) * (0.5 + 0.45 * k)
    rig.tube('arc', [a + (b - a) * t + up * math.sin(math.pi * t) for t in (j / 30 for j in range(31))], 0.022, arc, res=3)

fl = bpy.data.lights.new('fire', 'POINT'); fl.energy = 1500; fl.color = (1.0, 0.45, 0.15); fl.shadow_soft_size = 1.5
fo = bpy.data.objects.new('fire', fl); sc.collection.objects.link(fo); fo.location = (0, 1.8, 1.0)
fl2 = bpy.data.lights.new('fire-front', 'POINT'); fl2.energy = 350; fl2.color = (1.0, 0.5, 0.2); fl2.shadow_soft_size = 1.0
fo2 = bpy.data.objects.new('fire-front', fl2); sc.collection.objects.link(fo2); fo2.location = (0, -2.2, -2.2)
rig.area('key', (-6, -9, 6), 4.0, 2000, look_at=tuple(C))
rig.area('window', (4, -8, 3), 1.2, 800, look_at=tuple(C), size_y=6.0)
rig.world((0.06, 0.01, 0.03), 0.6)
rig.camera(60, elev=4)
rig.render(OUT)
