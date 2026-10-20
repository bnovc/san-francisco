"""
bpl_lib — shared helpers for offline procedural asset generation with Blender-as-a-module (bpy).
Run scripts with:  tools/bpl/.venv/bin/python tools/bpl/gen_<category>.py
Conventions (MANDATORY for every generator):
  * Units: metres. Blender Z-up in-script; the glTF exporter converts to Y-up for Three.js.
  * Object origin = bottom-centre of the asset (base on the ground), facing +Y in Blender
    (= -Z "forward" in Three.js after export; i.e. the front of a façade module faces the street).
  * Materials: use ONLY names from MATERIAL_LIBRARY below. The Three.js runtime replaces each material
    by name with a textured PBR material; the base colours here are just for standalone preview.
  * Keep polygon budgets: façade modules < 600 tris, props < 2000, vehicles < 5000, trees < 8000.
  * Export with export_glb(objs, "category/name") -> public/assets/models/category/name.glb
    and call write_manifest("category") at the end.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "public", "assets", "models")

MATERIAL_LIBRARY = {
    # name: (base_color_rgb, metallic, roughness, emissive_strength)
    "asphalt":        ((0.10, 0.10, 0.11), 0.0, 0.95, 0),
    "concrete":       ((0.62, 0.60, 0.57), 0.0, 0.90, 0),
    "concrete_dark":  ((0.40, 0.40, 0.40), 0.0, 0.90, 0),
    "granite_grey":   ((0.55, 0.55, 0.55), 0.0, 0.60, 0),
    "granite_dark":   ((0.25, 0.25, 0.27), 0.0, 0.45, 0),
    "granite_pink":   ((0.66, 0.55, 0.50), 0.0, 0.55, 0),
    "limestone":      ((0.80, 0.76, 0.68), 0.0, 0.85, 0),
    "sandstone":      ((0.72, 0.66, 0.55), 0.0, 0.85, 0),
    "marble_white":   ((0.90, 0.89, 0.86), 0.0, 0.35, 0),
    "terracotta_white":((0.88, 0.86, 0.80), 0.0, 0.50, 0),
    "brick_red":      ((0.55, 0.28, 0.22), 0.0, 0.90, 0),
    "plaster_white":  ((0.90, 0.90, 0.88), 0.0, 0.80, 0),
    "plaster_cream":  ((0.86, 0.80, 0.66), 0.0, 0.80, 0),
    "plaster_grey":   ((0.65, 0.65, 0.63), 0.0, 0.80, 0),
    "glass_clear":    ((0.80, 0.90, 0.95), 0.0, 0.05, 0),
    "glass_tint":     ((0.30, 0.40, 0.45), 0.0, 0.05, 0),
    "glass_dark":     ((0.08, 0.10, 0.12), 0.0, 0.05, 0),
    "metal_black":    ((0.05, 0.05, 0.05), 0.8, 0.45, 0),
    "metal_alu":      ((0.75, 0.76, 0.78), 0.9, 0.35, 0),
    "steel":          ((0.60, 0.60, 0.62), 0.9, 0.40, 0),
    "chrome":         ((0.85, 0.85, 0.87), 1.0, 0.15, 0),
    "brass":          ((0.78, 0.60, 0.30), 0.9, 0.35, 0),
    "bronze":         ((0.35, 0.25, 0.15), 0.8, 0.50, 0),
    "bronze_green":   ((0.30, 0.45, 0.38), 0.6, 0.60, 0),
    "iron_painted":   ((0.12, 0.12, 0.13), 0.5, 0.60, 0),
    "wood_oak":       ((0.62, 0.45, 0.28), 0.0, 0.60, 0),
    "wood_dark":      ((0.30, 0.20, 0.12), 0.0, 0.60, 0),
    "wood_light":     ((0.80, 0.68, 0.50), 0.0, 0.55, 0),
    "fabric_red":     ((0.70, 0.08, 0.08), 0.0, 0.95, 0),
    "fabric_green":   ((0.10, 0.35, 0.20), 0.0, 0.95, 0),
    "fabric_black":   ((0.05, 0.05, 0.05), 0.0, 0.95, 0),
    "fabric_cream":   ((0.85, 0.80, 0.70), 0.0, 0.95, 0),
    "paint_red":      ((0.80, 0.05, 0.05), 0.0, 0.50, 0),
    "paint_white":    ((0.92, 0.92, 0.92), 0.0, 0.50, 0),
    "paint_yellow":   ((0.95, 0.75, 0.05), 0.0, 0.50, 0),
    "paint_green":    ((0.10, 0.40, 0.18), 0.0, 0.50, 0),
    "paint_blue":     ((0.10, 0.25, 0.60), 0.0, 0.50, 0),
    "paint_grey":     ((0.50, 0.50, 0.52), 0.0, 0.50, 0),
    "paint_maroon":   ((0.40, 0.08, 0.10), 0.0, 0.45, 0),
    "paint_cream":    ((0.90, 0.85, 0.70), 0.0, 0.45, 0),
    "paint_silver":   ((0.70, 0.70, 0.72), 0.6, 0.35, 0),
    "car_paint":      ((0.60, 0.60, 0.62), 0.6, 0.30, 0),  # runtime recolours per instance
    "plastic_black":  ((0.03, 0.03, 0.03), 0.0, 0.70, 0),
    "plastic_white":  ((0.92, 0.92, 0.92), 0.0, 0.60, 0),
    "plastic_grey":   ((0.45, 0.45, 0.45), 0.0, 0.70, 0),
    "rubber":         ((0.03, 0.03, 0.03), 0.0, 0.90, 0),
    "emissive_white": ((1.0, 1.0, 1.0), 0.0, 0.50, 3.0),
    "emissive_warm":  ((1.0, 0.85, 0.60), 0.0, 0.50, 3.0),
    "emissive_red":   ((1.0, 0.05, 0.05), 0.0, 0.50, 3.0),
    "emissive_green": ((0.1, 1.0, 0.2), 0.0, 0.50, 3.0),
    "emissive_amber": ((1.0, 0.6, 0.05), 0.0, 0.50, 3.0),
    "screen":         ((0.02, 0.02, 0.02), 0.0, 0.30, 0),  # runtime applies video/canvas texture
    "leaf_green":     ((0.18, 0.40, 0.14), 0.0, 0.85, 0),
    "leaf_dark":      ((0.10, 0.28, 0.10), 0.0, 0.85, 0),
    "palm_frond":     ((0.22, 0.45, 0.18), 0.0, 0.85, 0),
    "bark":           ((0.35, 0.28, 0.20), 0.0, 0.95, 0),
    "bark_palm":      ((0.45, 0.38, 0.28), 0.0, 0.95, 0),
    "soil":           ((0.22, 0.16, 0.10), 0.0, 0.95, 0),
    "grass":          ((0.25, 0.45, 0.15), 0.0, 0.90, 0),
    "skin":           ((0.80, 0.62, 0.50), 0.0, 0.70, 0),
    "cardboard":      ((0.70, 0.55, 0.35), 0.0, 0.90, 0),
}

_mat_cache = {}

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mat_cache.clear()

def mat(name):
    """Get/create a Principled material from MATERIAL_LIBRARY by name."""
    if name not in MATERIAL_LIBRARY:
        raise ValueError(f"Unknown material '{name}'. Use a name from MATERIAL_LIBRARY.")
    if name in _mat_cache:
        return _mat_cache[name]
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        rgb, metallic, rough, emis = MATERIAL_LIBRARY[name]
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = rough
        if emis > 0:
            bsdf.inputs["Emission Color"].default_value = (*rgb, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emis
        if name.startswith("glass"):
            bsdf.inputs["Alpha"].default_value = 0.35
            m.blend_method = 'BLEND'
    _mat_cache[name] = m
    return m

def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj

def mesh_from_bmesh(bm, name, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    obj.data.materials.append(mat(material))
    return _link(obj)

def box(name, size, location=(0, 0, 0), material="concrete", rotation=(0, 0, 0)):
    """Axis-aligned box; size=(x,y,z); location = centre of the box."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    obj = mesh_from_bmesh(bm, name, material)
    obj.location = location
    obj.rotation_euler = rotation
    return obj

def box_bottom(name, size, base=(0, 0, 0), material="concrete"):
    """Box whose bottom-centre is at `base`."""
    return box(name, size, (base[0], base[1], base[2] + size[2] / 2), material)

def cylinder(name, radius, depth, location=(0, 0, 0), material="steel", segments=16, rotation=(0, 0, 0), radius2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=(radius if radius2 is None else radius2), depth=depth)
    obj = mesh_from_bmesh(bm, name, material)
    obj.location = location
    obj.rotation_euler = rotation
    return obj

def cylinder_bottom(name, radius, height, base=(0, 0, 0), material="steel", segments=16, radius2=None):
    return cylinder(name, radius, height, (base[0], base[1], base[2] + height / 2), material, segments, radius2=radius2)

def sphere(name, radius, location=(0, 0, 0), material="steel", segments=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=max(6, segments // 2), radius=radius)
    obj = mesh_from_bmesh(bm, name, material)
    obj.location = location
    return obj

def torus(name, major, minor, location=(0, 0, 0), material="steel", segments=24, ring_segments=8, rotation=(0,0,0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=segments, minor_segments=ring_segments, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat(material))
    return obj

def extrude_profile(name, profile_xy, length, material="limestone", axis='X'):
    """Extrude a closed 2D profile (list of (u,v)) along `axis` for `length` metres, centred on origin.
    For cornices: profile in (depth=+Y outward from wall, height=Z), extruded along X (wall direction)."""
    bm = bmesh.new()
    verts = []
    for (u, v) in profile_xy:
        if axis == 'X':
            verts.append(bm.verts.new((-length / 2, u, v)))
        else:
            verts.append(bm.verts.new((u, -length / 2, v)))
    face = bm.faces.new(verts)
    bm.normal_update()
    res = bmesh.ops.extrude_face_region(bm, geom=[face])
    ext_verts = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    vec = Vector((length, 0, 0)) if axis == 'X' else Vector((0, length, 0))
    bmesh.ops.translate(bm, vec=vec, verts=ext_verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(bm, name, material)

def lathe(name, profile_rz, material="limestone", segments=24):
    """Revolve a profile of (radius, z) points around Z (for balusters, column shafts, lamp posts, finials)."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile_rz:
        ring = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for j in range(segments):
            k = (j + 1) % segments
            try:
                bm.faces.new((a[j], a[k], b[k], b[j]))
            except ValueError:
                pass
    # caps
    try:
        if profile_rz[0][0] > 1e-6:
            bm.faces.new(list(reversed(rings[0])))
        if profile_rz[-1][0] > 1e-6:
            bm.faces.new(rings[-1])
    except ValueError:
        pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(bm, name, material)

def plane(name, size_xy, location=(0,0,0), material="plaster_white", rotation=(0,0,0)):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.scale(bm, vec=Vector((size_xy[0], size_xy[1], 1)), verts=bm.verts)
    obj = mesh_from_bmesh(bm, name, material)
    obj.location = location
    obj.rotation_euler = rotation
    return obj

def join(objects, name):
    """Join objects into one mesh object (keeps per-face materials)."""
    objects = [o for o in objects if o is not None]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.active_object
    obj.name = name
    return obj

def set_origin_bottom_center(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = obj.data
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    cx, cy, cz = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)
    for v in me.vertices:
        v.co.x -= cx; v.co.y -= cy; v.co.z -= cz
    obj.location = (0, 0, 0)
    return obj

def decimate(obj, ratio):
    mod = obj.modifiers.new("dec", 'DECIMATE')
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

def tri_count(objs):
    n = 0
    for o in objs:
        if o.type == 'MESH':
            o.data.calc_loop_triangles()
            n += len(o.data.loop_triangles)
    return n

_manifest = {}

def export_glb(objects, rel_name, meta=None):
    """Export a list of objects (or a single object) to public/assets/models/<rel_name>.glb ."""
    if not isinstance(objects, (list, tuple)):
        objects = [objects]
    path = os.path.join(OUT_DIR, rel_name + ".glb")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
        for c in o.children_recursive:
            c.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True, export_animations=False,
                              export_skins=False, export_morph=False, export_lights=False, export_cameras=False,
                              export_materials='EXPORT', export_image_format='NONE', export_texcoords=True, export_normals=True)
    tris = tri_count(objects + [c for o in objects for c in o.children_recursive])
    # bounding box
    xs, ys, zs = [], [], []
    for o in objects + [c for o in objects for c in o.children_recursive]:
        if o.type != 'MESH': continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    bbox = None
    if xs:
        bbox = {"min": [min(xs), min(zs), -max(ys)], "max": [max(xs), max(zs), -min(ys)]}  # converted to three.js (x, y=up, z)
    entry = {"file": f"assets/models/{rel_name}.glb", "tris": tris, "bbox_threejs": bbox,
             "sizeBytes": os.path.getsize(path)}
    if meta: entry.update(meta)
    _manifest[rel_name] = entry
    print(f"exported {rel_name}.glb  tris={tris}  bytes={entry['sizeBytes']}")
    return path

def write_manifest(category):
    path = os.path.join(OUT_DIR, f"manifest_{category}.json")
    with open(path, "w") as f:
        json.dump(_manifest, f, indent=1)
    print("manifest ->", path, len(_manifest), "assets")
    return path

def clear_objects():
    """Delete all objects (keep materials) between assets."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
