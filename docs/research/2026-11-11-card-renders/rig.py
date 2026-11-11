"""Shared rig for the 90s-CG card art explorations: scene reset, Standard color, materials, render."""
import bpy, os, math

W, H = 540, 840                      # the card canvas (specs/card-art.md)
SCALE = float(os.environ.get('ART_SCALE', '2'))
SAMPLES = int(os.environ.get('ART_SAMPLES', '256'))

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x, sc.render.resolution_y = int(W * SCALE), int(H * SCALE)
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'   # saturated, no filmic roll-off: the 90s look
    sc.view_settings.look = 'None'
    sc.render.image_settings.file_format = 'PNG'
    return sc

def sock(sockets, ident):
    for s in sockets:
        if s.identifier == ident or s.name == ident:
            return s
    raise KeyError(f'{ident} not in {[s.identifier for s in sockets]}')

def material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    return m, nt.nodes, nt.links, nt.nodes['Principled BSDF']

def plastic(name, rgb, rough=0.1, metallic=0.0, coat=0.0, emit=0.0):
    m, n, l, b = material(name)
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metallic
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.03
    if emit:
        b.inputs['Emission Color'].default_value = (*rgb, 1)
        b.inputs['Emission Strength'].default_value = emit
    return m

def hexrgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)  # to linear

def mix_color(nodes, links, fac, a, b):
    """A color Mix node; fac/a/b are sockets or values. Returns the result socket."""
    mx = nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    for ident, v in (('Factor_Float', fac), ('A_Color', a), ('B_Color', b)):
        s = sock(mx.inputs, ident)
        if hasattr(v, 'is_linked'):
            links.new(v, s)
        elif isinstance(v, (int, float)):
            s.default_value = v
        else:
            s.default_value = (*v, 1)
    return sock(mx.outputs, 'Result_Color')

def area(name, loc, size, energy, rgb=(1, 1, 1), look_at=(0, 0, 0), size_y=None):
    from mathutils import Vector
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.color = rgb
    d.shape = 'RECTANGLE'; d.size = size; d.size_y = size_y or size
    o = bpy.data.objects.new(name, d); bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = (Vector(look_at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o

def render(path):
    sc = bpy.context.scene
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    blend = os.environ.get('ART_BLEND')
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=blend)

def tube(name, pts, radius, mat, res=3):
    """A round thread through the points."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = radius; cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts): p.co = (*q, 1)
    o = bpy.data.objects.new(name, cu); bpy.context.scene.collection.objects.link(o); cu.materials.append(mat)
    return o

def ball(loc, r, mat, name='ball', seg=24, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=loc, segments=seg, ring_count=seg // 2)
    o = bpy.context.object; o.name = name; bpy.ops.object.shade_smooth(); o.data.materials.append(mat)
    if scale: o.scale = scale
    return o

def slab(name, outline, y_front, y_back, mat, bevel):
    """A flat outline (2D points, read as x and z) given thickness along y, its edges rounded."""
    import bmesh
    bm = bmesh.new()
    f = [bm.verts.new((p[0], y_front, p[1])) for p in outline]; b = [bm.verts.new((p[0], y_back, p[1])) for p in outline]
    bm.faces.new(f); bm.faces.new(reversed(b))
    n = len(outline)
    for i in range(n): bm.faces.new((f[i], b[i], b[(i + 1) % n], f[(i + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(o); me.materials.append(mat)
    md = o.modifiers.new('bevel', 'BEVEL'); md.width = bevel; md.segments = 4; md.limit_method = 'ANGLE'
    return o

def backdrop(y, stops, strength=1.0):
    """A lit card far behind the scene, shaded bottom to top through the (position, hex) stops."""
    m, n, l, b = material('backdrop')
    tc = n.new('ShaderNodeTexCoord'); sx = n.new('ShaderNodeSeparateXYZ'); ramp = n.new('ShaderNodeValToRGB'); cr = ramp.color_ramp
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*hexrgb(stops[0][1]), 1)
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*hexrgb(stops[-1][1]), 1)
    for pos, hx in stops[1:-1]:
        e = cr.elements.new(pos); e.color = (*hexrgb(hx), 1)
    l.new(tc.outputs['UV'], sx.inputs[0]); l.new(sx.outputs['Y'], ramp.inputs['Fac'])
    em = n.new('ShaderNodeEmission'); l.new(ramp.outputs['Color'], em.inputs['Color']); em.inputs['Strength'].default_value = strength
    l.new(em.outputs[0], n['Material Output'].inputs['Surface'])
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, y, 0), rotation=(math.radians(90), 0, 0))
    o = bpy.context.object; o.scale = (26, 30, 1); o.data.materials.append(m)
    return o

def camera(lens=60, fstop=None):
    """The card's camera: looks along +y at the 5.4 by 8.4 card on the xz plane."""
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam'); cam.sensor_fit = 'VERTICAL'; cam.sensor_height = 36; cam.lens = lens
    d = lens * 8.4 / 36
    if fstop:
        cam.dof.use_dof = True; cam.dof.focus_distance = d; cam.dof.aperture_fstop = fstop
    o = bpy.data.objects.new('cam', cam); sc.collection.objects.link(o); sc.camera = o
    o.location = (0, -d, 0); o.rotation_euler = (math.radians(90), 0, 0)
    return o

def world(rgb, strength):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (*rgb, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = strength
