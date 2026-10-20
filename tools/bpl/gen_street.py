"""
gen_street.py — San Francisco (Union Square district) street furniture.
Run:  tools/bpl/.venv/bin/python tools/bpl/gen_street.py

Conventions (see bpl_lib.py):
  * metres, Blender Z-up; origin at bottom-centre (pole assets: origin = pole base, see meta "origin").
  * FRONT of every asset faces Blender -Y  (=> Three.js +Z after export).
  * ONLY MATERIAL_LIBRARY names.  Props < 2000 tris (most < 800).
  * Special runtime objects are exported as separate nodes (not joined):
      traffic signals: 'lamp_red' 'lamp_amber' 'lamp_green' (+ 'ped_walk' 'ped_stop')
      signs / kiosks:  'sign_a' 'sign_b' 'sign_face' 'panel_a' 'panel_b' 'screen' 'fascia'  (material 'screen')
      flagpole: 'flag'
"""
import sys, os; sys.path.insert(0, os.path.dirname(__file__))
from bpl_lib import *

FRONT = -1.0          # front faces -Y
BUDGET = 2000
SUMMARY = []

# ----------------------------------------------------------------------------- helpers

def tube(name, pts, radius, material="metal_black", segments=8, cap=True):
    """Tube swept along a polyline (parallel-transport frames -> no twist). Used for curved arms & racks."""
    bm = bmesh.new()
    pts = [Vector(p) for p in pts]
    n = len(pts)
    tangents = []
    for i in range(n):
        if i == 0: t = pts[1] - pts[0]
        elif i == n - 1: t = pts[-1] - pts[-2]
        else: t = pts[i + 1] - pts[i - 1]
        tangents.append(t.normalized())
    t0 = tangents[0]
    ref = Vector((0, 0, 1)) if abs(t0.dot(Vector((0, 0, 1)))) < 0.9 else Vector((1, 0, 0))
    n1 = t0.cross(ref).normalized()
    rings = []
    for i in range(n):
        t = tangents[i]
        n1 = (n1 - t * t.dot(n1)).normalized()
        n2 = t.cross(n1).normalized()
        ring = []
        for j in range(segments):
            a = 2 * math.pi * j / segments
            ring.append(bm.verts.new(pts[i] + n1 * (radius * math.cos(a)) + n2 * (radius * math.sin(a))))
        rings.append(ring)
    for i in range(n - 1):
        for j in range(segments):
            k = (j + 1) % segments
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
    if cap:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(bm, name, material)

def bez(p0, p1, p2, n=7):
    p0, p1, p2 = Vector(p0), Vector(p1), Vector(p2)
    return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2 for t in [i / (n - 1) for i in range(n)]]

def prism(name, pts_xy, height, base_z=0.0, material="concrete", location=(0, 0, 0), rotation=(0, 0, 0)):
    """Polygon in XY extruded +Z by `height` from base_z."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, base_z)) for x, y in pts_xy]
    f = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    ev = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=Vector((0, 0, height)), verts=ev)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_from_bmesh(bm, name, material)
    o.location = location; o.rotation_euler = rotation
    return o

def profile_x(name, pts_yz, length, material, location=(0, 0, 0), rotation=(0, 0, 0)):
    """Closed (y,z) profile extruded along X, centred."""
    o = extrude_profile(name, pts_yz, length, material, axis='X')
    o.location = location; o.rotation_euler = rotation
    return o

def profile_y(name, pts_xz, length, material, location=(0, 0, 0), rotation=(0, 0, 0)):
    """Closed (x,z) profile extruded along Y, centred."""
    o = extrude_profile(name, pts_xz, length, material, axis='Y')
    o.location = location; o.rotation_euler = rotation
    return o

def ribbed_prism(name, r_out, r_in, ribs, height, base_z=0.0, material="paint_green"):
    pts = []
    for i in range(ribs):
        a0 = 2 * math.pi * i / ribs; a1 = a0 + math.pi / ribs
        for a, r in ((a0, r_in), (a0 + 0.35 * math.pi / ribs, r_out), (a1 - 0.35 * math.pi / ribs, r_out), (a1, r_in)):
            pts.append((r * math.cos(a), r * math.sin(a)))
    return prism(name, pts, height, base_z, material)

def lowsphere(name, radius, location, material, u=6, v=4, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    o = mesh_from_bmesh(bm, name, material); o.location = location
    return o

def annulus(name, r_in, r_out, z_top, thick, material="iron_painted", segments=24, square_outer=None):
    """Flat ring (top + walls, no bottom).  square_outer = half-size -> outer boundary is a square."""
    bm = bmesh.new()
    inner, outer, inner_b, outer_b = [], [], [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments; c, s = math.cos(a), math.sin(a)
        inner.append(bm.verts.new((r_in * c, r_in * s, z_top)))
        inner_b.append(bm.verts.new((r_in * c, r_in * s, z_top - thick)))
        if square_outer:
            m = max(abs(c), abs(s)); ox, oy = square_outer * c / m, square_outer * s / m
        else:
            ox, oy = r_out * c, r_out * s
        outer.append(bm.verts.new((ox, oy, z_top)))
        outer_b.append(bm.verts.new((ox, oy, z_top - thick)))
    for i in range(segments):
        k = (i + 1) % segments
        bm.faces.new((inner[i], outer[i], outer[k], inner[k]))
        bm.faces.new((outer[i], outer_b[i], outer_b[k], outer[k]))
        bm.faces.new((inner_b[i], inner[i], inner[k], inner_b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(bm, name, material)

def grid_plane(name, size_xy, location, material, nx=6, ny=3, rotation=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=0.5)
    bmesh.ops.scale(bm, vec=Vector((size_xy[0], size_xy[1], 1)), verts=bm.verts)
    o = mesh_from_bmesh(bm, name, material); o.location = location; o.rotation_euler = rotation
    return o

def pole(name, h, r0, r1, base_r=None, segs=12, material="metal_black", base_h=0.06):
    """Tapered street pole with a base flange and lower collar."""
    base_r = base_r or r0 * 2.2
    prof = [(base_r, 0), (base_r, base_h), (r0 * 1.35, base_h), (r0 * 1.35, 0.45), (r0, 0.52), (r1, h)]
    return lathe(name, prof, material, segs)

def xcyl(name, r, length, location, material="steel", segs=8):
    """Cylinder along X."""
    return cylinder(name, r, length, location, material, segs, rotation=(0, math.pi / 2, 0))

def ycyl(name, r, length, location, material="steel", segs=8, r2=None):
    """Cylinder along Y (radius r at +Y end? no: radius1 at -Y end after +90deg X rotation is the bottom => +Y).
    We keep it symmetric unless r2 given."""
    return cylinder(name, r, length, location, material, segs, rotation=(math.pi / 2, 0, 0), radius2=r2)

def finalize(parts, name, keep_xy=False, ground=None, separate=()):
    """Join `parts` into one object `name`; `separate` objects stay separate nodes.
    Shift everything so min z == 0 (or z == ground) and, unless keep_xy, the XY bbox centre is at the origin."""
    main = join(parts, name)
    objs = [main] + list(separate)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = main
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    xs, ys, zs = [], [], []
    for o in objs:
        for v in o.data.vertices:
            xs.append(v.co.x); ys.append(v.co.y); zs.append(v.co.z)
    cx = 0.0 if keep_xy else (min(xs) + max(xs)) / 2
    cy = 0.0 if keep_xy else (min(ys) + max(ys)) / 2
    dz = min(zs) if ground is None else ground
    for o in objs:
        for v in o.data.vertices:
            v.co.x -= cx; v.co.y -= cy; v.co.z -= dz
        o.location = (0, 0, 0)
    return objs

def ship(objs, rel, kind, **extra):
    """Export + manifest meta {kind, height, footprint} (+extra), record tri count, clear scene."""
    xs, ys, zs = [], [], []
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    meta = {"kind": kind, "height": round(max(zs) - min(zs), 3),
            "footprint": [round(max(xs) - min(xs), 3), round(max(ys) - min(ys), 3)], "front": "-Y"}
    meta.update(extra)
    export_glb(list(objs), rel, meta)
    tris = tri_count(list(objs))
    SUMMARY.append((rel, tris, meta["height"], meta["footprint"]))
    assert tris < BUDGET, f"{rel} over budget: {tris}"
    clear_objects()

# ----------------------------------------------------------------------------- 1. streetlights

def teardrop(prefix, top):
    """SF teardrop pendant luminaire hanging from point `top` (x,y,z). Returns [hood, lens]."""
    x, y, z = top
    link = cylinder(prefix + "_link", 0.02, 0.12, (x, y, z - 0.06), "metal_black", 6)
    hood = lathe(prefix + "_hood", [(0.03, 0), (0.09, -0.03), (0.15, -0.10), (0.18, -0.22), (0.17, -0.24)], "metal_black", 12)
    hood.location = (x, y, z - 0.12)
    lens = lathe(prefix + "_lens", [(0.17, -0.24), (0.16, -0.36), (0.12, -0.50), (0.05, -0.62), (0.01, -0.68)], "emissive_warm", 12)
    lens.location = (x, y, z - 0.12)
    return [link, hood, lens]

def arm_pts(z_top, direction=FRONT, reach=2.0, rise=1.0):
    return bez((0, 0, z_top - 0.15), (0, 0.25 * direction, z_top + rise), (0, reach * direction, z_top + rise * 0.95), 7)

def gen_streetlight_teardrop():
    p = pole("pole", 8.6, 0.09, 0.055)
    parts = [p, tube("arm", arm_pts(8.6), 0.035, "metal_black", 8)]
    parts += teardrop("lum", (0, FRONT * 2.0, 8.6 + 0.95))
    objs = finalize(parts, "streetlight_sf_teardrop", keep_xy=True)
    ship(objs, "street/streetlight_sf_teardrop", "streetlight", origin="pole_base", arm_dir="-Y", lamp_height=9.0)

def gen_streetlight_double():
    p = pole("pole", 8.6, 0.09, 0.055)
    parts = [p, tube("arm_f", arm_pts(8.6, FRONT), 0.035), tube("arm_b", arm_pts(8.6, -FRONT), 0.035)]
    parts += teardrop("lum_f", (0, FRONT * 2.0, 9.55)) + teardrop("lum_b", (0, -FRONT * 2.0, 9.55))
    objs = finalize(parts, "streetlight_sf_double", keep_xy=True)
    ship(objs, "street/streetlight_sf_double", "streetlight", origin="pole_base", arm_dir="+-Y")

def gen_streetlight_pedestrian():
    p = pole("pole", 4.0, 0.06, 0.045, base_r=0.16)
    parts = [p]
    # lantern head: base disc, glass box, pyramid cap, finial
    parts.append(cylinder("neck", 0.05, 0.1, (0, 0, 4.05), "metal_black", 8))
    parts.append(box("lant_base", (0.34, 0.34, 0.04), (0, 0, 4.12), "metal_black"))
    parts.append(box("lant_glass", (0.28, 0.28, 0.34), (0, 0, 4.31), "emissive_warm"))
    for sx, sy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        parts.append(box("lant_rib", (0.03 if sx else 0.3, 0.03 if sy else 0.3, 0.34), (sx * 0.15, sy * 0.15, 4.31), "metal_black"))
    parts.append(cylinder("lant_cap", 0.24, 0.16, (0, 0, 4.56), "metal_black", 4, rotation=(0, 0, math.pi / 4), radius2=0.03))
    parts.append(sphere("finial", 0.03, (0, 0, 4.66), "metal_black", 8))
    objs = finalize(parts, "streetlight_pedestrian_4m", keep_xy=True)
    ship(objs, "street/streetlight_pedestrian_4m", "streetlight", origin="pole_base")

def gen_streetlight_plaza_globe():
    p = pole("pole", 4.5, 0.06, 0.05, base_r=0.16)
    parts = [p, xcyl("crossbar", 0.03, 1.4, (0, 0, 4.5), "metal_black", 8)]
    for sx in (-1, 1):
        parts.append(cylinder("cup", 0.12, 0.06, (sx * 0.62, 0, 4.55), "metal_black", 12, radius2=0.06))
        parts.append(sphere("globe", 0.25, (sx * 0.62, 0, 4.8), "emissive_warm", 12))
    objs = finalize(parts, "streetlight_plaza_globe", keep_xy=True)
    ship(objs, "street/streetlight_plaza_globe", "streetlight", origin="pole_base")

# ----------------------------------------------------------------------------- 2. traffic signals

def signal_head(cx, cy, z_bot, face_dir=FRONT):
    """3-lamp vehicle signal head; lenses face `face_dir` (Y). Returns (parts, [lamp objs])."""
    parts = [box("sig_house", (0.34, 0.28, 1.05), (cx, cy, z_bot + 0.525), "metal_black"),
             box("sig_backplate", (0.6, 0.02, 1.3), (cx, cy - face_dir * 0.13, z_bot + 0.525), "metal_black")]
    lamps = []
    for i, (nm, m) in enumerate((("lamp_red", "emissive_red"), ("lamp_amber", "emissive_amber"), ("lamp_green", "emissive_green"))):
        z = z_bot + 0.875 - i * 0.35
        parts.append(ycyl("visor", 0.15, 0.22, (cx, cy + face_dir * 0.2, z + 0.02), "metal_black", 12))
        lamps.append(ycyl(nm, 0.12, 0.02, (cx, cy + face_dir * 0.15, z), m, 12))
    return parts, lamps

def gen_traffic_signal_mast():
    p = pole("pole", 6.0, 0.14, 0.11, base_r=0.28)
    arm = tube("mast_arm", [(0.1, 0, 5.4), (1.5, 0, 5.62), (3.2, 0, 5.75), (5.0, 0, 5.82)], 0.06, "metal_black", 8)
    parts = [p, arm, box("arm_plate", (0.1, 0.3, 0.6), (0.2, 0, 5.4), "metal_black"),
             cylinder("hanger", 0.03, 0.25, (4.4, 0, 5.65), "metal_black", 6)]
    hp, lamps = signal_head(4.4, 0.0, 4.5)
    parts += hp
    # street-name blade on the arm
    parts.append(box("arm_sign", (1.0, 0.03, 0.3), (2.6, 0, 5.35), "paint_green"))
    objs = finalize(parts, "traffic_signal_mast", keep_xy=True, separate=lamps)
    ship(objs, "street/traffic_signal_mast", "traffic_signal", origin="pole_base", arm_dir="+X", lens_dir="-Y",
         lamps=["lamp_red", "lamp_amber", "lamp_green"])

def gen_traffic_signal_post():
    p = pole("pole", 4.5, 0.07, 0.06, base_r=0.18)
    parts = [p, xcyl("bracket", 0.025, 0.4, (0.25, 0, 3.9), "metal_black", 6), xcyl("bracket2", 0.025, 0.4, (0.25, 0, 3.3), "metal_black", 6)]
    hp, lamps = signal_head(0.5, 0.0, 3.05)
    parts += hp
    # pedestrian signal box facing +X (sideways)
    parts.append(box("ped_house", (0.18, 0.32, 0.36), (0.16, 0, 2.45), "metal_black"))
    parts.append(box("ped_visor", (0.1, 0.34, 0.03), (0.28, 0, 2.64), "metal_black"))
    ped_stop = box("ped_stop", (0.01, 0.13, 0.13), (0.255, 0, 2.53), "emissive_red")
    ped_walk = box("ped_walk", (0.01, 0.13, 0.13), (0.255, 0, 2.37), "emissive_white")
    # push button box
    parts.append(box("pb_box", (0.08, 0.14, 0.18), (0.11, 0, 1.05), "paint_yellow"))
    parts.append(xcyl("pb_btn", 0.025, 0.02, (0.16, 0, 1.02), "metal_alu", 8))
    objs = finalize(parts, "traffic_signal_post", keep_xy=True, separate=lamps + [ped_stop, ped_walk])
    ship(objs, "street/traffic_signal_post", "traffic_signal", origin="pole_base", lens_dir="-Y", ped_dir="+X",
         lamps=["lamp_red", "lamp_amber", "lamp_green", "ped_stop", "ped_walk"])

# ----------------------------------------------------------------------------- 3-5. meter, hydrant, trash

def gen_parking_meter():
    parts = [cylinder_bottom("post", 0.035, 1.08, material="steel", segments=8),
             cylinder("collar", 0.05, 0.05, (0, 0, 1.1), "plastic_grey", 8),
             box("head", (0.18, 0.13, 0.26), (0, 0, 1.25), "plastic_grey"),
             ycyl("head_top", 0.09, 0.13, (0, 0, 1.38), "plastic_grey", 12),
             box("display", (0.1, 0.01, 0.06), (0, FRONT * 0.068, 1.3), "glass_dark"),
             box("card_slot", (0.06, 0.01, 0.015), (0, FRONT * 0.068, 1.2), "plastic_black")]
    objs = finalize(parts, "parking_meter_sf", keep_xy=True)
    ship(objs, "street/parking_meter_sf", "parking_meter")

def gen_hydrant(cap_mat, rel):
    body = lathe("body", [(0.19, 0), (0.19, 0.05), (0.13, 0.07), (0.13, 0.5), (0.155, 0.53), (0.155, 0.58)], "paint_white", 16)
    cap = lathe("cap", [(0.155, 0.58), (0.14, 0.64), (0.10, 0.72), (0.05, 0.78), (0.01, 0.8)], cap_mat, 16)
    parts = [body, cap, cylinder("cap_ring", 0.16, 0.03, (0, 0, 0.6), "paint_white", 16)]
    for sx in (-1, 1):
        parts.append(xcyl("nozzle", 0.05, 0.1, (sx * 0.16, 0, 0.4), "paint_white", 8))
        parts.append(xcyl("nozzle_cap", 0.055, 0.03, (sx * 0.215, 0, 0.4), cap_mat, 8))
    parts.append(ycyl("steamer", 0.07, 0.12, (0, FRONT * 0.17, 0.36), "paint_white", 10))
    parts.append(ycyl("steamer_cap", 0.075, 0.035, (0, FRONT * 0.24, 0.36), cap_mat, 10))
    parts.append(cylinder("stem", 0.03, 0.06, (0, 0, 0.83), "steel", 5))
    objs = finalize(parts, rel.split("/")[1], keep_xy=True)
    ship(objs, rel, "hydrant", cap=cap_mat)

def gen_trashcan(body_mat, rel):
    parts = [ribbed_prism("body", 0.33, 0.30, 16, 0.85, 0.04, body_mat),
             cylinder("base", 0.31, 0.04, (0, 0, 0.02), "metal_black", 16),
             cylinder("rim", 0.35, 0.05, (0, 0, 0.915), body_mat, 16),
             lathe("lid", [(0.35, 0.94), (0.33, 1.0), (0.24, 1.08), (0.10, 1.13), (0.01, 1.14)], body_mat, 16),
             box("opening", (0.36, 0.2, 0.22), (0, FRONT * 0.24, 0.8), "plastic_black"),
             box("hood", (0.40, 0.14, 0.03), (0, FRONT * 0.3, 0.93), body_mat),
             box("lock_plate", (0.10, 0.02, 0.14), (0, -FRONT * 0.34, 0.5), "steel")]
    objs = finalize(parts, rel.split("/")[1], keep_xy=True)
    ship(objs, rel, "trashcan")

# ----------------------------------------------------------------------------- 6. benches

def gen_bench_plaza():
    parts = [box_bottom("block", (2.4, 0.55, 0.40), material="granite_grey")]
    for i in range(5):
        parts.append(box("slat", (2.4, 0.09, 0.04), (0, -0.22 + i * 0.11, 0.42), "wood_oak"))
    objs = finalize(parts, "bench_plaza")
    ship(objs, "street/bench_plaza", "bench")

def gen_bench_wood():
    parts = []
    tilt = math.radians(-12)
    for sx in (-0.85, 0.85):
        parts.append(box("leg_f", (0.05, 0.05, 0.42), (sx, -0.2, 0.21), "iron_painted"))
        parts.append(box("leg_b", (0.05, 0.05, 0.42), (sx, 0.2, 0.21), "iron_painted"))
        parts.append(box("seat_sup", (0.05, 0.5, 0.05), (sx, 0, 0.42), "iron_painted"))
        parts.append(box("back_sup", (0.05, 0.05, 0.5), (sx, 0.26, 0.68), "iron_painted", rotation=(tilt, 0, 0)))
        parts.append(box("arm", (0.05, 0.5, 0.04), (sx, 0.02, 0.66), "iron_painted"))
        parts.append(box("arm_post", (0.04, 0.04, 0.2), (sx, -0.2, 0.55), "iron_painted"))
    for i in range(4):
        parts.append(box("seat_slat", (1.8, 0.09, 0.03), (0, -0.19 + i * 0.12, 0.46), "wood_oak"))
    for i in range(3):
        parts.append(box("back_slat", (1.8, 0.03, 0.09), (0, 0.31 - i * 0.03, 0.56 + i * 0.13), "wood_oak", rotation=(tilt, 0, 0)))
    objs = finalize(parts, "bench_wood")
    ship(objs, "street/bench_wood", "bench")

def gen_bench_metal():
    parts = [box("seat", (1.8, 0.45, 0.03), (0, 0, 0.45), "metal_black"),
             box("back", (1.8, 0.03, 0.4), (0, 0.22, 0.68), "metal_black", rotation=(math.radians(-10), 0, 0)),
             box("seat_rail", (1.8, 0.03, 0.06), (0, -0.21, 0.42), "metal_black")]
    for sx in (-0.7, 0.7):
        parts.append(tube("leg", [(sx, -0.2, 0), (sx, -0.2, 0.44), (sx, 0.2, 0.44), (sx, 0.2, 0)], 0.02, "metal_black", 6))
        parts.append(box("foot", (0.12, 0.5, 0.02), (sx, 0, 0.01), "metal_black"))
    for i in range(6):   # mesh slats hint
        parts.append(box("mesh", (1.8, 0.02, 0.005), (0, -0.2 + i * 0.08, 0.467), "steel"))
    objs = finalize(parts, "bench_metal")
    ship(objs, "street/bench_metal", "bench")

# ----------------------------------------------------------------------------- 7. bollards

def gen_bollards():
    b = lathe("bollard", [(0.09, 0), (0.09, 0.05), (0.07, 0.07), (0.07, 0.9), (0.08, 0.93), (0.06, 0.98), (0.01, 1.0)], "metal_black", 12)
    ship(finalize([b], "bollard_steel", keep_xy=True), "street/bollard_steel", "bollard")
    b = lathe("bollard", [(0.16, 0), (0.16, 0.1), (0.13, 0.12), (0.13, 0.75), (0.15, 0.8), (0.10, 0.88), (0.01, 0.9)], "granite_grey", 12)
    ship(finalize([b], "bollard_stone", keep_xy=True), "street/bollard_stone", "bollard")
    parts = [lathe("bollard", [(0.07, 0), (0.07, 0.95), (0.01, 1.0)], "paint_yellow", 10),
             cylinder("base", 0.11, 0.04, (0, 0, 0.02), "steel", 10),
             cylinder("band", 0.075, 0.08, (0, 0, 0.75), "paint_white", 10),
             xcyl("handle", 0.012, 0.16, (0, 0, 0.9), "steel", 6)]
    ship(finalize(parts, "bollard_removable", keep_xy=True), "street/bollard_removable", "bollard")

# ----------------------------------------------------------------------------- 8-9. newsrack, bike racks

def gen_newsrack(mat, rel):
    parts = [box_bottom("ped", (0.3, 0.3, 0.12), material="metal_black"),
             box("body", (0.5, 0.45, 1.05), (0, 0, 0.645), mat),
             box("window", (0.42, 0.01, 0.45), (0, FRONT * 0.228, 0.85), "glass_clear"),
             box("door_frame", (0.46, 0.02, 0.02), (0, FRONT * 0.23, 0.61), "metal_black"),
             box("coin", (0.12, 0.05, 0.14), (0.15, FRONT * 0.25, 0.5), "metal_alu"),
             box("handle", (0.14, 0.03, 0.03), (-0.12, FRONT * 0.24, 0.6), "metal_black"),
             box("top_lip", (0.52, 0.47, 0.03), (0, 0, 1.185), mat)]
    ship(finalize(parts, rel.split("/")[1]), rel, "newsrack")

def gen_bike_racks():
    pts = [(-0.4, 0, 0), (-0.4, 0, 0.45)]
    for i in range(1, 8):
        a = math.pi - math.pi * i / 8
        pts.append((0.4 * math.cos(a), 0, 0.5 + 0.4 * math.sin(a)))
    pts += [(0.4, 0, 0.45), (0.4, 0, 0)]
    r = tube("rack", pts, 0.025, "metal_black", 8)
    ship(finalize([r], "bike_rack"), "street/bike_rack", "bike_rack")
    pts = []
    n = 25
    for i in range(n):
        t = 3.0 * i / (n - 1)
        pts.append((-0.9 + 0.6 * t, 0, 0.45 * (1 - math.cos(2 * math.pi * t))))
    r = tube("rack", pts, 0.025, "metal_black", 6)
    ship(finalize([r], "bike_rack_wave"), "street/bike_rack_wave", "bike_rack")

# ----------------------------------------------------------------------------- 10. SFMTA bus shelter

def gen_bus_shelter():
    L, D, H = 4.2, 1.6, 2.45
    parts = []
    # wavy red roof (profile in XZ, extruded along Y)
    top = [(-L / 2 + L * i / 12, H + 0.12 + 0.10 * math.sin(2 * math.pi * i / 12 * 2)) for i in range(13)]
    prof = top + [(x, z - 0.06) for (x, z) in reversed(top)]
    parts.append(profile_y("roof", prof, D + 0.1, "paint_red"))
    for x in (-L / 2 + 0.15, L / 2 - 0.15):
        for y in (-D / 2 + 0.1, D / 2 - 0.1):
            parts.append(cylinder_bottom("post", 0.04, H + 0.08, (x, y, 0), "steel", 8))
    parts.append(box("beam_b", (L, 0.06, 0.06), (0, D / 2 - 0.1, H + 0.03), "steel"))
    parts.append(box("beam_f", (L, 0.06, 0.06), (0, -D / 2 + 0.1, H + 0.03), "steel"))
    parts.append(box("back_glass", (L - 0.4, 0.015, H - 0.3), (0, D / 2 - 0.1, 0.25 + (H - 0.3) / 2), "glass_clear"))
    parts.append(box("back_rail", (L - 0.4, 0.04, 0.04), (0, D / 2 - 0.1, 0.25), "steel"))
    parts.append(box("side_glass", (0.015, D - 0.2, H - 0.3), (-L / 2 + 0.15, 0, 0.25 + (H - 0.3) / 2), "glass_clear"))
    # route-display panel at +X end (black frame + 'screen')
    parts.append(box("panel_frame", (0.08, 1.2, 1.9), (L / 2 - 0.15, 0, 1.25), "metal_black"))
    screen = box("screen", (0.10, 1.05, 1.6), (L / 2 - 0.15, 0, 1.3), "screen")
    # bench
    parts.append(box("bench_seat", (1.9, 0.4, 0.04), (-0.3, D / 2 - 0.4, 0.46), "steel"))
    for sx in (-1.15, 0.55):
        parts.append(box("bench_leg", (0.04, 0.36, 0.44), (sx, D / 2 - 0.4, 0.22), "steel"))
    parts.append(box("solar", (1.2, 0.8, 0.03), (-0.6, 0.1, H + 0.28), "glass_dark"))
    objs = finalize(parts, "bus_shelter_sfmta", separate=[screen])
    ship(objs, "street/bus_shelter_sfmta", "bus_shelter", open_side="-Y", screen="screen")

# ----------------------------------------------------------------------------- 11. tree grate / guard

def gen_tree_grate():
    parts = [annulus("frame", 0.68, 0.75, 0.04, 0.04, "iron_painted", 24, square_outer=0.75)]
    for r_in, r_out in ((0.55, 0.65), (0.42, 0.52), (0.29, 0.39), (0.18, 0.26)):
        parts.append(annulus("ring", r_in, r_out, 0.04, 0.025, "iron_painted", 24))
    for a in (0, 45, 90, 135):
        parts.append(box("bar", (1.36, 0.03, 0.03), (0, 0, 0.025), "iron_painted", rotation=(0, 0, math.radians(a))))
    parts.append(cylinder("soil", 0.7, 0.01, (0, 0, 0.005), "soil", 24))
    ship(finalize(parts, "tree_grate"), "street/tree_grate", "tree_grate")

    parts = []
    for i in range(12):
        a = 2 * math.pi * i / 12
        parts.append(box("picket", (0.02, 0.02, 1.4), (0.5 * math.cos(a), 0.5 * math.sin(a), 0.7), "iron_painted", rotation=(0, 0, a)))
        parts.append(cylinder("finial", 0.02, 0.06, (0.5 * math.cos(a), 0.5 * math.sin(a), 1.43), "iron_painted", 4, radius2=0.002))
    for z in (0.3, 1.25):
        parts.append(annulus("hoop", 0.485, 0.515, z + 0.02, 0.04, "iron_painted", 24))
    ship(finalize(parts, "tree_guard"), "street/tree_guard", "tree_guard")

# ----------------------------------------------------------------------------- 12-13. cabinets, mailbox

def gen_utility_boxes():
    parts = [box_bottom("plinth", (0.7, 0.55, 0.15), material="concrete_dark"),
             box("cab", (0.6, 0.45, 1.35), (0, 0, 0.825), "paint_grey"),
             box("seam", (0.01, 0.012, 1.2), (0, FRONT * 0.228, 0.82), "metal_black"),
             box("handle", (0.03, 0.03, 0.14), (0.08, FRONT * 0.235, 0.9), "metal_black"),
             box("vent", (0.25, 0.01, 0.12), (0, FRONT * 0.228, 0.35), "metal_black"),
             box("vent2", (0.25, 0.01, 0.12), (0, -FRONT * 0.228, 1.25), "metal_black"),
             box("cap", (0.64, 0.49, 0.03), (0, 0, 1.515), "paint_grey")]
    ship(finalize(parts, "utility_box"), "street/utility_box", "utility_box")
    parts = [box_bottom("cab", (0.45, 0.32, 0.9), material="paint_grey"),
             box("seam", (0.01, 0.012, 0.75), (0, FRONT * 0.163, 0.47), "metal_black"),
             box("handle", (0.03, 0.03, 0.1), (0.06, FRONT * 0.168, 0.5), "metal_black"),
             box("cap", (0.48, 0.35, 0.02), (0, 0, 0.91), "paint_grey")]
    ship(finalize(parts, "utility_box_small"), "street/utility_box_small", "utility_box")

def gen_mailbox():
    prof = [(-0.24, 0.35), (0.24, 0.35), (0.24, 0.9)]
    for i in range(1, 8):
        a = math.pi * i / 8
        prof.append((0.24 * math.cos(a), 0.9 + 0.24 * math.sin(a)))
    prof.append((-0.24, 0.9))
    parts = [profile_x("body", prof, 0.55, "paint_blue")]
    for sx in (-0.22, 0.22):
        for sy in (-0.19, 0.19):
            parts.append(box("leg", (0.05, 0.05, 0.36), (sx, sy, 0.18), "paint_blue"))
    parts.append(box("label", (0.32, 0.01, 0.16), (0, FRONT * 0.245, 0.62), "paint_white"))
    parts.append(box("door", (0.44, 0.02, 0.22), (0, FRONT * 0.22, 1.02), "paint_blue", rotation=(FRONT * math.radians(35), 0, 0)))
    parts.append(box("handle", (0.24, 0.03, 0.03), (0, FRONT * 0.255, 1.08), "metal_alu"))
    ship(finalize(parts, "mailbox_usps"), "street/mailbox_usps", "mailbox")

# ----------------------------------------------------------------------------- 14-15. street sign pole, banners

def gen_street_sign_pole():
    parts = [cylinder_bottom("pole", 0.035, 3.0, material="iron_painted", segments=10),
             sphere("cap", 0.045, (0, 0, 3.0), "iron_painted", 8),
             box("blade_a", (0.8, 0.02, 0.2), (0.0, 0, 2.85), "paint_green"),
             box("blade_b", (0.02, 0.8, 0.2), (0, 0.0, 2.62), "paint_green"),
             box("np_plate", (0.3, 0.015, 0.45), (0, FRONT * 0.045, 2.2), "paint_white"),
             box("np_border", (0.28, 0.005, 0.03), (0, FRONT * 0.055, 2.38), "paint_red"),
             box("np_text", (0.22, 0.005, 0.12), (0, FRONT * 0.055, 2.18), "paint_red")]
    sign_a = box("sign_a", (0.74, 0.03, 0.16), (0.0, 0, 2.85), "screen")
    sign_b = box("sign_b", (0.03, 0.74, 0.16), (0, 0.0, 2.62), "screen")
    objs = finalize(parts, "street_sign_pole", keep_xy=True, separate=[sign_a, sign_b])
    ship(objs, "street/street_sign_pole", "street_sign", origin="pole_base", signs={"sign_a": "along X", "sign_b": "along Y"})

def gen_banner_bracket():
    parts = [cylinder("clamp_t", 0.09, 0.06, (0, 0, 1.05), "metal_black", 10),
             cylinder("clamp_b", 0.09, 0.06, (0, 0, -1.05), "metal_black", 10)]
    for sx in (-1, 1):
        for z in (1.05, -1.05):
            parts.append(xcyl("arm", 0.015, 0.75, (sx * 0.42, 0, z), "metal_black", 6))
        parts.append(box("banner", (0.6, 0.01, 2.0), (sx * 0.5, 0, 0), "fabric_red"))
    main = join(parts, "banner_pole_bracket")
    bpy.ops.object.select_all(action='DESELECT'); main.select_set(True)
    bpy.context.view_layer.objects.active = main
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ship([main], "street/banner_pole_bracket", "banner", origin="pole_attachment_point", attach_height=5.0,
         note="origin is the pole axis at the banner mid-height; place at pole_pos + 5 m up")

# ----------------------------------------------------------------------------- 16. planters

def gen_planters():
    parts = [lathe("planter", [(0.6, 0), (0.6, 0.08), (0.66, 0.1), (0.74, 0.55), (0.75, 0.62), (0.68, 0.62), (0.68, 0.5), (0.01, 0.5)], "concrete", 16),
             cylinder("soil", 0.66, 0.02, (0, 0, 0.53), "soil", 16)]
    ship(finalize(parts, "planter_large", keep_xy=True), "street/planter_large", "planter")
    parts = [box_bottom("body", (1.2, 1.2, 0.6), material="granite_grey"),
             box("soil", (1.06, 1.06, 0.02), (0, 0, 0.6), "soil"),
             box("lip", (1.24, 1.24, 0.05), (0, 0, 0.575), "granite_grey")]
    ship(finalize(parts, "planter_square"), "street/planter_square", "planter")
    parts = [box_bottom("body", (3.0, 0.8, 0.65), material="concrete"),
             box("soil", (2.84, 0.64, 0.02), (0, 0, 0.65), "soil"),
             box("lip", (3.06, 0.86, 0.05), (0, 0, 0.625), "concrete")]
    ship(finalize(parts, "planter_long"), "street/planter_long", "planter")

# ----------------------------------------------------------------------------- 17-18. kiosks

def gen_kiosk_wayfinding():
    parts = [box_bottom("base", (1.0, 0.3, 0.05), material="metal_black"),
             box("pylon", (0.9, 0.16, 2.35), (0, 0, 1.225), "metal_black"),
             box("cap", (0.94, 0.2, 0.05), (0, 0, 2.375), "metal_black")]
    panel_a = box("panel_a", (0.8, 0.02, 1.7), (0, FRONT * 0.08, 1.35), "screen")
    panel_b = box("panel_b", (0.8, 0.02, 1.7), (0, -FRONT * 0.08, 1.35), "screen")
    objs = finalize(parts, "kiosk_wayfinding", separate=[panel_a, panel_b])
    ship(objs, "street/kiosk_wayfinding", "kiosk", panels=["panel_a", "panel_b"])

def gen_garage_kiosk():
    W, D, H = 4.0, 3.0, 3.2
    parts = [box("slab", (W, D, 0.1), (0, 0, 0.05), "concrete")]
    # stair pit (front-left) going below ground
    pit_w, pit_d, depth = 1.6, 2.4, 1.5
    px, py = -W / 2 + 0.2 + pit_w / 2, -D / 2 + 0.2 + pit_d / 2
    parts.append(box("pit_floor", (pit_w, pit_d, 0.05), (px, py, -depth), "concrete_dark"))
    parts.append(box("pit_wall_l", (0.05, pit_d, depth + 0.1), (px - pit_w / 2, py, -depth / 2 + 0.05), "concrete_dark"))
    parts.append(box("pit_wall_r", (0.05, pit_d, depth + 0.1), (px + pit_w / 2, py, -depth / 2 + 0.05), "concrete_dark"))
    parts.append(box("pit_wall_b", (pit_w, 0.05, depth + 0.1), (px, py + pit_d / 2, -depth / 2 + 0.05), "concrete_dark"))
    nsteps = 6
    for i in range(nsteps):
        rise = depth / nsteps; run = pit_d / nsteps
        parts.append(box("step", (pit_w, run, rise), (px, py - pit_d / 2 + run * (i + 0.5), -rise * (i + 0.5)), "concrete"))
    parts.append(box("rail", (0.03, pit_d - 0.2, 0.9), (px + pit_w / 2 - 0.08, py, 0.5), "steel"))
    # steel frame + glass
    for x in (-W / 2 + 0.1, 0, W / 2 - 0.1):
        for y in (-D / 2 + 0.1, D / 2 - 0.1):
            if x == 0 and y < 0: continue
            parts.append(box("post", (0.12, 0.12, H - 0.15), (x, y, 0.1 + (H - 0.15) / 2), "steel"))
    parts.append(box("glass_back", (W - 0.3, 0.02, H - 0.35), (0, D / 2 - 0.1, 0.1 + (H - 0.35) / 2), "glass_clear"))
    parts.append(box("glass_l", (0.02, D - 0.3, H - 0.35), (-W / 2 + 0.1, 0, 0.1 + (H - 0.35) / 2), "glass_clear"))
    parts.append(box("glass_r", (0.02, D - 0.3, H - 0.35), (W / 2 - 0.1, 0, 0.1 + (H - 0.35) / 2), "glass_clear"))
    parts.append(box("glass_f", (W / 2 - 0.3, 0.02, H - 0.35), (W / 4 + 0.05, -D / 2 + 0.1, 0.1 + (H - 0.35) / 2), "glass_clear"))
    parts.append(box("roof", (W + 0.4, D + 0.4, 0.15), (0, 0, H - 0.075), "steel"))
    parts.append(box("fascia_bar", (W + 0.4, 0.12, 0.5), (0, -D / 2 - 0.14, H - 0.25), "metal_black"))
    fascia = box("fascia", (W - 0.4, 0.02, 0.4), (0, -D / 2 - 0.21, H - 0.25), "screen")
    objs = finalize(parts, "garage_kiosk", ground=0.0, separate=[fascia])
    ship(objs, "street/garage_kiosk", "garage_kiosk", height=H, depth_below_ground=depth, fascia="fascia",
         note="stair pit extends 1.5 m below z=0; ground level is z=0")

# ----------------------------------------------------------------------------- 19. manhole, catch basin

def gen_drainage():
    parts = [cylinder("cover", 0.35, 0.03, (0, 0, 0.015), "iron_painted", 24),
             cylinder("ring", 0.38, 0.012, (0, 0, 0.006), "iron_painted", 24)]
    ship(finalize(parts, "manhole", keep_xy=True), "street/manhole", "manhole")
    parts = [box_bottom("curb", (1.0, 0.35, 0.15), material="concrete"),
             box("inlet", (0.8, 0.06, 0.1), (0, FRONT * 0.16, 0.055), "concrete_dark"),
             box("lintel", (1.0, 0.36, 0.03), (0, 0, 0.135), "concrete"),
             box("grate", (0.6, 0.5, 0.025), (0, FRONT * 0.42, 0.0125), "iron_painted")]
    ship(finalize(parts, "catch_basin"), "street/catch_basin", "catch_basin")

# ----------------------------------------------------------------------------- 20-21. Muni signs

def rounded_plate(name, w, h_rect, z_bot, thick, material, rounded_top=True, y=0.0):
    """Sign plate in XZ with a semicircular top (radius w/2), extruded `thick` along Y."""
    prof = [(-w / 2, z_bot), (w / 2, z_bot), (w / 2, z_bot + h_rect)]
    if rounded_top:
        for i in range(1, 8):
            a = math.pi * i / 8
            prof.append((w / 2 * math.cos(a), z_bot + h_rect + w / 2 * math.sin(a)))
    prof.append((-w / 2, z_bot + h_rect))
    return profile_y(name, prof, thick, material, location=(0, y, 0))

def gen_cable_car_stop_sign():
    parts = [cylinder_bottom("pole", 0.03, 2.6, material="iron_painted", segments=8),
             rounded_plate("plate", 0.45, 0.35, 2.0, 0.02, "paint_maroon"),
             box("bracket", (0.08, 0.06, 0.4), (0, 0.04, 2.25), "iron_painted")]
    face = rounded_plate("sign_face", 0.40, 0.31, 2.02, 0.035, "screen")
    objs = finalize(parts, "cable_car_stop_sign", keep_xy=True, separate=[face])
    ship(objs, "street/cable_car_stop_sign", "sign", origin="pole_base", screen="sign_face")

def gen_muni_stop_pole():
    parts = [cylinder_bottom("pole", 0.03, 2.6, material="iron_painted", segments=8),
             box("plate", (0.32, 0.02, 0.5), (0, 0, 2.3), "paint_white"),
             box("stripe", (0.32, 0.005, 0.08), (0, FRONT * 0.012, 2.5), "paint_red"),
             box("plate2", (0.32, 0.02, 0.18), (0, 0, 1.95), "paint_white")]
    face = box("sign_face", (0.28, 0.035, 0.3), (0, 0, 2.24), "screen")
    objs = finalize(parts, "muni_stop_pole", keep_xy=True, separate=[face])
    ship(objs, "street/muni_stop_pole", "sign", origin="pole_base", screen="sign_face")

# ----------------------------------------------------------------------------- 22-24. barricade, cone, dumpster

def gen_barricade():
    parts = []
    lean = math.radians(15)
    for sx in (-0.55, 0.55):
        for sy in (-1, 1):
            parts.append(box("leg", (0.04, 0.09, 1.0), (sx, sy * 0.14, 0.5), "paint_white", rotation=(sy * lean, 0, 0)))
        parts.append(box("brace", (0.04, 0.5, 0.06), (sx, 0, 0.3), "paint_white"))
    n = 6
    for i in range(n):
        parts.append(box("stripe", (1.4 / n, 0.03, 0.25), (-0.7 + 1.4 / n * (i + 0.5), 0, 0.85), "paint_white" if i % 2 else "paint_red"))
    parts.append(box("rail2", (1.4, 0.03, 0.15), (0, 0, 0.5), "paint_white"))
    ship(finalize(parts, "barricade_a_frame"), "street/barricade_a_frame", "barricade")

def gen_cone():
    parts = [box_bottom("base", (0.38, 0.38, 0.03), material="plastic_black"),
             lathe("cone", [(0.16, 0.03), (0.105, 0.3), (0.10, 0.3), (0.08, 0.42), (0.075, 0.42), (0.035, 0.69), (0.01, 0.7)], "paint_red", 12),
             lathe("band", [(0.108, 0.3), (0.083, 0.42)], "paint_white", 12)]
    ship(finalize(parts, "cone_traffic", keep_xy=True), "street/cone_traffic", "cone")

def gen_dumpster():
    parts = [box("body", (1.8, 1.2, 1.1), (0, 0, 0.2 + 0.55), "paint_green"),
             box("lid", (1.84, 1.24, 0.06), (0, 0, 1.28), "paint_green", rotation=(math.radians(-4), 0, 0)),
             box("rail_f", (1.8, 0.04, 0.08), (0, FRONT * 0.62, 0.7), "paint_green"),
             box("pocket_l", (0.2, 0.25, 0.25), (-0.7, FRONT * 0.6, 0.55), "steel"),
             box("pocket_r", (0.2, 0.25, 0.25), (0.7, FRONT * 0.6, 0.55), "steel")]
    for sx in (-0.75, 0.75):
        for sy in (-0.45, 0.45):
            parts.append(xcyl("wheel", 0.1, 0.06, (sx, sy, 0.1), "rubber", 8))
    ship(finalize(parts, "dumpster"), "street/dumpster", "dumpster")

# ----------------------------------------------------------------------------- 25. sidewalk scaffold

def gen_scaffold():
    L, D, H = 3.0, 1.5, 4.0
    parts = []
    for x in (-L / 2, L / 2):
        for y in (-D / 2, D / 2):
            parts.append(cylinder_bottom("post", 0.03, H, (x, y, 0), "steel", 8))
            parts.append(box("baseplate", (0.15, 0.15, 0.02), (x, y, 0.01), "steel"))
    for z in (1.0, 2.0, 3.3):
        for y in (-D / 2, D / 2):
            parts.append(xcyl("ledger", 0.022, L, (0, y, z), "steel", 6))
        for x in (-L / 2, L / 2):
            parts.append(ycyl("transom", 0.022, D, (x, 0, z), "steel", 6))
    parts.append(tube("brace", [(-L / 2, D / 2, 0.3), (L / 2, D / 2, 3.2)], 0.02, "steel", 6))
    parts.append(tube("brace2", [(L / 2, -D / 2, 0.3), (-L / 2, -D / 2, 3.2)], 0.02, "steel", 6))
    parts.append(box("deck", (L, D, 0.05), (0, 0, 3.35), "wood_light"))
    parts.append(box("parapet_f", (L, 0.02, 0.6), (0, -D / 2, 3.68), "wood_light"))
    parts.append(box("parapet_b", (L, 0.02, 0.6), (0, D / 2, 3.68), "wood_light"))
    parts.append(box("toe", (L, 0.03, 0.15), (0, -D / 2 - 0.02, 3.45), "paint_green"))
    parts.append(box("roof", (L, D + 0.3, 0.02), (0, 0, H - 0.01), "wood_light"))
    ship(finalize(parts, "scaffold_sidewalk_3m"), "street/scaffold_sidewalk_3m", "scaffold", tileable_axis="X", tile_length=L)

# ----------------------------------------------------------------------------- 26-28. hearts, flagpole, pigeon

def gen_hearts_sculpture():
    parts = [box_bottom("plinth", (0.9, 0.9, 0.5), material="granite_grey"),
             cylinder("wedge", 0.02, 0.95, (0, 0, 0.5 + 0.475), "paint_red", 12, radius2=0.66),
             lowsphere("lobe_l", 0.45, (-0.34, 0, 1.5), "paint_red", 12, 6),
             lowsphere("lobe_r", 0.45, (0.34, 0, 1.5), "paint_red", 12, 6)]
    for o in parts[1:]:
        o.scale = (1, 0.6, 1)
    ship(finalize(parts, "hearts_sculpture"), "street/hearts_sculpture", "sculpture", recolor="paint_red")

def gen_flagpole():
    parts = [lathe("pole", [(0.12, 0), (0.12, 0.1), (0.07, 0.12), (0.045, 9.8), (0.03, 10.0)], "metal_alu", 10),
             sphere("finial", 0.09, (0, 0, 10.08), "brass", 8),
             xcyl("yard", 0.015, 0.1, (0.05, 0, 9.9), "metal_alu", 5)]
    flag = grid_plane("flag", (1.5, 0.9), (0.8, 0, 9.45), "fabric_red", 6, 3, rotation=(math.pi / 2, 0, 0))
    objs = finalize(parts, "flagpole_10m", keep_xy=True, separate=[flag])
    ship(objs, "street/flagpole_10m", "flagpole", origin="pole_base", flag="flag", flag_dir="+X")

def gen_pigeon():
    parts = [lowsphere("body", 0.07, (0, 0, 0.12), "plastic_grey", 6, 4, scale=(1.0, 1.9, 0.9)),
             lowsphere("head", 0.035, (0, FRONT * 0.14, 0.17), "plastic_grey", 6, 4),
             box("tail", (0.05, 0.10, 0.01), (0, -FRONT * 0.17, 0.13), "plastic_grey", rotation=(-FRONT * math.radians(15), 0, 0)),
             ycyl("beak", 0.008, 0.03, (0, FRONT * 0.18, 0.165), "paint_yellow", 4, r2=0.001)]
    for sx in (-0.02, 0.02):
        parts.append(cylinder("leg", 0.005, 0.07, (sx, 0, 0.035), "paint_red", 3))
    ship(finalize(parts, "pigeon"), "street/pigeon", "pigeon")

# ----------------------------------------------------------------------------- 29-30. fence, handrail, curb ramp

def gen_fence_and_rail():
    parts = [box("post", (0.05, 0.05, 1.2), (-0.475, 0, 0.6), "iron_painted"),
             cylinder("post_cap", 0.035, 0.05, (-0.475, 0, 1.22), "iron_painted", 4, radius2=0.005)]
    for z in (0.3, 1.0):
        parts.append(box("rail", (1.0, 0.03, 0.04), (0, 0, z), "iron_painted"))
    for i in range(6):
        x = -0.475 + (i + 1) * (1.0 / 6.5)
        parts.append(box("picket", (0.018, 0.018, 1.12), (x, 0, 0.56), "iron_painted"))
        parts.append(cylinder("finial", 0.022, 0.06, (x, 0, 1.15), "iron_painted", 4, radius2=0.002))
    objs = finalize(parts, "fence_iron_1m", keep_xy=True)
    ship(objs, "street/fence_iron_1m", "fence", tileable_axis="X", tile_length=1.0)
    parts = [xcyl("rail", 0.022, 1.0, (0, 0, 0.9), "steel", 8), xcyl("rail_low", 0.018, 1.0, (0, 0, 0.55), "steel", 8)]
    for x in (-0.45, 0.45):
        parts.append(cylinder_bottom("post", 0.02, 0.9, (x, 0, 0), "steel", 8))
        parts.append(cylinder("foot", 0.05, 0.01, (x, 0, 0.005), "steel", 8))
    objs = finalize(parts, "rail_handrail_1m", keep_xy=True)
    ship(objs, "street/rail_handrail_1m", "handrail", tileable_axis="X", tile_length=1.0)

def gen_curb_ramp():
    W, run, rise = 1.5, 1.2, 0.15
    ramp = profile_x("ramp", [(0.6, 0), (0.6, rise), (0.6 - run, 0)], W, "concrete")
    ang = math.atan2(rise, run)
    y_c = 0.6 - run + 0.32
    z_c = rise * (0.32 / run)
    domes = box("domes", (W, 0.6, 0.012), (0, y_c, z_c + 0.006 / math.cos(ang)), "paint_yellow", rotation=(ang, 0, 0))
    flare_l = prism("flare_l", [(-W / 2, 0.6), (-W / 2 - 0.5, 0.6), (-W / 2, 0.6 - run)], rise, 0, "concrete")
    flare_r = prism("flare_r", [(W / 2, 0.6), (W / 2, 0.6 - run), (W / 2 + 0.5, 0.6)], rise, 0, "concrete")
    ship(finalize([ramp, domes, flare_l, flare_r], "curb_ramp"), "street/curb_ramp", "curb_ramp", slope_dir="-Y")

# ----------------------------------------------------------------------------- main

def main():
    reset_scene()
    gen_streetlight_teardrop(); gen_streetlight_double(); gen_streetlight_pedestrian(); gen_streetlight_plaza_globe()
    gen_traffic_signal_mast(); gen_traffic_signal_post()
    gen_parking_meter()
    gen_hydrant("paint_blue", "street/hydrant_sf"); gen_hydrant("paint_red", "street/hydrant_sf_red")
    gen_trashcan("paint_green", "street/trashcan_sf"); gen_trashcan("metal_black", "street/trashcan_black")
    gen_bench_plaza(); gen_bench_wood(); gen_bench_metal()
    gen_bollards()
    gen_newsrack("paint_grey", "street/newsrack"); gen_newsrack("paint_blue", "street/newsrack_blue")
    gen_bike_racks()
    gen_bus_shelter()
    gen_tree_grate()
    gen_utility_boxes()
    gen_mailbox()
    gen_street_sign_pole(); gen_banner_bracket()
    gen_planters()
    gen_kiosk_wayfinding(); gen_garage_kiosk()
    gen_drainage()
    gen_cable_car_stop_sign(); gen_muni_stop_pole()
    gen_barricade(); gen_cone(); gen_dumpster()
    gen_scaffold()
    gen_hearts_sculpture(); gen_flagpole(); gen_pigeon()
    gen_fence_and_rail(); gen_curb_ramp()
    write_manifest("street")
    print("\n%-36s %6s %7s  %s" % ("asset", "tris", "height", "footprint"))
    for rel, tris, h, fp in SUMMARY:
        flag = "" if tris < 800 else ("  (>800)" if tris < BUDGET else "  OVER BUDGET")
        print("%-36s %6d %7.2f  %.2f x %.2f%s" % (rel, tris, h, fp[0], fp[1], flag))
    print("total assets:", len(SUMMARY), " max tris:", max(t for _, t, _, _ in SUMMARY))

if __name__ == "__main__":
    main()
