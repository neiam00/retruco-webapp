"""Build scenes and web models with blender -b -P build.py, optionally -- player."""
import bpy
import sys
from math import cos, exp, sin, pi, radians
from mathutils import Vector, Matrix, Quaternion
from pathlib import Path
from collections import defaultdict
from random import Random
from tempfile import TemporaryDirectory
from struct import pack
from zlib import crc32, compress

SRC = Path(__file__).resolve().parent
STATIC = SRC.parents[1] / 'static' / 'table3d'
STATIC.mkdir(exist_ok=True)
rng=Random(17)
parts=defaultdict(list)
bone_for=None
part='Environment'


def reset():
    global parts, bone_for, part
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version=0
    parts=defaultdict(list)
    bone_for=None
    part='Environment'


def mat(name, color, metal=0, rough=.8, glow=0):
    m=bpy.data.materials.new(name)
    m.diffuse_color=(*color,1)
    m.use_nodes=True
    node=m.node_tree.nodes.get('Principled BSDF')
    node.inputs['Base Color'].default_value=(*color,1)
    node.inputs['Roughness'].default_value=rough
    node.inputs['Metallic'].default_value=metal
    if glow:
        node.inputs['Emission Color'].default_value=(*color,1)
        node.inputs['Emission Strength'].default_value=glow
    return m


def tabletop_texture(name, width, height, field):
    # Keep procedural wood/cloth portable in glTF by encoding their repeating
    # swatches once. All scene sources retain the packed image inside Blender.
    def chunk(kind, data):
        return pack('>I',len(data))+kind+data+pack('>I',crc32(kind+data)&0xffffffff)
    rows=bytearray()
    for y in range(height):
        rows.append(0)
        for x in range(width):
            rows.extend(max(0,min(255,round(v))) for v in field(x,y,width,height))
    png=(bytes.fromhex('89504e470d0a1a0a')+chunk(b'IHDR',pack('>IIBBBBB',width,height,8,2,0,0,0))
         +chunk(b'IDAT',compress(bytes(rows),8))+chunk(b'IEND',b''))
    with TemporaryDirectory() as directory:
        swatch=Path(directory)/(name+'.png')
        swatch.write_bytes(png)
        im=bpy.data.images.load(str(swatch))
        im.name=name
        im.pack()
    return im


def mapped(m,image):
    tree=m.node_tree
    node=tree.nodes.new('ShaderNodeTexImage')
    node.image=image
    tree.links.new(node.outputs['Color'],tree.nodes.get('Principled BSDF').inputs['Base Color'])


def table_uv(ob,rotate=0,offset=0,repeat=1,barrel=None):
    uv=ob.data.uv_layers.new(name='Timber and baize')
    ob.data.update()
    for face in ob.data.polygons:
        if barrel:
            from math import atan2
            vcoords=[]
            for idx in face.loop_indices:
                x,y,z=ob.data.vertices[ob.data.loops[idx].vertex_index].co
                u=(atan2(y-barrel[1],x-barrel[0])/(2*pi))%1
                vcoords.append((idx,z*2.7+offset,u))
            # Unwrap the seam on a single stave only.
            seam=max(v[2] for v in vcoords)-min(v[2] for v in vcoords)>.5
            for idx,v,u in vcoords:
                uv.data[idx].uv=(v,(u+int(seam and u<.5))*1.7)
            continue
        nx,ny,nz=face.normal
        for idx in face.loop_indices:
            x,y,z=ob.data.vertices[ob.data.loops[idx].vertex_index].co
            if rotate%2: x,y=y,x; nx,ny=ny,nx
            if abs(nz)>.55: u,v=x,y
            elif abs(nx)>.55: u,v=y,z
            else: u,v=x,z
            uv.data[idx].uv=(u*repeat+offset,v*repeat)
            if rotate%2: nx,ny=ny,nx
    return ob


def mesh(name,verts,faces,m):
    data=bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(m)
    ob=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(ob)
    if bone_for:
        group=ob.vertex_groups.new(name=bone_for)
        group.add(range(len(verts)),1,'REPLACE')
    parts[part].append(ob)
    return ob


def ringmesh(name,rings,m):
    n=len(rings[0])
    faces=[tuple(reversed(range(n)))]
    for i in range(len(rings)-1):
        for j in range(n):
            a=i*n+j; b=i*n+(j+1)%n
            faces.append((a,b,b+n,a+n))
    faces.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    return mesh(name,[pt for r in rings for pt in r],faces,m)


def box(name,p,size,m,bevel=0):
    x,y,z=p; w,d,h=[v/2 for v in size]
    c=min(bevel,w*.4,d*.4)
    outline=[(-w+c,-d),(w-c,-d),(w,-d+c),(w,d-c),(w-c,d),(-w+c,d),(-w,d-c),(-w,-d+c)] if c else [(-w,-d),(w,-d),(w,d),(-w,d)]
    return ringmesh(name,[[(x+a,y+b,z+t) for a,b in outline] for t in (-h,h)],m)


def oval(name,p,size,m,n=10):
    x,y,z=p; w,d,h=size
    rings=[]
    for zz,rr in [(-1,.17),(-.76,.7),(-.18,1),(.52,.88),(.89,.55),(1,.19)]:
        rings.append([(x+w*rr*cos(2*pi*i/n),y+d*rr*sin(2*pi*i/n),z+h*zz) for i in range(n)])
    return ringmesh(name,rings,m)


def tube(name,a,b,r,s,m,n=8):
    a,b=Vector(a),Vector(b)
    axis=(b-a).normalized()
    ref=Vector((0,0,1)) if abs(axis.z)<.9 else Vector((0,1,0))
    u=axis.cross(ref).normalized()
    v=axis.cross(u)
    return ringmesh(name,[[tuple(p+(u*cos(2*pi*i/n)+v*sin(2*pi*i/n))*rad) for i in range(n)] for p,rad in ((a,r),(b,s))],m)


def merge(label,objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    ob=objects[0]; bpy.context.view_layer.objects.active=ob
    if len(objects)>1: bpy.ops.object.join()
    ob.name=label
    return ob


def preview_hand(rig):
    # Print props belong only to the editable player scene. The browser deals
    # its own state-backed cards onto the same two grip points.
    atlas=bpy.data.images.load(str(STATIC/'cards.webp'))
    atlas.name='Hold preview – shared print atlas'
    atlas.pack()
    printing=mat('Preview card ink',(1,1,1),0,.79)
    mapped(printing,atlas)
    edge=mat('Preview card edge',(.84,.82,.70))
    scale=.76
    # Compose the same three-card rest hold as the renderer. The card stack
    # follows the support hand when the original actions are previewed.
    pinch_x=117*.19*scale
    pinch_h=-177*.18*scale
    outer_roll=-.17
    center_height=7*scale-pinch_x*sin(outer_roll)-pinch_h*cos(outer_roll)
    for side,sign in (('L',1),('R',-1)):
        grip=rig.data.bones['Grip.'+side].head_local
        forearm=rig.pose.bones['Forearm.'+side]
        hand=rig.pose.bones['Hand.'+side]
        x=64*scale+pinch_x*cos(outer_roll)-pinch_h*sin(outer_roll)
        target=on_card(sign*x,0,-sign*.8)*.001
        rotation=Quaternion(PAPER_FRONT,sign*.17)
        wrist=target+rotation@(hand.bone.head_local-grip)
        elbow=forearm.bone.head_local
        bend=(hand.bone.head_local-elbow).rotation_difference(wrist-elbow)
        forearm.matrix=Matrix.Translation(elbow)@bend.to_matrix().to_4x4()@Matrix.Translation(-elbow)@forearm.bone.matrix_local
        bpy.context.view_layer.update()
        hand.matrix=Matrix.Translation(target)@rotation.to_matrix().to_4x4()@Matrix.Translation(-grip)@hand.bone.matrix_local
    bpy.context.view_layer.update()
    for number,tile in enumerate((20,12,30)):
        spread=number-1
        roll=-spread*.17
        half_w,half_h,r=117*scale/2,177*scale/2,4.8*scale
        border=[]
        for x,z,start in [(half_w-r,half_h-r,0),(-half_w+r,half_h-r,90),(-half_w+r,-half_h+r,180),(half_w-r,-half_h+r,270)]:
            for j in range(5):
                a=radians(start+j*90/4)
                border.append((x+r*cos(a),z+r*sin(a)))
        n=len(border)
        verts=[]
        for depth in (-.34,.34):
            for x,h in border:
                xx=spread*64*scale+x*cos(roll)-h*sin(roll)
                hh=center_height-abs(spread)*7*scale+x*sin(roll)+h*cos(roll)
                verts.append(tuple(on_card(xx,hh,depth-spread*.8)*.001))
        faces=[tuple(range(n)),tuple(reversed(range(n,2*n)))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        ob=mesh('Preview hand '+str(number+1),verts,faces,printing)
        ob.data.materials.append(edge)
        uv=ob.data.uv_layers.new(name='Print registration')
        for poly in ob.data.polygons:
            if poly.index>1:
                poly.material_index=1
                continue
            stamp=40 if poly.index==0 else tile
            for loop_index in poly.loop_indices:
                x,z=border[ob.data.loops[loop_index].vertex_index%n]
                u=(x/half_w+1)*.5
                if poly.index==1: u=1-u
                v=(z/half_h+1)*.5
                uv.data[loop_index].uv=((stamp%8*256+4+u*248)/2048,1-(stamp//8*384+4+(1-v)*376)/2304)
        # Parenting through the bone's rest transform avoids moving the props
        # when Blender is opened or when a library clip is previewed.
        ob.parent=rig;ob.parent_type='BONE';ob.parent_bone='Grip.L'
        bpy.context.view_layer.update()
        ob.matrix_parent_inverse=ob.matrix_world.inverted()
        ob['studio_preview']=True


def save(name, **texture_settings):
    bpy.ops.export_scene.gltf(filepath=str(STATIC/(name+'.glb')),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_cameras=False,export_lights=False,**texture_settings)
    # Studio camera and lights remain editable in the .blend. The runtime
    # owns lighting and camera placement to match the active seat.
    character=name=='player'
    if character:
        preview_hand(bpy.data.objects['PlayerRig'])
        for ob in bpy.context.scene.objects:
            if ob.name.startswith(('Body1','Body2','Body3','Head1','Head2','Head3','HairPart','HairWave','HairCurly','Hat','Glasses')):
                ob.hide_set(True)
                ob.hide_render=True
    target=Vector((0,0,.85 if character else .92))
    cam_position=(.78,-2.40,1.29) if character else (1.55,-2.6,1.7)
    bpy.ops.object.camera_add(location=cam_position)
    cam=bpy.context.object;cam.name='Studio camera';cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.lens=46 if character else 36
    scene=bpy.context.scene;scene.camera=cam
    scene.render.engine='CYCLES';scene.cycles.samples=24
    scene.render.resolution_percentage=100;scene.render.resolution_x=960;scene.render.resolution_y=720
    for label,loc,power,color,size in [('Lamp',((-.45,-.65,1.98) if character else (0,0,1.89)),62,(1,.79,.56),.45),('Night fill',(-1.5,-1.3,1.75),45,(.56,.68,.89),1.8),('Rim',(1.4,1.5,2.2),50,(1,.64,.37),1.1)]:
        bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.name=label
        light.data.energy=power;light.data.color=color;light.data.shape='DISK';light.data.size=size
        light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.select_all(action='DESELECT')
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.overlay.show_overlays=False
            area.spaces.active.shading.color_type='MATERIAL'
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC/(name+'.blend')),compress=True)



def room_uv(ob, horizontal, vertical, origin):
    """Register a nonrepeating baked field to the dimensions of the room mesh."""
    # The room's objects are joined before export. A shared layer name keeps
    # every material's coordinates in glTF's first texture coordinate set.
    uv=ob.data.uv_layers.new(name='Timber and baize')
    u,v=Vector(horizontal),Vector(vertical)
    for loop in ob.data.loops:
        point=ob.data.vertices[loop.vertex_index].co
        uv.data[loop.index].uv=(u.dot(point)+origin[0],v.dot(point)+origin[1])
    return ob


def room():
    global part
    reset()
    timber=[mat('Honey wood '+str(i),c) for i,c in enumerate([(.45,.204,.065),(.54,.27,.087),(.39,.16,.046),(.48,.224,.074)])]
    ink=mat('End grain',(.25,.102,.034)); felt=mat('Bottle green baize',(.028,.18,.09))
    rim=mat('Polished brass',(.42,.27,.10),.6,.32); dark=mat('Cup well',(.032,.023,.015))
    iron=mat('Gunmetal frame',(.065,.065,.055),.65,.45)
    woods=[mat('Floorboard '+str(i),(.092+i*.010,.067+i*.007,.050+i*.005)) for i in range(4)]
    wall=mat('Midnight plaster',(.044,.055,.054)); wainscot=mat('Panel mouldings',(.13,.16,.15))
    grain_rng=Random(8719)
    def wood_field(x,y,w,h):
        u,v=x/w,y/h
        bend=.009*sin(2*pi*u)+.004*sin(6*pi*u+3.8*sin(2*pi*v))
        t=v+bend+.0028*sin(10*pi*u+v*4*pi)
        wave=sin(54*pi*t)+.48*sin(108*pi*t)+.21*sin(216*pi*t)
        pores=max(0,sin(270*pi*t+.24*sin(8*pi*u))-.77)*19
        variation=8.0*wave-pores+3.2*sin(12*pi*u+2*pi*v)+grain_rng.uniform(-1.7,1.7)
        return (161+variation,114+variation*.91,68+variation*.64)
    def felt_field(x,y,w,h):
        u,v=2*(x+.5)/w-1,2*(y+.5)/h-1
        # The shade feathers across the cloth. The raised rails occlude the
        # last couple of centimetres, including on phones without shadows.
        beam=exp(-1.9*(u*u+v*v))
        rim=1-.17*exp(-(1-max(abs(u),abs(v)))/.035)
        nap=grain_rng.uniform(-3,3)+1.5*sin((x+y)*pi*.5)+.8*cos((x-y)*pi*.5)
        return ((22+25*beam+nap*.55)*rim,(73+35*beam+nap)*rim,(56+27*beam+nap*.76)*rim)
    def plaster_field(x,y,w,h):
        u,v=(x+.5)/w,1-(y+.5)/h
        spill=exp(-((u-.54)/.35)**2-((v-.46)/.40)**2)
        # Slightly warmer plaster where the lamp spills above the woodwork.
        panel=.90 if v<.285 else 1-.13*exp(-(v-.285)/.032)
        grain=grain_rng.uniform(-1.4,1.4)
        return tuple((base+lift*spill+grain)*panel for base,lift in ((70,49),(87,52),(90,47)))
    wood_image=tabletop_texture('Quarter-sawn honey oak',512,256,wood_field)
    cloth_image=tabletop_texture('Baize under the pendant',320,320,felt_field)
    plaster_image=tabletop_texture('Plaster and panel light',128,80,plaster_field)
    for material in timber: mapped(material,wood_image)
    mapped(wall,plaster_image)
    mapped(felt,cloth_image)
    felt.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.98
    room_uv(box('Felt playing surface',(0,0,.731),(1.204,1.204,.058),felt,.012),
            (1/1.204,0,0),(0,1/1.204,0),(.5,.5))
    def turn(x,y,n):
        for _ in range(n): x,y=-y,x
        return x,y
    for i in range(4):
        def section(points,z0,z1,m,name):
            return table_uv(ringmesh(name,[[(*turn(x,y,i),z) for x,y in points] for z in (z0,z1)],m),i,.14*i,1.7)
        yo,yi=-.668,-.600
        section([(-.668,yo),(.668,yo),(.60,yi),(-.60,yi)],.685,.774,timber[i],'Miter rail')
        section([(-.740,-.766),(.740,-.766),(.749,-.762),(.758,-.758),(.641,-.641),(-.641,-.641),(-.758,-.758),(-.749,-.762)],.666,.688,timber[(i+1)%4],'Wide lower ledge')
        for x in [-.27,.27]:
            xy=turn(x,-.686,i)
            table_uv(box('Rail cleat',(*xy,.72),((.024,.04,.066) if i%2==0 else (.04,.024,.066)),timber[2],.003),i,.12+i*.1,1.7)
        section([(-.27,-.735),(.27,-.735),(.27,-.70),(-.27,-.70)],.688,.70,timber[2],'Tile rest')
        cx,cy=turn(.697,-.697,i)
        # Lathed open barrels, each standing above the wooden ledge at an actual corner.
        count=24
        profile=[(.057,.688),(.061,.694),(.064,.747),(.063,.797),(.061,.802),(.052,.802),(.050,.795),(.049,.710)]
        rows=[[(cx+r*cos(j*2*pi/count),cy+r*sin(j*2*pi/count),z) for j in range(count)] for r,z in profile]
        for row in range(len(rows)-1):
            for j in range(count):
                jj=(j+1)%count
                table_uv(mesh('Barrel stave',[rows[row][j],rows[row][jj],rows[row+1][jj],rows[row+1][j]],[(0,1,2,3)],timber[(j//3)%4] if row<4 else ink if row==6 else timber[1]),offset=.12*i,barrel=(cx,cy))
        table_uv(tube('Cup bottom',(cx,cy,.706),(cx,cy,.710),.049,.049,timber[2],24),repeat=2)
        for z,r in [(.72,.0628),(.761,.0644)]:
            for j in range(count):
                aa=j*2*pi/count; ab=(j+1)*2*pi/count
                mesh('Burnished hoop',[(cx+r*cos(a),cy+r*sin(a),h) for a,h in [(aa,z),(ab,z),(ab,z+.0028),(aa,z+.0028)]],[(0,1,2,3)],ink)
        for x in [-.50,0,.50]:
            px,py=turn(x,-.634,i)
            tube('Rail rivet',(px,py,.7741),(px,py,.775),.006,.006,rim,12)
        for k in range(7):
            y=yo+.007+k*.008
            start=-.54+rng.random()*.30; end=.16+rng.random()*.12
            # Tapered growth lines parallel to each rail.
            mesh('Grain', [(*turn(x,yy,i),.77415) for x,yy in [(start,y),(start+.08,y+.0014),(end,y+.001),(end+.04,y),(start+.08,y+.0002)]],[(0,1,2,3,4)],ink)
        ax,ay=turn(0,-.633,i)
        table_uv(box('Skirt',(ax,ay,.672),((1.27,.045,.08) if i%2==0 else (.045,1.27,.08)),timber[(i+2)%4]),i,.07*i,1.7)
    # The photo shows two folding wooden trestles crossing under the apron.
    for x in (-.49,.49):
        for sign in (-1,1):
            a=Vector((x+sign*.019,sign*.48,.036))
            b=Vector((x+sign*.019,-sign*.48,.661))
            length=(b-a).length
            rail=box('Oak trestle',(0,0,0),(.032,.052,length),timber[1],.004)
            rot=(b-a).to_track_quat('Z','Y').to_matrix()
            for vertex in rail.data.vertices:
                vertex.co=rot@vertex.co+(a+b)*.5
            table_uv(rail,1,.19*sign,1.7)
            box('Foot',(a.x,a.y,.023),(.042,.062,.022),dark,.005)
            box('Hinge plate',b,(.059,.072,.038),iron,.004)
        tube('Trestle pivot',(x-.042,0,.347),(x+.042,0,.347),.014,.014,rim,12)
    for sign in (-1,1):
        table_uv(box('Stretcher',(0,sign*.31,.15),(.99,.031,.045),timber[2],.003),repeat=1.7)
    part='Room'
    for i in range(28):
        box('Oak floorboard',(-3.915+i*.29,0,-.037),(.286,8,.068),woods[i%4])
    for side in (-1,1):
        room_uv(box('Back wall',(0,side*4,1.6),(8,.09,3.2),wall),
                (side/8,0,0),(0,0,1/3.2),(.5,0))
        room_uv(box('Side wall',(side*4,0,1.6),(.09,8,3.2),wall),
                (0,-side/8,0),(0,0,1/3.2),(.5,0))
        for h in (.08,.87,.93):
            box('Wall trim',(0,side*3.94,h),(8,.075,.045),wainscot)
            box('Wall trim',(side*3.94,0,h),(.075,8,.045),wainscot)
        for k in range(-5,6):
            box('Panel batten',(k*.67,side*3.94,.47),(.037,.03,.77),wainscot)
            box('Panel batten',(side*3.94,k*.67,.47),(.03,.037,.77),wainscot)
    part='Pendant'
    shade=mat('Deep green enamel',(.055,.096,.067),.38,.33)
    milk=mat('Opal bulb',(1,.78,.49),0,.35,2.4)
    tube('Braided cord',(0,0,2.14),(0,0,3.20),.006,.006,dark)
    tube('Brass cap',(0,0,2.10),(0,0,2.18),.035,.023,rim,20)
    for z0,z1,r0,r1 in [(1.93,1.945,.225,.225),(1.945,2.035,.225,.108),(2.035,2.105,.108,.045)]:
        tube('Spun shade',(0,0,z0),(0,0,z1),r0,r1,shade,32)
    tube('Light diffuser',(0,0,1.927),(0,0,1.931),.216,.216,milk,32)
    for label,objects in parts.items(): merge(label,objects)
    # Keep the lossless swatches packed in Blender. Opaque room textures can
    # travel as JPEGs inside the GLB without another browser request.
    save('room',export_image_format='JPEG',export_image_quality=92)



# Card-space coordinates in millimetres. Height runs up the print and depth
# points toward the seated player. Both thumb pads straddle the grip markers.
PAPER_UP=Vector((0,-sin(.40),cos(.40)))
PAPER_FRONT=Vector((0,cos(.40),sin(.40)))
PAPER_ORIGIN=Vector((0,-372,899))

def on_card(x,height,depth):
    return PAPER_ORIGIN+Vector((x,0,0))+PAPER_UP*height+PAPER_FRONT*depth


def model_hand(side, sign, skin, nail, add_bone):
    """Loft the forearm, metacarpals and five distinct flexed digit chains."""
    import bmesh
    from math import exp
    from mathutils.bvhtree import BVHTree
    from mathutils.kdtree import KDTree
    global bone_for
    bone_for=None
    surfaces=[]
    centre_lines={}
    left=side=='L'

    def ease(t):
        t=max(0,min(1,t))
        return t*t*(3-2*t)

    def cup_corner(p):
        # Carry the heel of the palm and thumb web around the outer lower
        # corner. The distal pads and the wrist stay in their own planes.
        q=p-PAPER_ORIGIN
        h=q.dot(PAPER_UP);depth=q.dot(PAPER_FRONT)
        w=ease((q.x-58)/23)*ease((12-h)/26)*exp(-(depth/24)**2)
        return p+(Vector((7.5,0,0))-PAPER_UP*7)*w

    def sweep(label, points, reference, depth_axis=False):
        # Smooth center lines with independently authored widths and depths.
        # For the digits the short oval axis tracks the normal of the paper.
        coords=[Vector(row[:3]) for row in points]
        centers=[]; radii=[]
        for j in range(len(points)-1):
            a,b,c,d=(coords[max(j-1,0)],coords[j],coords[j+1],coords[min(j+2,len(points)-1)])
            for step in range(3):
                t=step/3
                centers.append((2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)*.5)
                radii.append(tuple(points[j][i]+(points[j+1][i]-points[j][i])*t for i in (3,4)))
        centers.append(coords[-1]); radii.append(points[-1][3:5])
        rings=[]
        for i,(center,(width,depth)) in enumerate(zip(centers,radii)):
            tangent=(centers[min(i+1,len(centers)-1)]-centers[max(i-1,0)]).normalized()
            ref=reference if abs(reference.dot(tangent))<.96 else Vector((1,0,0))
            projected=(ref-ref.dot(tangent)*tangent).normalized()
            across=projected.cross(tangent) if depth_axis else projected
            normal=tangent.cross(across)
            rings.append([tuple((center+across*width*cos(a*pi/8)+normal*depth*sin(a*pi/8))*.001) for a in range(16)])
        surfaces.append(ringmesh(label,rings,skin))
        centre_lines[label]=[(cup_corner(p)*.001,max(r)*.001) for p,r in zip(centers,radii)]

    def paper_rows(rows):
        return [(*on_card(*row[:3]),*row[3:]) for row in rows]

    # The open fans sit between a thumb and the volar pads. The left wrist
    # rises under its corner; the right crosses the fan more horizontally.
    # The shafts are canted together, with the smaller fingers set progressively
    # lower in the ulnar border of the palm.
    if left:
        knuckles=[(108,1,-11),(95,-10,-14),(82,-22,-15),(72,-36,-14)]
        pips=[(90,23,-9),(70,11,-11),(57,-1,-12),(55,-20,-13)]
        dips=[(76,37,-6.5),(54,26,-7.0),(40,12,-7.1),(43,-11,-7.1)]
        tips=[(65,43,-4.6),(43,32,-4.6),(29,18,-4.6),(33,-7,-4.3)]
        heel=(107,-46,28); palm=(96,-28,0); bridge=(92,-22,-11)
        radial=(Vector((.68,0,0))+PAPER_UP*.74).normalized()
        thumb=[(113,-44,27),(102,-33,23),(81,-15,17),(64,-2,12),(55,4,8.5),(44,7,7.2),(38,7.5,6.3),(35,7,5.6)]
    else:
        knuckles=[(96,4,-12),(91,-13,-15),(88,-31,-15),(88,-48,-14)]
        pips=[(77,23,-12),(66,1,-13),(60,-19,-13),(68,-42,-14)]
        dips=[(55,26,-7.2),(45,4,-7.45),(42,-16,-7.3),(53,-36,-8.0)]
        tips=[(42,24,-4.7),(30,5,-4.7),(29,-14,-4.7),(41,-34,-4.9)]
        heel=(111,-48,30); palm=(99,-30,0); bridge=(92,-23,-11)
        radial=(Vector((.12,0,0))+PAPER_UP*.99).normalized()
        thumb=[(112,-41,28),(99,-28,24),(80,-15,16),(62,-6,11),(53,-3,8.4),(43,0,7.2),(36,1,6.3),(33,1,5.3)]

    palm_rows=[
        (222,18,823,45,43),(218,3,824,48,43),(203,-42,831,45,39),
        (182,-98,833,39,31),(154,-173,837,31,24),(134,-237,842,25,19),
        (121,-274,850,22,16),
        (*on_card(*heel),27,17),(*on_card(*palm),33,18),
        (*on_card(*bridge),33,13)]
    # A short final section rounds the top of the metacarpal arch, leaving
    # the individually modelled first phalanges to carry its silhouette.
    palm_rows.append((*on_card(bridge[0]-3,bridge[1]+1,bridge[2]-2),26,8))
    sweep('Palm',palm_rows,radial)
    # Fan the four metacarpals through the palm and into their own rounded
    # knuckles. The intervening valleys and tapered web spaces stay continuous.
    for i,(x,h,d) in enumerate(knuckles):
        axis=(i-1.5)
        start=(heel[0]-axis*3,heel[1]-axis*5,heel[2]+1)
        mid=(palm[0]+(x-palm[0])*.63,palm[1]+(h-palm[1])*.65,palm[2]-3)
        sweep('Metacarpal '+str(i),paper_rows([
            (*start,8,6.8),(*mid,11.2-i*.37,9.5), (x+1.5,h-1.5,d+.7,10.3-i*.6,8.8-i*.46),
            (x-3,h+2,d,8.4-i*.52,7.7-i*.4)]),PAPER_FRONT,True)

    names=('Index','Middle','Ring','Little')
    sizes=(1,1.04,.95,.79)
    digits={}
    for i,name in enumerate(names):
        mcp,pip,dip,tip=map(Vector,(knuckles[i],pips[i],dips[i],tips[i]))
        dip.z-=1.0;tip.z-=1.3
        start=mcp+(mcp-pip)*.23+Vector((0,-1,3.2))
        shaft=mcp.lerp(pip,.48); shaft.z-=1.0
        second=pip.lerp(dip,.49); second.z-=.45
        pad=dip.lerp(tip,.63); pad.z=-5.75*sizes[i]-1.7
        cap=dip.lerp(tip,.85); cap.z=-4.75*sizes[i]-1.7
        profile=[(start,8.6,7.5),(mcp,9.2,8.2),(shaft,8.2,7.05),
                 (pip,8.55,7.45),(second,7.45,6.55),(dip,7.50,6.55),
                 (pad,7.25,5.75),(cap,5.75,4.75),(tip,2.0,1.7)]
        digits[name]=paper_rows([(*p,w*sizes[i],d*sizes[i]) for p,w,d in profile])
    digits['Thumb']=paper_rows([(p[0],p[1],p[2]+1.55,w,d) for p,(w,d) in zip(thumb,
        [(10,9),(14,12),(12,10),(10.5,8.8),(10.3,8.1),(10,7.6),(7.1,6.0),(2.4,2)])])
    for name,points in digits.items():
        sweep(name,points,PAPER_FRONT,True)
    # Thenar eminence and the saddle of the thumb web. The triangle withdraws
    # around the lower outer corner of the paper to leave an open pinch.
    if left:
        sweep('Hypothenar',paper_rows([(109,-54,31,9,10),(96,-48,14,12,10),
                                     (86,-43,-1,12,9),(78,-38,-12,9,7)]),radial)
    sweep('Thenar',paper_rows([(*heel,8.5,7.5),(106,-37,24,15,12),
                              (95,-25,21,13,10),(85,-19,19,8.6,7.2)]),radial)
    sweep('Thumb web',paper_rows([(114,-40,26,8,8),(110,-30,16,12,8),
                                  (106,-19,9,10,6),(103,-7,1,6.5,4.3),
                                  (102,-3,-4,3.8,3.1)]),radial)

    hand=merge('Hand sculpture '+side,surfaces)
    for item in surfaces: parts[part].remove(item)
    hand.data.remesh_voxel_size=.00135
    bpy.ops.object.voxel_remesh()
    def apply(kind,name,**settings):
        mod=hand.modifiers.new(name,kind)
        for key,value in settings.items(): setattr(mod,key,value)
        bpy.ops.object.modifier_apply(modifier=mod.name)
    apply('SMOOTH','Blend the webbing',factor=.68,iterations=5)
    for v in hand.data.vertices: v.co=cup_corner(v.co*1000)*.001
    hand.data.update()
    # A dorsal knuckle has a small ridge between two short transverse skin
    # creases. Concentrate these folds on the extensor side of each PIP.
    folds=[]
    for name,points in digits.items():
        j=4 if name=='Thumb' else 3
        center=cup_corner(Vector(points[j][:3]))*.001
        axis=(Vector(points[j+1][:3])-Vector(points[j-1][:3])).normalized()
        face=PAPER_FRONT if name=='Thumb' else -PAPER_FRONT
        dorsal=(face-axis*face.dot(axis)).normalized()
        folds.append((center,axis,dorsal,points[j][3]*.001))
    for v in hand.data.vertices:
        for center,axis,dorsal,r in folds:
            q=v.co-center
            if q.length_squared>(r+.003)**2: continue
            a=q.dot(axis)
            facing=max(0,v.normal.dot(dorsal))
            wrinkle=.00036*exp(-(a/.0016)**2)-.00057*exp(-((abs(a)-.00255)/.00115)**2)
            v.co+=v.normal*(wrinkle*facing*facing)

    triangle_budget=2700
    hand.data.calc_loop_triangles()
    apply('DECIMATE','Game surface',ratio=min(1,triangle_budget/len(hand.data.loop_triangles)))
    # Catch a pad fused across an interdigital space, a pinhole, or a loose
    # shell left by the voxel union before exporting the production mesh.
    surface=bmesh.new()
    surface.from_mesh(hand.data)
    pending=[next(iter(surface.verts))]
    connected=set(pending)
    while pending:
        vertex=pending.pop()
        for edge in vertex.link_edges:
            neighbor=edge.other_vert(vertex)
            if neighbor not in connected:
                connected.add(neighbor);pending.append(neighbor)
    closed=(len(connected)==len(surface.verts)
            and all(edge.is_manifold for edge in surface.edges)
            and len(surface.verts)-len(surface.edges)+len(surface.faces)==2)
    surface.free()
    if not closed:
        raise ValueError(f'{side} hand has a fused finger, loose shell or opening')
    for face in hand.data.polygons: face.use_smooth=True
    for group in list(hand.vertex_groups): hand.vertex_groups.remove(group)
    groups={name:hand.vertex_groups.new(name=name+'.'+side)
            for name in ('Forearm','Hand','Thumb','Fingers',*(n+'Curl' for n in names))}
    def sided(p):
        return (sign*p.x,p.y,p.z)
    for name in names:
        pip,dip=(cup_corner(Vector(digits[name][i][:3]))*.001 for i in (3,5))
        add_bone(name+'Curl.'+side,sided(pip),sided(dip),'Fingers.'+side)
    tree=KDTree(sum(len(centre_lines[n]) for n in digits))
    chain=[]
    for name,points in digits.items():
        for j,(pt,r) in enumerate(centre_lines[name]):
            tree.insert(pt,len(chain));chain.append((name,j/3,r))
    tree.balance()
    for v in hand.data.vertices:
        _pt,idx,dist=tree.find(v.co)
        name,t,r=chain[idx]
        distal=ease(t/1.7)*ease((r+.012-dist)/.013)
        wrist=ease((-.248-v.co.y)/.059)
        finger=wrist*distal
        groups['Forearm'].add([v.index],1-wrist,'REPLACE')
        groups['Hand'].add([v.index],wrist-finger,'REPLACE')
        if name=='Thumb':
            groups['Thumb'].add([v.index],finger,'REPLACE')
        else:
            curl=ease((t-2.45)/1.1)
            groups['Fingers'].add([v.index],finger*(1-curl),'REPLACE')
            groups[name+'Curl'].add([v.index],finger*curl,'REPLACE')
    parts[part].append(hand)

    def mirror(obj):
        if sign<0:
            obj.data.transform(Matrix.Diagonal(Vector((-1,1,1,1))))
            obj.data.flip_normals()
    skin_surface=BVHTree.FromPolygons([v.co for v in hand.data.vertices],
                                      [tuple(poly.vertices) for poly in hand.data.polygons])
    mirror(hand)
    # Wide cuticles and a rounded free edge. Project each nail over the actual
    # distal pad so grazing angles see a shallow keratin plate on the skin.
    for name,points in digits.items():
        thumb=name=='Thumb'
        start=cup_corner(Vector(points[-4][:3])); end=cup_corner(Vector(points[-1][:3]))
        direction=(end-start).normalized()
        face=PAPER_FRONT if thumb else -PAPER_FRONT
        normal=(face-direction*face.dot(direction)).normalized()
        across=direction.cross(normal).normalized()
        half_width={'Thumb':6.7,'Index':5.55,'Middle':5.75,'Ring':5.15,'Little':4.10}[name]
        length={'Thumb':13.0,'Index':10.6,'Middle':11.4,'Ring':10.5,'Little':8.2}[name]
        center=end-direction*(length*.59+1.1)
        outline=[(-.50,.49),(-.43,.76),(-.31,.93),(-.15,.99),(0,1),(.17,.99),(.32,.94),(.43,.76),(.50,.46)]
        columns=7
        verts=[]
        for u,w in outline:
            for col in range(columns):
                f=2*col/(columns-1)-1
                point=(center+direction*(u*length)+across*(f*w*half_width))*.001
                hit,surface_normal,_,_=skin_surface.ray_cast(point+normal*.014,-normal,.024)
                if hit is None: hit,surface_normal,_,_=skin_surface.find_nearest(point+normal*.005)
                lift=.00047+.00025*(1-f*f)*(1-3.1*u*u)
                verts.append(tuple(hit+surface_normal*lift))
        quads=[]
        for row in range(len(outline)-1):
            for col in range(columns-1):
                ix=row*columns+col
                quads.append((ix,ix+1,ix+columns+1,ix+columns))
        bone_for=('Thumb' if thumb else name+'Curl')+'.'+side
        plate=mesh(name+' nail '+side,verts,quads,nail)
        for face in plate.data.polygons: face.use_smooth=True
        mirror(plate)
    bone_for=None


def player():
    global bone_for,part
    reset()
    nail=mat('Nail',(.75,.474,.383),rough=.50)
    skin=mat('Skin',(.58,.307,.162)); hair=mat('Hair',(.060,.032,.019))
    shirt=mat('Shirt',(.30,.40,.34)); vest=mat('Vest',(.112,.154,.138)); trouser=mat('Trousers',(.088,.104,.106))
    sole=mat('Boot leather',(.105,.064,.045)); chair=mat('Chair',(.23,.121,.067))
    eye=mat('Ivory',(.88,.80,.62)); pupil=mat('Ink',(.024,.022,.020)); rose=mat('Tongue pink',(.58,.18,.14))
    brass=mat('Buttons',(.47,.33,.14),.5,.4); hat=mat('Hat wool',(.18,.145,.11))
    bones={}
    def add(name,a,b,parent=None): bones[name]=(a,b,parent)
    add('Pelvis',(0,0,.46),(0,0,.67))
    add('Chest',(0,0,.67),(0,0,1.115),'Pelvis')
    add('Head',(0,0,1.15),(0,0,1.43),'Chest')
    add('Jaw',(0,-.04,1.22),(0,-.095,1.20),'Head')
    add('Tongue',(0,-.096,1.205),(0,-.14,1.205),'Jaw')
    for side,k in [('L',1),('R',-1)]:
        add('Eye.'+side,(k*.048,-.103,1.304),(k*.048,-.133,1.304),'Head')
        add('Brow.'+side,(k*.05,-.108,1.332),(k*.065,-.120,1.333),'Head')
        add('Arm.'+side,(k*.174,0,1.04),(k*.222,.018,.824),'Chest')
        add('Forearm.'+side,(k*.222,.018,.824),(k*.112,-.276,.851),'Arm.'+side)
        add('Hand.'+side,(k*.112,-.276,.851),(k*.061,-.353,.885),'Forearm.'+side)
        add('Grip.'+side,(k*.045,-.372,.899),(k*.045,-.383,.931),'Hand.'+side)
        add('Thumb.'+side,(k*.082,-.319,.877),(k*.045,-.363,.898),'Hand.'+side)
        add('Fingers.'+side,(k*.077,-.354,.875),(k*.045,-.382,.900),'Hand.'+side)
    part='Chair'; bone_for=None
    box('Seat',(0,.012,.438),(.45,.42,.05),chair,.027)
    for k in (-1,1):
        for j in (-1,1):
            tube('Stile',(k*.215,j*.20,.012),(k*.183,j*.157,.44 if j<0 else .88),.018,.022,chair,6)
        box('Back slat',(k*.084,.165,.665),(.048,.029,.372),chair,.007)
    box('Top rail',(0,.158,.864),(.426,.044,.07),chair,.012)
    part='Clothing'; bone_for='Pelvis'
    for k in (-1,1):
        tube('Thigh',(k*.100,.032,.506),(k*.154,-.348,.465),.101,.077,trouser,9)
        tube('Shin',(k*.154,-.348,.465),(k*.153,-.307,.118),.077,.047,trouser,8)
        oval('Shoe',(k*.153,-.36,.081),(.065,.124,.049),sole)
        box('Outsole',(k*.153,-.35,.042),(.13,.229,.019),pupil,.025)
    for base,(width,depth,shoulder) in enumerate([(.172,.116,1.05),(.196,.137,1.042),(.157,.106,1.076),(.184,.125,1.066)]):
        part='Body'+str(base); bone_for='Chest'
        def bodyrings(coords,m):
            rings=[[(w*cos(i*pi/5),d*sin(i*pi/5),z) for i in range(10)] for z,w,d in coords]
            return ringmesh('Tailored cloth',rings,m)
        bodyrings([(.54,width*.86,depth),(.69,width*.94,depth),(.88,width,depth),(shoulder-.038,width*1.03,depth*.94),(shoulder,width*.65,depth*.74)],shirt)
        bodyrings([(.59,width*.90,depth*1.06),(.73,width*.98,depth*1.05),(.94,width*1.015,depth*1.03)],vest)
        for k in (-1,1):
            # Raised lapels and collars sit on the exterior of the faceted tunic.
            mesh('Vest lapel',[(k*.011,-depth*.992,.894),(k*.128,-depth*.78,.948),(k*.096,-depth*.75,shoulder-.016),(k*.061,-depth*.91,shoulder-.014)],[(0,1,2,3)],vest)
            mesh('Collar',[(k*.005,-depth*.99,1.024),(k*.043,-depth*1.008,.992),(k*.074,-depth*.89,shoulder-.002),(k*.043,-depth*.93,shoulder+.004)],[(0,1,2,3)],eye)
        for h in (.72,.79,.86):
            oval('Stud',(0,-depth*1.055,h),(.007,.006,.007),brass,6)
    part='Arms'
    for side,k in [('L',1),('R',-1)]:
        bone_for='Arm.'+side
        oval('Shoulder',(k*.16,0,1.012),(.070,.069,.050),shirt,9)
        tube('Shirt sleeve',(k*.159,0,1.023),(k*.223,.01,.845),.076,.059,shirt,9)
        tube('Rolled cuff',(k*.221,.010,.854),(k*.224,.013,.817),.065,.064,eye,8)
        model_hand(side, k, skin, nail, add)
    part='Features'; bone_for='Chest'
    tube('Neck',(0,0,1.038),(0,0,1.195),.058,.063,skin,9)
    for idx,(w,d,h,jaw) in enumerate([(.112,.102,.137,.68),(.127,.106,.130,.81),(.104,.104,.145,.58),(.116,.107,.144,.76)]):
        part='Head'+str(idx); bone_for='Head'
        rings=[]
        for z,f,offset in [(-1,jaw,-.02),(-.76,.83,-.011),(-.28,1,0),(.30,1.02,.008),(.8,.88,.01),(1,.56,.012)]:
            rings.append([(w*f*cos(i*pi/6),d*f*sin(i*pi/6)+offset,1.291+h*z) for i in range(12)])
        ringmesh('Faceted face',rings,skin)
        for k in (-1,1):
            oval('Ear',(k*w,.002,1.29),(.024,.027,.042),skin,8)
        oval('Nose',(0,-.109,1.28),(.023+idx*.002,.034,.037),skin,6)
        if idx in [1,3]:
            for k in (-1,1):
                oval('Sideburn',(k*w*.94,-.018,1.296),(.010,.022,.036),hair,6)
        if idx==3:
            for k in (-1,1):
                tube('Moustache',(k*.002,-.107,1.242),(k*.036,-.102,1.238),.009,.003,hair)
    part='Features'; bone_for='Jaw'
    oval('Lower lip',(0,-.096,1.222),(.036,.014,.010),skin,8)
    box('Lip line',(0,-.107,1.231),(.057,.003,.003),pupil,.001)
    bone_for='Tongue'; oval('Tongue',(0,-.086,1.224),(.022,.013,.007),rose,8)
    for side,k in [('L',1),('R',-1)]:
        bone_for='Eye.'+side
        oval('Sclera',(k*.047,-.096,1.306),(.029,.016,.013),eye,10)
        oval('Iris',(k*.046,-.111,1.305),(.009,.004,.010),pupil,8)
        oval('Catchlight',(k*.046-.002,-.115,1.308),(.002,.001,.002),eye,6)
        bone_for='Brow.'+side
        tube('Brow',(k*.024,-.108,1.327),(k*.077,-.092,1.335),.007,.009,hair,6)
    bone_for='Head'
    for style in ('HairCrop','HairWave','HairPart','HairCurly'):
        part=style
        # A fitted hairline rises in front and reaches the nape in back.
        rings=[]
        for height,w,d in [(0,.119,.109),(.40,.119,.108),(.82,.087,.082),(1,.035,.034)]:
            ring=[]
            for j in range(16):
                a=j*pi/8; z0=1.314-.053*sin(a)
                ring.append((w*cos(a),.009+d*sin(a),z0+(1.451-z0)*height))
            rings.append(ring)
        ringmesh('Hair cap',rings,hair)
        if style in ('HairWave','HairPart'):
            for j in range(5):
                x=(j-2)*.029
                oval('Swept lock',(x,-.061,1.401+.017*cos(j)),(.048,.035,.029 if style=='HairPart' else .047),hair,8)
        if style=='HairCurly':
            for j in range(18):
                a=j*pi/9
                oval('Curl',(.086*cos(a),.085*sin(a),1.40-.017*sin(a)),(.045,.042,.041),hair,7)
    for style in ['HatCap','HatBeret','HatBrim']:
        part=style
        oval('Crown',(.014 if style=='HatBeret' else 0,.005,1.422),(.15 if style=='HatBeret' else .127,.124,.065),hat,12)
        if style=='HatCap': oval('Bill',(0,-.094,1.402),(.105,.093,.012),vest,12)
        if style=='HatBrim':
            oval('Brim',(0,0,1.405),(.177,.161,.012),hat,16)
            tube('Hat band',(0,.005,1.408),(0,.005,1.425),.123,.124,vest,14)
    for style in ['GlassesSun','GlassesRound']:
        part=style
        for k in (-1,1):
            x=k*.048
            if style=='GlassesSun': oval('Tinted lens',(x,-.117,1.309),(.036,.006,.025),pupil,8)
            for j in range(12):
                a=j*pi/6; b=(j+1)*pi/6
                tube('Rim',(x+.034*cos(a),-.116,1.309+.022*sin(a)),(x+.034*cos(b),-.116,1.309+.022*sin(b)),.0025,.0025,brass,5)
            tube('Temple',(k*.08,-.113,1.312),(k*.119,.008,1.315),.0025,.0025,brass,5)
        tube('Bridge',(-.016,-.116,1.311),(.016,-.116,1.311),.0025,.0025,brass)
    meshes={label:merge(label,objs) for label,objs in parts.items()}
    arm=bpy.data.armatures.new('Player skeleton')
    rig=bpy.data.objects.new('PlayerRig',arm)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name,(a,b,parent) in bones.items():
        bone=arm.edit_bones.new(name); bone.head=a; bone.tail=b
        if parent: bone.parent=arm.edit_bones[parent]
        if 'Curl.' in name: bone.align_roll(PAPER_FRONT)
    bpy.ops.object.mode_set(mode='OBJECT')
    for label,ob in meshes.items():
        if label!='Chair':
            mod=ob.modifiers.new('Pose','ARMATURE'); mod.object=rig; ob.parent=rig
    actions={
        'idle':(2,-2,0,1,0,2), 'shuffle':(-24,16,-22,-3,10,2), 'cut':(-19,-7,-13,7,-13,4),
        'deal':(-46,16,-4,-14,15,4), 'draw':(-34,-14,4,-6,-11,7), 'fan':(-11,-18,-26,2,13,-4),
        'inspect':(-28,-27,-33,1,-14,12), 'select':(-32,9,-12,4,-15,8), 'play':(-55,9,-4,-4,19,7),
        'bid':(-45,-24,3,7,15,-8), 'accept':(-14,-4,-2,3,0,15), 'decline':(-16,22,-4,14,-12,-6),
        'fold':(-26,24,-20,-6,18,12), 'win':(-82,-26,-75,-8,15,-13), 'lose':(9,5,4,6,0,18),
        'look':(0,0,0,30,0,-3)}
    rig.animation_data_create()
    for name,(right,bend,left,yaw,roll,nod) in actions.items():
        action=bpy.data.actions.new(name); action.use_fake_user=True; rig.animation_data.action=action
        # Rotation axes live in armature space, so each joint works across rest rolls.
        def angle(bone,axis,deg):
            pb=rig.pose.bones[bone]
            rest=arm.bones[bone].matrix_local.to_quaternion()
            pb.rotation_quaternion=rest.inverted() @ Quaternion(axis,radians(deg)) @ rest
        duration=96 if name=='idle' else (54 if name in ['shuffle','inspect','win'] else 36)
        for frame,weight in [(1,0),(duration//3,.82),(duration//2,1),(int(duration*.72),.8),(duration,0)]:
            def key(bone,axis,value):
                angle(bone,axis,value*weight)
                rig.pose.bones[bone].keyframe_insert(data_path='rotation_quaternion',frame=frame,group=bone)
            key('Arm.R',(1,0,0),right*.58)
            key('Forearm.R',(1,0,0),right*.38)
            key('Hand.R',(0,1,0),bend)
            # Open the pinch on the releasing hand. The support hand retains
            # its curved fingers and keeps the remaining fan above the table.
            release={'deal':1,'play':1,'fold':.9,'cut':.45,'shuffle':.28,'win':.75}.get(name,0)
            key('Thumb.R',(0,0,1),-26*release)
            key('Fingers.R',(1,0,0),36*release)
            key('Arm.L',(1,0,0),left*.60)
            key('Forearm.L',(1,0,0),left*.37)
            key('Hand.L',(0,0,1),-bend*.4)
            key('Chest',(0,0,1),roll*.34)
            key('Head',(.7 if nod else 0,0,1 if yaw else .01),nod if abs(nod)>abs(yaw) else yaw)
    rig.animation_data.action=None
    for pb in rig.pose.bones: pb.matrix_basis=Matrix.Identity(4)
    # Keep variants available in exported glTF. Set their initial visibility in client.
    save('player')



def deck():
    # An editable print sheet in Blender. Every physical card carries the same
    # back and its own face, and uses the same layout as the browser atlas.
    reset()
    atlas=bpy.data.images.load(str(STATIC/'cards.webp'))
    atlas.name='Original Retruco baraja'
    atlas.pack()
    ink=mat('Card printing',(1,1,1),0,.72)
    texture=ink.node_tree.nodes.new('ShaderNodeTexImage');texture.image=atlas
    ink.node_tree.links.new(texture.outputs['Color'],ink.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    edge=mat('Cardstock edge',(.81,.78,.67))
    w,h,r=.032,.048,.003
    outline=[]
    for x,y,start in [(w-r,h-r,0),(-w+r,h-r,90),(-w+r,-h+r,180),(w-r,-h+r,270)]:
        for j in range(5):
            a=radians(start+j*90/4)
            outline.append((x+r*cos(a),y+r*sin(a)))
    n=len(outline)
    for idx in range(40):
        s,rk=divmod(idx,10)
        label=['Oros','Copas','Espadas','Bastos'][s]+' '+str([1,2,3,4,5,6,7,10,11,12][rk])
        verts=[(x,y,z) for z in (-.0002,.0002) for x,y in outline]
        faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        o=mesh(label,verts,faces,ink)
        o.data.materials.append(edge)
        o.location=((rk-4.5)*.070,(1.5-s)*.101,0)
        uv=o.data.uv_layers.new(name='Print registration')
        for poly in o.data.polygons:
            if poly.index>1:
                poly.material_index=1
                continue
            tile=40 if poly.index==0 else idx
            for loop_index in poly.loop_indices:
                x,y,_=verts[o.data.loops[loop_index].vertex_index]
                u=(x/w+1)*.5
                if poly.index==0: u=1-u
                v=(y/h+1)*.5
                uv.data[loop_index].uv=((tile%8*256+4+u*248)/2048,1-(tile//8*384+4+(1-v)*376)/2304)
    bpy.ops.object.camera_add(location=(0,0,.65))
    cam=bpy.context.object;cam.rotation_euler=(0,0,0);cam.data.type='ORTHO';cam.data.ortho_scale=.73
    scene=bpy.context.scene;scene.camera=cam
    scene.render.resolution_x=1400;scene.render.resolution_y=860;scene.render.resolution_percentage=100
    bpy.ops.object.light_add(type='AREA',location=(0,0,1));light=bpy.context.object
    light.data.energy=22;light.data.shape='DISK';light.data.size=1.1
    bpy.ops.object.select_all(action='DESELECT')
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.overlay.show_overlays=False
            area.spaces.active.shading.color_type='TEXTURE'
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC/'deck.blend'),compress=True)


builders={'room':room,'player':player,'deck':deck}
selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(builders)
for target in selected:
    builders[target]()
