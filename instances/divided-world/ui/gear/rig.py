"""The gear rig: renders one item's views from its model.

    blender -b -P rig.py -- <key> [--views a,b,c --default b]        (run from ui/gear/, or anywhere)

It reads `<key>/model.blend` (or, for a color variant, the `model.blend` of the base item named in `<key>/rig.json`),
builds the scene from nothing so every item is lit alike, turns the item about its vertical axis for each view,
and writes `<key>/<view>.webp` and `<key>/views.json`. The design is docs/plans/2026-11-23-rendered-gear-design.md
(sections 4 and 5); the instance's README is README.md beside this file; the engine's contract is specs/gear-art.md.

The views come from `--views` and `--default` if given, else the item's own `views.json`, else (a variant with neither)
the base item's `views.json`. An item with none of these must be given them.

A variant's `rig.json` is `{ "model": "<base key>", "hue": <degrees>, "recolor": ["<object>", ...] }`: the rig loads the
base's model, then turns the hue of every color stop of every Color Ramp node in the materials of the named objects by
`hue` degrees (HSV hue). Two optional fields lift the same stops toward 1, each a factor from 0 (no change) to 1 (full):
`"value": f` makes a stop's HSV value v become 1 - (1 - v) * (1 - f), and `"saturation": f` does the same to its
saturation. The lift keeps the order of the stops (a darker stop stays darker than a lighter one), so the shading is
kept while the color brightens; a yellow, which a plain turn of a red ramp leaves mustard, uses it. A material the
objects share, such as a cap's button and body, turns together; a material only other objects use is left as it is.

The numbers below were measured from the research cap, docs/research/2026-11-23-gear-renders/hat.blend (the owner's
revised Baseball Cap): its camera (Camera: 50 mm lens, 36 mm sensor, at (4.08, -2.88, 0.02), pitched 6 degrees below the
horizon) and its one point light (Light: 725.63 W, exposure 1.3793, radius 0.1, at (3.2228, -1.7645, 5.9039)), both
taken relative to the cap's pivot (0.0893, 0, -0.7725) in that file's units. The camera stands 35.82 degrees round the
cap from its brim; swinging camera and light together about the vertical axis through the pivot until the camera is on
+X leaves the camera at (4.9214, 0, 0.7925) and the light at (3.5735, 0.4029, 6.6764): the cap is lit exactly as in
`hat.blend`, and the brim faces the camera. The cap's size, `SIZE0`, is its farthest vertex from the vertical axis
through the pivot (1.4175) or its height (0.9799), whichever is larger. An item's size is measured the same way from the
model as appended (after any recolor); distances scale with item size over `SIZE0` and the light's energy with its
square, so every item is lit alike in proportion. The world is flat gray 0.154232 (hat.blend's), strength 1; the view
transform is AgX, as in hat.blend; Eevee's other settings are Blender's defaults, which hat.blend also has.

Each view is rendered square at 2048 pixels, cropped to the alpha's bounds plus two pixels, and all of an item's views
are scaled by one factor so that the longest side of the largest view is 1024. `views.json` records each view's width,
height and pivot (the pivot's pixel from the picture's top left corner, rounded to whole pixels).
"""
import colorsys
import json
import math
import os
import sys
import tempfile

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))

# --- measured from hat.blend (see the header) --------------------------------------------------------------------
SIZE0 = 1.4175                   # the research cap's size: max(radius from the axis, height), in its units
CAMERA = (4.9214, 0.0, 0.7925)   # relative to the pivot, on +X, looking along -X
PITCH = 6.0                      # degrees below the horizon
LENS, SENSOR = 50.0, 36.0
LIGHT = (3.5735, 0.4029, 6.6764)  # relative to the pivot, with the camera on +X
LIGHT_ENERGY, LIGHT_EXPOSURE, LIGHT_RADIUS = 725.63, 1.3793106, 0.1
WORLD_GRAY = 0.15423208
# --- the rig's own ------------------------------------------------------------------------------------------------
RENDER_PX = 2048
LONGEST = 1024
PAD = 2
QUALITY = 90
ANGLE = 35.5
# The five views in the order the dress-up page lists them, with the turn each takes about the vertical axis.
YAWS = {'side-left': -90.0, 'three-quarter-left': -ANGLE, 'front': 0.0, 'three-quarter-right': ANGLE, 'side-right': 90.0}


def args():
    a = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if not a or a[0].startswith('--'):
        sys.exit('usage: blender -b -P rig.py -- <key> [--views a,b,c --default b]')
    out = {'key': a[0], 'views': None, 'default': None}
    i = 1
    while i < len(a):
        if a[i] in ('--views', '--default') and i + 1 < len(a):
            out[a[i][2:]] = a[i + 1]
            i += 2
        else:
            sys.exit('unknown argument ' + a[i])
    if out['views']:
        out['views'] = out['views'].split(',')
    return out


def read_json(path):
    with open(path) as f:
        return json.load(f)


def views_wanted(a, rig):
    """(views, default): the arguments, else the item's views.json, else the base item's."""
    key = a['key']
    views, default = a['views'], a['default']
    for path in [os.path.join(HERE, key, 'views.json')] + ([os.path.join(HERE, rig['model'], 'views.json')] if rig else []):
        if views is None and os.path.exists(path):
            data = read_json(path)
            views, default = list(data['views']), default or data['default']
    if views is None:
        sys.exit(f'{key}: no views; give --views a,b,c --default b, or a views.json')
    for v in views:
        if v not in YAWS:
            sys.exit(f'{v} is not one of the five views: {", ".join(YAWS)}')
    default = default or views[0]
    if default not in views:
        sys.exit(f'default {default} is not one of the views {views}')
    return [v for v in YAWS if v in views], default


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in ids else 'BLENDER_EEVEE'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'None'
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = RENDER_PX
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '16'
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (WORLD_GRAY, WORLD_GRAY, WORLD_GRAY, 1.0)
    bg.inputs['Strength'].default_value = 1.0
    sc.world = world
    cam_data = bpy.data.cameras.new('Camera')
    cam_data.lens, cam_data.sensor_width, cam_data.clip_end = LENS, SENSOR, 1000.0
    cam = bpy.data.objects.new('Camera', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    light_data = bpy.data.lights.new('Light', 'POINT')
    light = bpy.data.objects.new('Light', light_data)
    sc.collection.objects.link(light)
    return sc, cam, cam_data, light, light_data


def append_model(sc, path):
    """Append every object of the model; put its `pivot` at the origin. Returns the objects to turn (those with no parent)."""
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    objs = [o for o in dst.objects if o is not None]
    pivot = next((o for o in objs if o.name == 'pivot'), None)
    if pivot is None:
        sys.exit(f'{path} has no empty named pivot')
    where = pivot.location.copy()  # the model's objects and its pivot carry no parent, so location is where they are
    # Only the mesh and its helpers are the model: a camera or light left in model.blend is not appended, so the rig's own light is the only light.
    objs = [o for o in objs if o is pivot or o.type in {'MESH', 'EMPTY', 'CURVE', 'FONT'}]
    roots = []
    for o in objs:
        if o is pivot:
            continue
        sc.collection.objects.link(o)
        if o.parent is None:
            o.location = o.location - where
            roots.append(o)
    bpy.data.objects.remove(pivot, do_unlink=True)
    bpy.context.view_layer.update()
    return roots, [o for o in objs if o is not pivot]


def recolor(objects, rig):
    """Turn the hue of every color stop of every Color Ramp in the materials of the named objects."""
    names = set(rig.get('recolor', []))
    hue = float(rig['hue']) / 360.0
    lift_v, lift_s = float(rig.get('value', 0.0)), float(rig.get('saturation', 0.0))
    if not (0.0 <= lift_v <= 1.0 and 0.0 <= lift_s <= 1.0):
        sys.exit('recolor: "value" and "saturation" are factors from 0 to 1')
    mats = {}
    for o in objects:
        if o.name in names:
            for slot in o.material_slots:
                if slot.material and slot.material.node_tree:
                    mats[slot.material.name] = slot.material
    missing = names - {o.name for o in objects}
    if missing or not mats:
        sys.exit(f'recolor: no object {sorted(missing)} or no material with nodes among {sorted(names)}')
    turned = 0
    for mat in mats.values():
        for node in mat.node_tree.nodes:
            if node.type == 'VALTORGB':
                for stop in node.color_ramp.elements:
                    r, g, b, alpha = stop.color
                    h, s, v = colorsys.rgb_to_hsv(r, g, b)
                    s, v = 1.0 - (1.0 - s) * (1.0 - lift_s), 1.0 - (1.0 - v) * (1.0 - lift_v)
                    stop.color = (*colorsys.hsv_to_rgb((h + hue) % 1.0, s, v), alpha)
                    turned += 1
    if turned == 0:
        sys.exit(f'recolor: the materials of {sorted(names)} hold no Color Ramp, so the variant would render as its base')


def item_size(objects):
    """max(radius from the vertical axis through the origin, height range) of the render-visible meshes."""
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objects:
        if o.type == 'MESH' and not o.hide_render:
            e = o.evaluated_get(dg)
            me = e.to_mesh()
            pts.extend(o.matrix_world @ v.co for v in me.vertices)
            e.to_mesh_clear()
    p = np.array(pts)
    return max(float(np.hypot(p[:, 0], p[:, 1]).max()), float(p[:, 2].max() - p[:, 2].min()))


def weights(n_in, n_out):
    """A resampling matrix (n_out by n_in): box (area) averaging when shrinking, linear when growing."""
    w = np.zeros((n_out, n_in), np.float32)
    s = n_in / n_out
    for i in range(n_out):
        if s >= 1:
            lo, hi = i * s, (i + 1) * s
            a, b = int(math.floor(lo)), min(n_in, int(math.ceil(hi)))
            for j in range(a, b):
                w[i, j] = min(hi, j + 1) - max(lo, j)
            w[i] /= w[i].sum()
        else:
            c = (i + 0.5) * s - 0.5
            a = int(math.floor(c))
            t = c - a
            w[i, min(max(a, 0), n_in - 1)] += 1 - t
            w[i, min(max(a + 1, 0), n_in - 1)] += t
    return w


def resize(img, w2, h2):
    """img is (h, w, 4) float, alpha last, color premultiplied."""
    h, w = img.shape[:2]
    tmp = np.tensordot(weights(h, h2), img, axes=(1, 0))
    return np.tensordot(tmp, weights(w, w2), axes=(1, 1)).transpose(0, 2, 1)


def render_view(sc, tmp, name):
    sc.render.filepath = os.path.join(tmp, name + '.png')
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(sc.render.filepath)
    img.colorspace_settings.name = 'Non-Color'
    img.alpha_mode = 'STRAIGHT'
    arr = np.empty(RENDER_PX * RENDER_PX * 4, np.float32)
    img.pixels.foreach_get(arr)
    bpy.data.images.remove(img)
    return arr.reshape(RENDER_PX, RENDER_PX, 4)  # rows run bottom to top, as Blender's do


def write_webp(path, img):
    """img is (h, w, 4) float, straight alpha, rows bottom to top; saved as the values stand."""
    h, w = img.shape[:2]
    out = bpy.data.images.new('out', w, h, alpha=True)
    out.colorspace_settings.name = 'Non-Color'
    out.alpha_mode = 'STRAIGHT'
    out.pixels.foreach_set(np.ascontiguousarray(img, np.float32).ravel())
    out.file_format = 'WEBP'
    out.save(filepath=path, quality=QUALITY)
    bpy.data.images.remove(out)


def main():
    a = args()
    key = a['key']
    item = os.path.join(HERE, key)
    rig_path = os.path.join(item, 'rig.json')
    rig = read_json(rig_path) if os.path.exists(rig_path) else None
    views, default = views_wanted(a, rig)
    model = os.path.join(HERE, rig['model'] if rig else key, 'model.blend')
    if not os.path.exists(model):
        sys.exit(f'{model} is missing')

    sc, cam, cam_data, light, light_data = build_scene()
    roots, objects = append_model(sc, model)
    if rig:
        recolor(objects, rig)
    k = item_size(objects) / SIZE0
    cam.location = Vector(CAMERA) * k
    cam.rotation_euler = (math.radians(90 - PITCH), 0.0, math.radians(90))
    light.location = Vector(LIGHT) * k
    light_data.energy, light_data.exposure, light_data.shadow_soft_size = LIGHT_ENERGY * k * k, LIGHT_EXPOSURE, LIGHT_RADIUS * k
    bpy.context.view_layer.update()
    print(f'RIG {key}: size scale {k:.4f}, camera {tuple(round(x, 3) for x in cam.location)}, '
          f'light {tuple(round(x, 3) for x in light.location)}, energy {light_data.energy:.1f}')
    px = world_to_camera_view(sc, cam, Vector((0.0, 0.0, 0.0)))
    pivot_px = (px.x * RENDER_PX, px.y * RENDER_PX)  # from the bottom left of the full render

    base = {o: o.matrix_world.copy() for o in roots}
    tmp = tempfile.mkdtemp(prefix='gear-rig-')
    crops = {}
    for view in views:
        for o in roots:
            o.matrix_world = Matrix.Rotation(math.radians(YAWS[view]), 4, 'Z') @ base[o]
        bpy.context.view_layer.update()
        raw = render_view(sc, tmp, view)
        ys, xs = np.nonzero(raw[..., 3] > 1.0 / 255.0)
        if len(xs) == 0:
            sys.exit(f'{view}: rendered nothing')
        x0, x1 = max(xs.min() - PAD, 0), min(xs.max() + 1 + PAD, RENDER_PX)
        y0, y1 = max(ys.min() - PAD, 0), min(ys.max() + 1 + PAD, RENDER_PX)
        if x0 == 0 or y0 == 0 or x1 == RENDER_PX or y1 == RENDER_PX:
            sys.exit(f'{view}: the item touches the edge of the frame; it is cut off')
        crop = raw[y0:y1, x0:x1].copy()
        crop[..., :3] *= crop[..., 3:4]  # premultiply for the resampling
        crops[view] = (crop, pivot_px[0] - x0, (y1 - y0) - (pivot_px[1] - y0))  # the pivot from the crop's top left

    f = LONGEST / max(max(c.shape[:2]) for c, _, _ in crops.values())
    data = {'default': default, 'views': {}}
    for view in views:
        crop, pxx, pyy = crops[view]
        h, w = crop.shape[:2]
        w2, h2 = max(1, round(w * f)), max(1, round(h * f))
        small = resize(crop, w2, h2)
        al = np.clip(small[..., 3:4], 0.0, 1.0)
        rgb = np.where(al > 0, small[..., :3] / np.maximum(al, 1e-6), 0.0)
        write_webp(os.path.join(item, view + '.webp'), np.concatenate([np.clip(rgb, 0, 1), al], axis=2))
        data['views'][view] = {
            'width': w2, 'height': h2,
            'pivot': {'x': int(min(max(round(pxx * w2 / w), 0), w2)), 'y': int(min(max(round(pyy * h2 / h), 0), h2))},
        }
        print(f'WROTE {key}/{view}.webp {w2}x{h2} pivot {data["views"][view]["pivot"]}')
    with open(os.path.join(item, 'views.json'), 'w') as fh:
        json.dump(data, fh, indent=2)
        fh.write('\n')


main()
