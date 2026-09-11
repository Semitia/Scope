"""Run with Blender --background --python tools/build_wristed_model.py.
Build an approximate, video-referenced rigid instrument in millimetres.
No flexible continuum geometry; the browser supplies its existing line drawing.
"""
import math
from pathlib import Path
import bpy
import bmesh

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, metallic=0, roughness=.35):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Roughness'].default_value = roughness
    return m

steel = material('Satin stainless steel', (.53, .59, .64), .78, .28)
bright = material('Machined edges', (.75, .79, .82), .85, .22)
dark = material('Dark recesses', (.027, .036, .043), .35, .4)
white = material('Ivory polymer', (.84, .85, .79), 0, .36)
gray = material('Warm gray housing', (.31, .30, .27), .3, .48)
black = material('Black terminal collar', (.018, .022, .025), .05, .32)
parts = {}
def group(name):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    parts[name] = o
    return o

def finish(o, parent, mat, bevel=0):
    o.parent = parent
    o.data.materials.append(mat)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(o.data); bm.free()
    if bevel:
        mod = o.modifiers.new('Machined edge radius', 'BEVEL'); mod.width = bevel; mod.segments = 3
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for p in o.data.polygons: p.use_smooth = True
    return o

def cylinder(name, parent, radius, depth, pos, mat, axis='Z', bevel=.08):
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=radius, depth=depth, location=pos)
    o=bpy.context.object; o.name=name
    if axis=='X': o.rotation_euler[1]=math.pi/2
    if axis=='Y': o.rotation_euler[0]=math.pi/2
    return finish(o,parent,mat,bevel)

def box(name,parent,pos,size,mat,bevel=.12):
    bpy.ops.mesh.primitive_cube_add(size=1,location=pos)
    o=bpy.context.object; o.name=name; o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(o,parent,mat,bevel)

def ring(name,parent,radius,thickness,z,mat):
    bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=8,location=(0,0,z),major_radius=radius,minor_radius=thickness)
    o=bpy.context.object; o.name=name; return finish(o,parent,mat)

housing=group('housing')
cylinder('Ivory rear sleeve',housing,13.5,24,(0,0,-43),white)
cylinder('Gray drive housing',housing,13.6,27,(0,0,-17.5),gray)
cylinder('Ivory front rim',housing,13.7,4,(0,0,-2),white)
cylinder('Black exit ferrule',housing,6.0,5,(0,0,1),black)
for z in [-30,-17,-5]: ring('Housing seam',housing,13.6,.13,z,dark)
for a in range(4):
    angle=a*math.pi/2
    o=box('Housing index recess',housing,(13.59*math.cos(angle),13.59*math.sin(angle),-8),(.12,1.3,2.1),dark,.02)
    o.rotation_euler[2]=angle

shaft=group('shaft')
# Tube cells have true through-holes, including an inner wall and hole rims.
verts=[]; faces=[]
rows=16; columns=8; z0=2; length=36
for row in range(rows):
    for col in range(columns):
        center_z=z0+(row+.5)*length/rows
        center_a=(col+.5)*2*math.pi/columns
        start=len(verts)
        for radius in [4,3.55]:
            for hole in [False,True]:
                for i in range(16):
                    a=2*math.pi*i/16; c=math.cos(a); s=math.sin(a)
                    if hole: u=.19*c; v=.77*s
                    else:
                        m=max(abs(c),abs(s)); u=math.pi/columns*c/m; v=length/rows/2*s/m
                    verts.append((radius*math.cos(center_a+u),radius*math.sin(center_a+u),center_z+v))
        for i in range(16):
            j=(i+1)%16
            faces.extend([(start+i,start+j,start+16+j,start+16+i),
                          (start+32+j,start+32+i,start+48+i,start+48+j),
                          (start+16+i,start+16+j,start+48+j,start+48+i)])
mesh=bpy.data.meshes.new('Perforated tube mesh'); mesh.from_pydata(verts,[],faces); mesh.update()
o=bpy.data.objects.new('128 through-holes in silver sleeve',mesh); bpy.context.collection.objects.link(o); finish(o,shaft,steel)
# Dark internal shaft is visible through the sleeve perforations.
cylinder('Internal shaft',shaft,2.95,38,(0,0,19.5),dark)
cylinder('Proximal black collar',shaft,4.1,2,(0,0,1),black)
for z in [2,38,39]: ring('Sleeve end bead',shaft,3.79,.21,z,bright)
cylinder('Distal shoulder',shaft,3.95,1.4,(0,0,38.7),steel)

mount=group('mount')
# First hinge rotates about local X. Fork stops at its pivot (z=0).
for x in [-2.45,2.45]:
    box('Proximal clevis ear',mount,(x,0,-1.9),(1.2,4.4,5.2),steel,.55)
    cylinder('Pitch pivot head',mount,1.35,.26,(x+(.68 if x>0 else -.68),0,0),bright,'X')
    cylinder('Pitch pivot socket',mount,.48,.28,(x+(.83 if x>0 else -.83),0,0),dark,'X',.02)

wrist=group('wrist')
cylinder('Pitch axle',wrist,1.65,3.5,(0,0,0),steel,'X')
box('Articulating central link',wrist,(0,0,3.7),(3.0,3.0,6.6),steel,.6)
for y in [-1.95,1.95]:
    box('Distal clevis ear',wrist,(0,y,7.0),(3.8,1.1,3.8),steel,.5)
    cylinder('Yaw pivot head',wrist,1.3,.24,(0,y+(.62 if y>0 else -.62),8.89),bright,'Y')
    cylinder('Yaw pivot socket',wrist,.45,.26,(0,y+(.76 if y>0 else -.76),8.89),dark,'Y',.02)

for name,sign in [('jawLeft',1),('jawRight',-1)]:
    jaw=group(name)
    cylinder('Jaw pivot cheek',jaw,1.45,1.2,(0,sign*.7,0),steel,'Y')
    # Tapered, curved outer profile and flat gripping face; closed tips meet at x=0.
    outline=[(0,1.0),(1.15,1.1),(1.35,2.5),(.95,5.5),(.48,8.7),(.12,9),(0,8.8)]
    vs=[(sign*x,y,z) for y in [-.7,.7] for x,z in outline]; n=len(outline)
    fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    me=bpy.data.meshes.new(name+' mesh'); me.from_pydata(vs,[],fs); me.update()
    ob=bpy.data.objects.new('Tapered gripping jaw',me); bpy.context.collection.objects.link(ob); finish(ob,jaw,bright,.09)
    for j in range(9):
        box('Gripping serration',jaw,(sign*.09,0,2.2+j*.68),(.18,1.25,.19),steel,.045)

# Save an editable assembled reference. All part origins are articulation pivots.
shaft.location.z=100
mount.location.z=142.4
wrist.location.z=142.4
parts['jawLeft'].location.z=151.29; parts['jawLeft'].rotation_euler.y=.26
parts['jawRight'].location.z=151.29; parts['jawRight'].rotation_euler.y=-.26
bpy.context.scene.unit_settings.system='METRIC'
bpy.context.scene.unit_settings.scale_length=.001
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_distance=220
            area.spaces.active.region_3d.view_location=(0,0,55)
            area.spaces.active.shading.type='MATERIAL'
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'models/wristed/instrument.blend'))
# Export each named part in its own local frame; runtime kinematics assembles it.
for p in parts.values(): p.location=(0,0,0); p.rotation_euler=(0,0,0)
bpy.ops.export_scene.gltf(filepath=str(ROOT/'apps/browser/src/wristed/models/instrument.glb'),export_format='GLB',export_yup=False,export_animations=False,export_cameras=False,export_lights=False)
print('Generated Blender source and GLB rigid instrument.')
