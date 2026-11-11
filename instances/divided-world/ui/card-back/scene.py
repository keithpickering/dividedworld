"""Divided World's card back: its coin, raised and glowing, in smoke. The look is the stylesheet back's
(engine/ui/cards/postcard.css), made as a scene like the cards' own. From this folder,

    python scene.py art.webp

with the cards' rig (../cards/rig.py), as the cards' README says."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'cards'))   # the rig the card scenes share
sys.dont_write_bytecode = True
import bpy
from mathutils import Vector
import rig

OUT = sys.argv[-1]
sc = rig.reset()
# the glass's colors along the back's diagonal, as its stylesheet mixes them: violet, neon, violet, salty
TINT = [(0.0, '#7a5cf0'), (0.45, '#2ee6ff'), (0.72, '#7a5cf0'), (1.0, '#ff3d8a')]
GLOW = '#2ee6ff'
C = Vector((0.0, 0.0, 0.0))              # the coin sits at the card's middle, as the emblem does

# ---- the smoke: a deep slab of it behind the coin, its own light in the back's colors, dark where it thins ----------
bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 3.4, 0)); fog = bpy.context.object; fog.scale = (6, 1.3, 8)
m = bpy.data.materials.new('smoke'); m.use_nodes = True; n, l = m.node_tree.nodes, m.node_tree.links
def mth(op, a, b2=None, clamp=False):
    nd = n.new('ShaderNodeMath'); nd.operation = op; nd.use_clamp = clamp
    for k, v in enumerate((a, b2)):
        if v is None: continue
        if hasattr(v, 'is_linked'): l.new(v, nd.inputs[k])
        else: nd.inputs[k].default_value = v
    return nd.outputs[0]
tc = n.new('ShaderNodeTexCoord')
def cloud(scale, lo, hi, seed):
    """Smoke at one size: noise, cut so that under lo there is none and over hi it is thick."""
    mp = n.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (6 * 0.3, 1.3 * 0.3, 8 * 0.3); mp.inputs['Location'].default_value = (seed, seed * 0.7, 0)   # the box's own proportions, so the smoke is not stretched
    nz = n.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = scale; nz.inputs['Detail'].default_value = 5.0
    nz.inputs['Roughness'].default_value = 0.6; nz.inputs['Distortion'].default_value = 0.5
    l.new(tc.outputs['Object'], mp.inputs['Vector']); l.new(mp.outputs['Vector'], nz.inputs['Vector'])
    return mth('DIVIDE', mth('SUBTRACT', nz.outputs['Fac'], lo), hi - lo, clamp=True)
thick = mth('MAXIMUM', cloud(0.62, 0.5, 0.64, 3.0), mth('MULTIPLY', cloud(1.25, 0.55, 0.68, 11.0), 0.75))   # two sizes of smoke, as the flat back has
# the tint runs corner to corner, as the stylesheet's 160-degree gradient does: first color, second, first again, third
sx = n.new('ShaderNodeSeparateXYZ'); l.new(tc.outputs['Object'], sx.inputs[0])
across = mth('ADD', mth('MULTIPLY', mth('SUBTRACT', mth('MULTIPLY', sx.outputs['X'], 0.34), mth('MULTIPLY', sx.outputs['Z'], 0.94)), 0.5), 0.5, clamp=True)
tint = n.new('ShaderNodeValToRGB'); tr = tint.color_ramp
tr.elements[0].position = 0.0; tr.elements[0].color = (*rig.hexrgb(TINT[0][1]), 1)
tr.elements[1].position = 1.0; tr.elements[1].color = (*rig.hexrgb(TINT[-1][1]), 1)
for pos, hx in TINT[1:-1]:
    e = tr.elements.new(pos); e.color = (*rig.hexrgb(hx), 1)
l.new(across, tint.inputs['Fac'])
vol = n.new('ShaderNodeVolumePrincipled'); vol.inputs['Color'].default_value = (0, 0, 0, 1)
l.new(mth('MULTIPLY', thick, 0.5), vol.inputs['Density'])
l.new(tint.outputs['Color'], vol.inputs['Emission Color']); l.new(mth('MULTIPLY', mth('POWER', thick, 1.8), 0.85), vol.inputs['Emission Strength'])
out = n['Material Output']
for lk in list(out.inputs['Surface'].links): l.remove(lk)
l.new(vol.outputs[0], out.inputs['Volume']); fog.data.materials.append(m)
bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 9.5, 0), rotation=(math.radians(90), 0, 0))
bd = bpy.context.object; bd.scale = (30, 30, 1); bd.data.materials.append(rig.plastic('field', rig.hexrgb('#07050d'), rough=0.9))

# ---- the coin: the board above, the glass below, and the seam between them the bar of a division sign ------
R = 1.65; TH = 0.32
rim = rig.plastic('rim', rig.hexrgb('#07050d'), rough=0.15, coat=1.0)
white = rig.plastic('board', (0.95, 0.95, 0.97), rough=0.12, coat=1.0)
vm, vn, vl, vb = rig.material('glass')                           # the glass half: dark at the seam, bright violet at the foot, as the coin's own drawing
vt = vn.new('ShaderNodeTexCoord'); vs = vn.new('ShaderNodeSeparateXYZ'); vr = vn.new('ShaderNodeMapRange'); vc = vn.new('ShaderNodeValToRGB')
vr.inputs['From Min'].default_value = -1.65; vr.inputs['From Max'].default_value = -0.1
vc.color_ramp.elements[0].color = (*rig.hexrgb('#8c24fa'), 1); vc.color_ramp.elements[1].color = (*rig.hexrgb('#2a0f55'), 1)
e_ = vc.color_ramp.elements.new(0.4); e_.color = (*rig.hexrgb('#4a189a'), 1)
vl.new(vt.outputs['Object'], vs.inputs[0]); vl.new(vs.outputs['Z'], vr.inputs['Value']); vl.new(vr.outputs['Result'], vc.inputs['Fac'])
vl.new(vc.outputs['Color'], vb.inputs['Base Color']); vl.new(vc.outputs['Color'], vb.inputs['Emission Color']); vb.inputs['Emission Strength'].default_value = 0.35
vb.inputs['Roughness'].default_value = 0.1; vb.inputs['Coat Weight'].default_value = 1.0
violet = vm
seam = rig.glow('seam', rig.hexrgb('#19e3ff'), 3.0)
pale = rig.plastic('pale', rig.hexrgb('#f1ecff'), rough=0.1, coat=1.0, emit=0.2)
half = lambda sgn: [(math.cos(a) * R * 0.93, sgn * (0.09 + math.sin(a) * R * 0.93)) for a in (math.pi * j / 48 for j in range(49))]
coin = [rig.cone((0, TH / 2, 0), (0, -TH / 2, 0), R, R, rim, 96),
        rig.slab('board', half(1), -TH / 2 - 0.05, -TH / 2 + 0.02, white, 0.02),
        rig.slab('glass', half(-1), -TH / 2 - 0.05, -TH / 2 + 0.02, violet, 0.02),
        rig.slab('seam', rig.rrect(R * 1.86, 0.1, 0.01), -TH / 2 - 0.07, -TH / 2, seam, 0.006),
        rig.slab('seam-light', rig.rrect(R * 1.86, 0.1, 0.01), -TH / 2 - 0.07, -TH / 2, rig.glow('seam-light', rig.hexrgb('#c9f8ff'), 2.0), 0.006),   # moved up a row below
        rig.ball((0, -TH / 2 - 0.05, R * 0.5), 0.36, rim, 'dot', 48, scale=(1, 0.3, 1)),
        rig.ball((0, -TH / 2 - 0.05, -R * 0.5), 0.36, pale, 'dot', 48, scale=(1, 0.3, 1)),
        rig.tube('edge', [(math.cos(a) * R, 0, math.sin(a) * R) for a in (math.tau * j / 128 for j in range(129))], 0.09, rim, res=6)]
coin[3].location = (0, 0, -0.05); coin[4].location = (0, 0, 0.05)   # the seam's two rows: cyan below, pale above
rig.group(coin, loc=C + Vector((0, -0.6, 0)), rot=(-8, 0, 15))         # turned a little about the upright and tipped back, so its edge shows
def light_only(name, rgb, strength):
    """Light added to whatever is behind it, hiding nothing: a glow."""
    gm = bpy.data.materials.new(name); gm.use_nodes = True; gn, gl = gm.node_tree.nodes, gm.node_tree.links
    em = gn.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (*rgb, 1); em.inputs['Strength'].default_value = strength
    tr = gn.new('ShaderNodeBsdfTransparent'); add = gn.new('ShaderNodeAddShader')
    gl.new(tr.outputs[0], add.inputs[0]); gl.new(em.outputs[0], add.inputs[1]); gl.new(add.outputs[0], gn['Material Output'].inputs['Surface'])
    return gm
sc.cycles.transparent_max_bounces = 64                            # a ray crosses every sheet of the glow; the default stops it after eight, and what is behind goes black
for k in range(18):                                               # its glow: thin sheets of light behind it, each wider and fainter
    r = R + 0.05 + 0.075 * k
    bpy.ops.mesh.primitive_circle_add(radius=r, vertices=96, fill_type='NGON', location=C + Vector((0, 0.2 + 0.03 * k, 0)), rotation=(math.radians(90), 0, 0))
    bpy.context.object.data.materials.append(light_only('halo', rig.hexrgb(GLOW), 0.13 * (1 - k / 18) ** 1.6))
rig.area('key', (-5, -9, 6), 6.0, 1700, look_at=tuple(C))
rig.world((0.01, 0.008, 0.02), 0.5)
rig.camera(60)
rig.render(OUT)
