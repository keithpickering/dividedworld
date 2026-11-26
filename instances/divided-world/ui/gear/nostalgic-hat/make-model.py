"""Builds the Nostalgic Hat's model.blend: a felt top hat with a sprig of mistletoe (holly-leaved, red-berried, as the
sprite draws it) tucked in its band. Front toward +X, an empty named `pivot` on the crown's axis at the brim's height.

    blender -b --factory-startup -P make-model.py -- model.blend        (run from this folder)
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
N = 128                    # segments round the hat
SX, SY = 1.07, 0.95        # a head is longer front to back: the hat is an oval

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def material(name, stops, rough, sheen=0.0, coat=0.0, scale=60.0, detail=8.0):
    """Principled BSDF whose base color is a Noise Texture through a Color Ramp, as the caps' materials are."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Sheen Weight'].default_value = sheen
    bsdf.inputs['Coat Weight'].default_value = coat
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = detail
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = stops[0][0], (*stops[0][1], 1)
    els[1].position, els[1].color = stops[-1][0], (*stops[-1][1], 1)
    for pos, col in stops[1:-1]:
        e = els.new(pos)
        e.color = (*col, 1)
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return m


FELT = material('felt', [(0.30, (0.010, 0.010, 0.011)), (0.55, (0.030, 0.030, 0.032)), (0.80, (0.060, 0.060, 0.064))],
                rough=0.78, sheen=0.35, scale=180.0)
SATIN = material('satin', [(0.35, (0.008, 0.008, 0.009)), (0.70, (0.022, 0.022, 0.024))], rough=0.32, scale=40.0)
LEAF = material('leaf', [(0.30, (0.010, 0.085, 0.020)), (0.75, (0.040, 0.200, 0.050))], rough=0.38, coat=0.3, scale=25.0)
BERRY = material('berry', [(0.30, (0.330, 0.004, 0.008)), (0.75, (0.600, 0.015, 0.020))], rough=0.18, coat=0.6, scale=12.0)


def obj(name, bm, mat, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    me.materials.append(mat)
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    return o


def lathe(profile, deform=None, closed=False):
    """Revolve a list of (r, z) round the Z axis into an oval; deform(theta, r, z) -> dz lifts a point."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for i in range(N):
            t = 2 * math.pi * i / N
            dz = deform(t, r, z) if deform else 0.0
            ring.append(bm.verts.new((r * SX * math.cos(t), r * SY * math.sin(t), z + dz)))
        rings.append(ring)
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for a, b in pairs:
        for i in range(N):
            j = (i + 1) % N
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def arc(cx, cz, rad, a0, a1, n):
    return [(cx + rad * math.cos(math.radians(a0 + (a1 - a0) * k / n)), cz + rad * math.sin(math.radians(a0 + (a1 - a0) * k / n)))
            for k in range(n + 1)]


# --- the crown: a gentle waist, a slight flare to the top, a rounded top edge, a flat top -------------------------------
H, R0 = 0.96, 0.50


def crown_r(z):
    u = z / H
    return R0 + 0.07 * u * u - 0.018 * math.sin(math.pi * u)


EDGE = 0.045
prof = [(0.0, 0.0)] + [(crown_r(H * k / 40) - 0.0, H * k / 40) for k in range(0, 39)]
rt = crown_r(H - EDGE)
prof += arc(rt - EDGE, H - EDGE, EDGE, 0, 90, 8)[1:]
prof += [(rt - EDGE - (rt - EDGE) * k / 12, H + 0.006 * math.sin(math.pi * k / 24)) for k in range(1, 12)]
prof += [(0.0, H + 0.006)]
crown_bm = lathe(prof)
bmesh.ops.remove_doubles(crown_bm, verts=crown_bm.verts, dist=1e-5)
crown = obj('hat', crown_bm, FELT)

# --- the brim: an oval annulus with a rolled edge, curled up at the sides ------------------------------------------------
RI, RO, T = 0.47, 0.88, 0.035
CURL = 0.10


def curl(t, r, z):
    s = max(0.0, (r - (R0 - 0.02)) / (RO - R0))
    return CURL * (math.sin(t) ** 2) * s * s


bp = [(RI, 0.0), (RO - T, 0.0)]
bp += arc(RO - T, T, T, -90, 90, 12)[1:]
bp += [(RO - 0.12, 2 * T - 0.005), (R0 + 0.02, 0.030), (RI, 0.030)]
brim = obj('brim', lathe(bp, deform=curl, closed=True), FELT)

# --- the band: a satin ribbon round the crown's foot -----------------------------------------------------------------
BH = 0.20
band_prof = [(crown_r(0.005) + 0.004, 0.005)] + [(crown_r(z) + 0.012, z) for z in (0.02, 0.06, 0.10, 0.14, 0.18)] + \
            [(crown_r(BH) + 0.004, BH), (crown_r(BH) - 0.004, BH), (crown_r(0.005) - 0.004, 0.005)]
band = obj('band', lathe(band_prof, closed=True), SATIN)

# --- the sprig: three spiky leaves and three berries, tucked in the band on the wearer's left --------------------------
PHI = math.radians(68)
here = Vector((crown_r(0.1) * SX * math.cos(PHI), crown_r(0.1) * SY * math.sin(PHI), 0.15))
n = Vector((math.cos(PHI) / SX, math.sin(PHI) / SY, 0)).normalized()   # the oval's outward normal
tng = Vector((0, 0, 1)).cross(n).normalized()                          # along the band, toward the back
up = Vector((0, 0, 1))


def leaf(length, width, spikes=3, fold=0.22):
    """A holly leaf along +Y from the origin, in the XY plane, folded up along its midrib by `fold` radians: a smooth
    outline whose edge dips between `spikes` points a side and ends in a point."""
    bm = bmesh.new()
    steps = 48
    left, right, mid = [], [], []
    for k in range(steps + 1):
        u = k / steps
        w = width * math.sin(math.pi * min(u, 0.999)) ** 0.75
        w *= 1.0 - 0.30 * abs(math.sin(math.pi * (spikes + 0.5) * u)) ** 1.5
        y = length * u
        lift = w * math.sin(fold)
        left.append(bm.verts.new((-w * math.cos(fold), y, lift)))
        right.append(bm.verts.new((w * math.cos(fold), y, lift)))
        mid.append(bm.verts.new((0, y, 0)))
    for k in range(steps):
        bm.faces.new((mid[k], mid[k + 1], left[k + 1], left[k]))
        bm.faces.new((mid[k], right[k], right[k + 1], mid[k + 1]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    for v in bm.verts:   # a gentle arch along its length
        v.co.z += 0.12 * length * math.sin(math.pi * v.co.y / length)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


leaves = bmesh.new()
for ang, length, tilt in ((-62, 0.34, 0.55), (-12, 0.40, 0.45), (34, 0.33, 0.60)):
    a = math.radians(ang)
    d = (math.cos(a) * up + math.sin(a) * tng).normalized()       # the leaf's direction, in the band's plane
    # the leaf's own frame: x across it, y along it, z its face; tip it outward from the crown by `tilt`
    y_ax = (d * math.cos(tilt * 0.5) + n * math.sin(tilt * 0.5)).normalized()
    z_ax = n - y_ax * n.dot(y_ax)
    z_ax.normalize()
    x_ax = y_ax.cross(z_ax)
    m = Matrix((x_ax, y_ax, z_ax)).transposed().to_4x4()
    m.translation = here + n * 0.03
    lb = leaf(length, 0.095)
    lb.transform(m)
    tmp = bpy.data.meshes.new('tmp')
    lb.to_mesh(tmp)
    lb.free()
    leaves.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)
lv = obj('leaves', leaves, LEAF)
sol = lv.modifiers.new('thick', 'SOLIDIFY')
sol.thickness, sol.offset = 0.012, 0.0

berries = bmesh.new()
for du, dt, rad in ((0.04, -0.04, 0.066), (-0.02, 0.07, 0.062), (-0.045, -0.075, 0.060)):
    c = here + n * 0.085 + up * du + tng * dt
    bmesh.ops.create_uvsphere(berries, u_segments=32, v_segments=16, radius=rad,
                              matrix=Matrix.Translation(c))
bv = obj('berries', berries, BERRY)

for o in (crown, brim, band, lv, bv):
    sub = o.modifiers.new('smooth', 'SUBSURF')
    sub.levels = sub.render_levels = 1 if o is not lv else 0

# the pivot: on the crown's axis, at the height the hat sits on a head (the brim's top face at the crown)
pivot = bpy.data.objects.new('pivot', None)
pivot.location = (0, 0, 0.03)
sc.collection.objects.link(pivot)

bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('SAVED', OUT)
