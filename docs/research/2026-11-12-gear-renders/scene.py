"""Spike: four pieces of Minus World Gear as renders. Each is seen straight on by an orthographic camera, on a
transparent ground, since Gear is laid over a portrait.

    python scene.py glasses glasses.png        (also: cigar, mustache-a, mustache-b)

It uses the cards' rig, and needs scipy and shapely beside Blender's Python module."""
import sys, os, math
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'instances', 'divided-world', 'ui', 'cards'))   # the cards' rig
sys.dont_write_bytecode = True
import bpy
import numpy as np
from mathutils import noise
import rig

ITEM, OUT = sys.argv[-2], sys.argv[-1]
PX = int(os.environ.get('GEAR_PX', '1024'))          # the picture's width
rig.SAMPLES = int(os.environ.get('ART_SAMPLES', '96'))
sc = rig.reset()
sc.render.film_transparent = True


def frame(width, height, center=(0, 0)):
    """The camera: the width by height rectangle about `center`, straight on."""
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = width
    o = bpy.data.objects.new('cam', cam); sc.collection.objects.link(o); sc.camera = o
    o.location = (center[0], -20, center[1]); o.rotation_euler = (math.radians(90), 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = PX, round(PX * height / width)


def lights(key=2600, fill=900, room=0.45):
    rig.world((0.55, 0.58, 0.7), room)
    rig.area('key', (-6, -10, 8), 10.0, key, look_at=(0, 0, 0))
    rig.area('fill', (8, -8, -4), 12.0, fill, rgb=(0.8, 0.88, 1.0), look_at=(0, 0, 0))


# ---- a puffed shape: tubes of changing width laid flat, their fronts raised toward the camera -----------------------
def spine(pts, n=420):
    """Points (x, z, radius) along a tube's middle, made smooth and resampled."""
    p = np.array(pts, float)
    t = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p[:, :2], axis=0).T))])
    s = np.linspace(0, t[-1], n)
    if len(p) < 3:
        q = np.stack([np.interp(s, t, p[:, k]) for k in range(3)], 1)
    else:
        from scipy.interpolate import PchipInterpolator, CubicSpline
        q = np.stack([CubicSpline(t, p[:, 0])(s), CubicSpline(t, p[:, 1])(s), PchipInterpolator(t, p[:, 2])(s)], 1)
    q[:, 2] = np.maximum(q[:, 2], 0.01)
    return q


def puff(name, parts, half_w, z0, z1, mat, cells=1100, mirror=True):
    """A height field over x in -half_w..half_w, z in z0..z1. Each part is a tube: its spine, how far its front
    rises (as a share of its radius), a base to stand on, and how many strands run along it."""
    nx = cells; nz = round(cells * (z1 - z0) / (2 * half_w))
    X, Z = np.meshgrid(np.linspace(-half_w, half_w, nx + 1), np.linspace(z0, z1, nz + 1))
    P = np.stack([np.abs(X).ravel() if mirror else X.ravel(), Z.ravel()], 1)
    H = np.zeros(len(P)); inside = np.zeros(len(P), bool)
    for pts, lift, base, strands in parts:
        q = spine(pts); tan = np.gradient(q[:, :2], axis=0)
        for a in range(0, len(P), 40000):
            p = P[a:a + 40000]
            d = p[:, None, :] - q[None, :, :2]
            r = np.hypot(d[..., 0], d[..., 1]) / q[None, :, 2]
            i = r.argmin(1); k = np.arange(len(p)); rm = r[k, i]
            side = np.sign(tan[i, 0] * d[k, i, 1] - tan[i, 1] * d[k, i, 0])
            h = base + lift * q[i, 2] * np.sqrt(np.clip(1 - rm ** 2, 0, 1)) * (1 - 0.09 * (0.5 - 0.5 * np.cos(math.tau * strands * rm * side)))
            hit = rm < 1
            H[a:a + 40000] = np.where(hit & (h > H[a:a + 40000]), h, H[a:a + 40000]); inside[a:a + 40000] |= hit
    H = H.reshape(X.shape); inside = inside.reshape(X.shape)
    keep = inside[:-1, :-1] | inside[1:, :-1] | inside[:-1, 1:] | inside[1:, 1:]
    idx = np.arange(X.size).reshape(X.shape)
    faces = np.stack([idx[:-1, :-1][keep], idx[:-1, 1:][keep], idx[1:, 1:][keep], idx[1:, :-1][keep]], 1)
    used = np.unique(faces); remap = np.zeros(X.size, np.int64); remap[used] = np.arange(len(used))
    verts = np.stack([X.ravel(), -H.ravel(), Z.ravel()], 1)[used]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts)); me.vertices.foreach_set('co', verts.astype(np.float32).ravel())
    me.loops.add(faces.size); me.loops.foreach_set('vertex_index', remap[faces].astype(np.int32).ravel())
    me.polygons.add(len(faces)); me.polygons.foreach_set('loop_start', np.arange(0, faces.size, 4, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(len(faces), 4, np.int32))
    me.update(); me.validate()
    me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); me.materials.append(mat)
    return o


def hair(name, hx):
    m, n, l, b = rig.material(name)
    b.inputs['Base Color'].default_value = (*rig.hexrgb(hx), 1); b.inputs['Roughness'].default_value = 0.38
    b.inputs['Coat Weight'].default_value = 0.35; b.inputs['Coat Roughness'].default_value = 0.2
    return m


def mustache_a():
    """The handlebar: two heavy lobes that sweep out and curl up to a point."""
    half = [(0.2, -0.05, 0.62), (1.3, -0.5, 1.05), (2.5, -0.8, 1.3), (3.5, -0.45, 1.1), (4.15, 0.4, 0.62), (4.45, 1.2, 0.25), (4.55, 1.75, 0.02)]
    puff('mustache', [(half, 0.75, 0.0, 2.5)], 5.0, -2.4, 2.1, hair('hair', '#463d34'))
    frame(10.0, 4.5, (0, -0.15)); lights()


def mustache_b():
    """The scalloped one: a band with upturned tips over three tufts a side."""
    band = [(0.2, 0.15, 0.6), (1.5, 0.25, 0.62), (2.8, 0.2, 0.55), (3.7, 0.45, 0.42), (4.3, 0.95, 0.25), (4.6, 1.5, 0.03)]
    tufts = [[(0.75, -0.75, 0.85), (1.0, -0.8, 0.85)], [(2.1, -0.55, 0.72), (2.3, -0.5, 0.7)], [(3.2, -0.2, 0.5), (3.35, -0.1, 0.48)]]
    puff('mustache', [(band, 0.8, 0.3, 2)] + [(t, 0.7, 0.0, 1) for t in tufts], 5.0, -1.9, 1.8, hair('hair', '#463d34'))
    frame(10.0, 3.7, (0, -0.05)); lights()


# ---- the glasses ---------------------------------------------------------------------------------------------------
def flat(name, poly, depth, bevel, mat, y=0.0):
    """A shapely polygon (holes and all) as a plate facing the camera, `depth` thick each way, its edges rounded."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '2D'; cu.fill_mode = 'BOTH'
    cu.extrude = depth; cu.bevel_depth = bevel; cu.bevel_resolution = 5
    for ring in [poly.exterior, *poly.interiors]:
        pts = list(ring.coords)[:-1]
        sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1); sp.use_cyclic_u = True
        for p, q in zip(sp.points, pts): p.co = (q[0], q[1], 0, 1)
    o = bpy.data.objects.new(name, cu); sc.collection.objects.link(o); cu.materials.append(mat)
    o.rotation_euler = (math.radians(90), 0, 0); o.location = (0, y, 0)
    return o


def glasses():
    from shapely.geometry import Polygon, box
    from shapely.ops import unary_union
    from shapely import affinity

    def lens(cx, grow=0.0):                         # a rounded trapezoid, wider at the brow
        out = []
        for k in range(120):
            a = math.tau * k / 120; c, s = math.cos(a), math.sin(a)
            z = math.copysign(abs(s) ** (2 / 2.7), s)
            x = math.copysign(abs(c) ** (2 / 2.7), c) * (1 + 0.1 * z)
            out.append((cx + x * (1.95 + grow), -0.05 + z * (1.35 + grow)))
        return Polygon(out)

    parts = []
    for sgn in (-1, 1):
        parts += [lens(sgn * 2.6, 0.3), affinity.translate(lens(sgn * 2.6, 0.26), 0, 0.2),                 # a rim, heavier at the brow
                  Polygon([(sgn * 3.9, 1.65), (sgn * 5.2, 1.72), (sgn * 5.16, 1.05), (sgn * 4.5, 0.6)])]   # the wing at the temple
    parts.append(box(-1.0, 0.25, 1.0, 1.45))                                                                # the bridge
    outer = unary_union(parts).buffer(0.25).buffer(-0.25)             # rounds the joins and leaves the corners
    holes = unary_union([lens(-2.6), lens(2.6)])
    black = rig.plastic('frame', (0.012, 0.012, 0.015), rough=0.14, coat=1.0)
    flat('frame', outer.difference(holes), 0.16, 0.11, black)

    m, n, l, b = rig.material('lens')                # mostly nothing, with a sheen where a light catches it
    tr = n.new('ShaderNodeBsdfTransparent'); gl = n.new('ShaderNodeBsdfGlossy'); gl.inputs['Roughness'].default_value = 0.05
    fr = n.new('ShaderNodeFresnel'); fr.inputs['IOR'].default_value = 1.25; mx = n.new('ShaderNodeMixShader')
    l.new(fr.outputs[0], mx.inputs[0]); l.new(tr.outputs[0], mx.inputs[1]); l.new(gl.outputs[0], mx.inputs[2])
    l.new(mx.outputs[0], n['Material Output'].inputs['Surface'])
    for g in holes.geoms: flat('lens', g.buffer(0.05), 0.01, 0.0, m, y=0.05)

    steel = rig.plastic('rivet', (0.75, 0.76, 0.8), rough=0.2, metallic=1.0)
    for sgn in (-1, 1):
        o = rig.ball((sgn * 4.6, -0.27, 1.32), 0.2, steel, scale=(1.5, 0.35, 0.7)); o.rotation_euler = (0, math.radians(sgn * 8), 0)
    frame(11.2, 4.4, (0, 0.1)); lights(key=3200, fill=1400, room=0.1)
    rig.area('strip', (0, -9, 9), 14.0, 1500, look_at=(0, 0, 0), size_y=1.5)       # a long strip, for the gloss along the brow


# ---- the cigar -----------------------------------------------------------------------------------------------------
def turned(name, x0, x1, radius, mat, n=220, seg=96, lump=0.0, cap=False):
    """A shape turned about the x axis, from x0 to x1; radius is a function of x. UV: u along it, v around."""
    import bmesh
    bm = bmesh.new(); uvl = bm.loops.layers.uv.new(); rings = []
    for j in range(n + 1):
        x = x0 + (x1 - x0) * j / n; row = []
        for k in range(seg):
            a = math.tau * k / seg; r = radius(x)
            if lump: r *= 1 + lump * noise.noise((x * 3.0, math.cos(a) * 1.6, math.sin(a) * 1.6))
            row.append(bm.verts.new((x, -math.cos(a) * r, math.sin(a) * r)))
        rings.append(row)
    for j in range(n):
        for k in range(seg):
            f = bm.faces.new((rings[j][k], rings[j][(k + 1) % seg], rings[j + 1][(k + 1) % seg], rings[j + 1][k])); f.smooth = True
            for lp, (u, v) in zip(f.loops, ((j, k), (j, k + 1), (j + 1, k + 1), (j + 1, k))): lp[uvl].uv = (u / n, v / seg)
    if cap: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o); me.materials.append(mat)
    return o


def cigar():
    from scipy.ndimage import zoom
    R, X0, X1, X2 = 0.95, -4.5, 3.55, 4.25           # the body runs X0..X1, the ash X1..X2
    body_r = lambda x: (R - 0.05 * (x - X0) / (X1 - X0)) * math.sqrt(max(1e-4, 1 - max(0.0, (X0 + 1.0 - x)) ** 2))

    # the wrapper leaf: a spiral of overlapping turns, mottled, charred where it meets the ash
    TW, TH = 2048, 512
    rng = np.random.default_rng(7)
    fbm = sum(zoom(rng.random((TH // s, TW // s)), s, order=3, mode='grid-wrap') * w for s, w in ((64, 0.5), (16, 0.3), (4, 0.2)))
    v, u = np.mgrid[0:TH, 0:TW]; u = u / TW; v = v / TH
    turn = u * 5.2 + v + 0.06 * (fbm - 0.5)
    k = turn % 1.0; leaf = np.floor(turn)
    tone = 0.86 + 0.28 * ((np.sin(leaf * 12.9898) * 43758.5453) % 1.0)
    col = np.array(rig.hexrgb('#9a5a3a'))[None, None, :] * (tone * (0.8 + 0.4 * fbm))[..., None]
    col *= (1 - 0.55 * np.exp(-k / 0.012))[..., None]                               # the seam's shadow
    veins = np.abs(((u * 5.2 * 7 - v * 3 + 0.3 * fbm) % 1.0) - 0.5) < 0.012
    col *= np.where(veins, 0.86, 1.0)[..., None]
    char = np.clip((u - 0.955) / 0.035, 0, 1)[..., None]
    col = col * (1 - char) + np.array([0.012, 0.01, 0.009]) * char
    height = 0.6 * (1 - k) + 0.25 * fbm + np.where(veins, 0.1, 0.0)
    tex = bpy.data.images.new('leaf', TW, TH, alpha=True, float_buffer=True); tex.colorspace_settings.name = 'Non-Color'
    tex.pixels.foreach_set(np.dstack([col, height]).astype(np.float32).ravel())
    m, n, l, b = rig.material('leaf')
    ti = n.new('ShaderNodeTexImage'); ti.image = tex; bp = n.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.35; bp.inputs['Distance'].default_value = 0.08
    l.new(ti.outputs['Color'], b.inputs['Base Color']); l.new(ti.outputs['Alpha'], bp.inputs['Height']); l.new(bp.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.42; b.inputs['Coat Weight'].default_value = 0.25; b.inputs['Coat Roughness'].default_value = 0.25
    parts = [turned('body', X0, X1, body_r, m)]

    # the band, with its seal facing out
    band = rig.plastic('band', rig.hexrgb('#f6a21c'), rough=0.3)
    gold = rig.plastic('gold', rig.hexrgb('#ffc74a'), rough=0.22, metallic=1.0)
    red = rig.plastic('red', rig.hexrgb('#e0341c'), rough=0.3)
    parts.append(turned('band', -1.75, -1.05, lambda x: body_r(x) + 0.03, band, n=4))
    for x in (-1.75, -1.05): parts.append(turned('edge', x - 0.04, x + 0.04, lambda x: body_r(-1.4) + 0.045, gold, n=2))
    y = -body_r(-1.4)
    parts.append(rig.ball((-1.4, y + 0.02, 0.0), 0.56, band, scale=(1, 0.2, 1)))
    bpy.ops.mesh.primitive_torus_add(major_radius=0.34, minor_radius=0.065, location=(-1.4, y - 0.075, 0.0), rotation=(math.radians(90), 0, 0))
    ring = bpy.context.object; bpy.ops.object.shade_smooth(); ring.data.materials.append(red); parts.append(ring)
    parts.append(rig.ball((-1.4, y - 0.07, 0.0), 0.2, red, scale=(1, 0.3, 1)))

    # the ash, and the coal at its end
    m, n, l, b = rig.material('ash')
    nz = n.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 9.0; nz.inputs['Detail'].default_value = 6.0
    ramp = n.new('ShaderNodeValToRGB'); ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[0].color = (0.1, 0.1, 0.1, 1)
    ramp.color_ramp.elements[1].position = 0.7; ramp.color_ramp.elements[1].color = (0.62, 0.62, 0.64, 1)
    l.new(nz.outputs['Fac'], ramp.inputs['Fac']); l.new(ramp.outputs['Color'], b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.9
    parts.append(turned('ash', X1 - 0.02, X2, lambda x: body_r(X1) * (1.0 - 0.1 * ((x - X1) / (X2 - X1)) ** 2), m, n=40, lump=0.09))
    m, n, l, b = rig.material('coal')
    vo = n.new('ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = 5.5
    ramp = n.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
    cr.elements[0].position = 0.08; cr.elements[0].color = (*rig.hexrgb('#ffe23a'), 1)
    cr.elements[1].position = 0.42; cr.elements[1].color = (0.03, 0.03, 0.03, 1)
    e = cr.elements.new(0.24); e.color = (*rig.hexrgb('#ff5a14'), 1)
    l.new(vo.outputs['Distance'], ramp.inputs['Fac']); l.new(ramp.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = 5.0
    b.inputs['Base Color'].default_value = (0.25, 0.25, 0.26, 1); b.inputs['Roughness'].default_value = 0.9
    coal = rig.ball((X2 - 0.02, 0, 0), body_r(X1) * 0.9, m, scale=(0.22, 1, 1)); parts.append(coal)

    rig.group(parts, rot=(0, 0, -24))                 # the lit end turned toward the viewer
    frame(9.6, 3.0, (-0.1, 0)); lights(key=3000, fill=1100)


{'glasses': glasses, 'cigar': cigar, 'mustache-a': mustache_a, 'mustache-b': mustache_b}[ITEM]()
sc.render.image_settings.file_format = 'WEBP' if OUT.endswith('.webp') else 'PNG'
sc.render.image_settings.color_mode = 'RGBA'; sc.render.image_settings.quality = 90
sc.render.filepath = os.path.abspath(OUT)
bpy.ops.render.render(write_still=True)
