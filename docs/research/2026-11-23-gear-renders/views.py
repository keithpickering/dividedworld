"""Turn the hat, not the camera. The original scene orbits the camera (and its one point light) about 35 degrees round a
hat whose brim faces +X. Here the camera and light are swung together about the dome's vertical axis until the camera
looks straight at the brim, so the light sits where it was relative to the camera; then the hat itself is turned for each
view. Usage: blender -b hat.blend -P views.py -- <outdir> <verify|views> [percent]"""
import bpy, sys, math, os
from mathutils import Matrix, Vector
argv = sys.argv[sys.argv.index('--') + 1:]
out, mode = argv[0], argv[1]
pct = int(argv[2]) if len(argv) > 2 else 100
sc = bpy.context.scene
hat, cam, light = bpy.data.objects['Sphere.001'], sc.camera, bpy.data.objects['Light']
PIVOT = Vector((0.044, 0.0, 0.0))          # the dome's centre in plan (measured); the axis a head would turn the hat on
CAM_AZ = math.degrees(math.atan2(cam.location.y - PIVOT.y, cam.location.x - PIVOT.x))   # about -35.2

def about_pivot(deg):
    return Matrix.Translation(PIVOT) @ Matrix.Rotation(math.radians(deg), 4, 'Z') @ Matrix.Translation(-PIVOT)

# Swing the rig (camera + light) to face the brim head-on; it never moves again.
R = about_pivot(-CAM_AZ)
cam.matrix_world = R @ cam.matrix_world
light.matrix_world = R @ light.matrix_world
HAT0 = hat.matrix_world.copy()

sc.render.resolution_percentage = pct
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'

def render(name, yaw, transparent):
    hat.matrix_world = about_pivot(yaw) @ HAT0
    sc.render.film_transparent = transparent
    sc.render.filepath = os.path.join(out, name + '.png')
    bpy.ops.render.render(write_still=True)
    print('WROTE', name, 'yaw', round(yaw, 2))

if mode == 'verify':
    # Turning the hat by minus the camera's old azimuth must reproduce the original picture.
    render('verify-turned', -CAM_AZ, False)
elif mode == 'views':
    a = -CAM_AZ   # the owner's own 3/4 angle, ~35 degrees
    for name, yaw in [('front', 0), ('three-quarter-right', a), ('side-right', 90),
                      ('three-quarter-left', -a), ('side-left', -90)]:
        render(name, yaw, True)
