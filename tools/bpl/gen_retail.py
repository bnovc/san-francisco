"""
gen_retail.py — retail interior fixtures, Nintendo character statues and storefront dressing.
Run:  tools/bpl/.venv/bin/python tools/bpl/gen_retail.py

Conventions (see bpl_lib.py): metres, origin = bottom-centre, ONLY MATERIAL_LIBRARY names.
Front of every asset faces Blender -Y (= Three.js +Z after the Y-up export).
Objects the runtime looks up by name are kept as separate child meshes parented to the root:
  * 'screen' (one or more; Blender suffixes .001/.002 when several) — quads with 0..1 UVs, normal facing front
  * 'products' — joined product blocks on shelving
Budgets: fixtures < 1500 tris, characters < 2500 tris (enforced; the script exits non-zero on failure).
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from bpl_lib import *
import bpl_lib  # noqa

FIXTURE_BUDGET = 1500
CHAR_BUDGET = 2500
TABLE = []      # (rel_name, tris, budget, height, w, d)
OVER = []

# ----------------------------------------------------------------------------- helpers

def select_only(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]

def apply_all(objs):
    select_only(objs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def smooth(obj, sides_only=False, thresh=0.9):
    for p in obj.data.polygons:
        if not sides_only or abs(p.normal.z) < thresh:
            p.use_smooth = True
    return obj

def rot_x(v, a):
    v = Vector(v)
    return Vector((v.x, v.y * math.cos(a) - v.z * math.sin(a), v.y * math.sin(a) + v.z * math.cos(a)))

def tilt(obj, pivot, a, local, extra_rx=0.0):
    """Place obj at pivot + Rx(a)*local with rotation a about X (negative a = lean back, top toward +Y)."""
    obj.location = Vector(pivot) + rot_x(local, a)
    obj.rotation_euler = (a + extra_rx, 0, 0)
    return obj

def screen_quad(name, w, h, loc=(0, 0, 0), rot=(0, 0, 0), material="screen"):
    """Single quad facing -Y (front) with UVs (0,0) bottom-left .. (1,1) top-right as seen from the front."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    vs = [bm.verts.new(p) for p in ((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2))]
    f = bm.faces.new(vs)
    for l, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        l[uvl].uv = uv
    obj = mesh_from_bmesh(bm, name, material)
    obj.location = loc
    obj.rotation_euler = rot
    return obj

def band(name, r, z0, z1, segs=32, material="screen"):
    """Open cylindrical band with wrap-around UVs; u=0.5 at the front (-Y), seam at the back."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    bot, top = [], []
    for i in range(segs + 1):
        t = -math.pi + 2 * math.pi * i / segs
        x, y = r * math.sin(t), -r * math.cos(t)
        bot.append(bm.verts.new((x, y, z0)))
        top.append(bm.verts.new((x, y, z1)))
    for i in range(segs):
        f = bm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
        u0, u1 = i / segs, (i + 1) / segs
        for l, uv in zip(f.loops, ((u0, 0), (u1, 0), (u1, 1), (u0, 1))):
            l[uvl].uv = uv
    return smooth(mesh_from_bmesh(bm, name, material))

def ico(name, r, loc, material, sub=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    obj = mesh_from_bmesh(bm, name, material)
    obj.location = loc
    return smooth(obj)

def ellipsoid(name, radii, loc, material, segments=12, rotation=(0, 0, 0)):
    obj = sphere(name, 1.0, loc, material, segments)
    obj.scale = radii
    obj.rotation_euler = rotation
    return smooth(obj)

def ball(name, r, loc, material, segments=12):
    return smooth(sphere(name, r, loc, material, segments))

def cyl(name, r, h, loc, material, segments=12, rotation=(0, 0, 0), r2=None):
    return smooth(cylinder(name, r, h, loc, material, segments, rotation, radius2=r2), sides_only=True)

def hemisphere(name, r, loc, material, segments=16, rings=4):
    prof = [(r * math.cos(math.pi / 2 * i / rings), r * math.sin(math.pi / 2 * i / rings)) for i in range(rings)]
    prof.append((0.02 * r, r))
    obj = lathe(name, prof, material, segments)
    obj.location = loc
    return smooth(obj, sides_only=True, thresh=0.999)

def tube(name, pts, r, material, sides=6):
    """Tube swept along a polyline of 3D points (closed ends)."""
    bm = bmesh.new()
    pts = [Vector(p) for p in pts]
    rings = []
    for i, p in enumerate(pts):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        t.normalize()
        up = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((0, 1, 0))
        n = t.cross(up).normalized()
        b = t.cross(n).normalized()
        rings.append([bm.verts.new(p + n * (r * math.cos(2 * math.pi * k / sides)) + b * (r * math.sin(2 * math.pi * k / sides)))
                      for k in range(sides)])
    for i in range(len(rings) - 1):
        for k in range(sides):
            k2 = (k + 1) % sides
            bm.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return smooth(mesh_from_bmesh(bm, name, material), sides_only=True, thresh=2.0)

def bevel_box(name, size, loc, material, offset=0.03, segments=2):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=bm.edges[:] + bm.verts[:], offset=offset, segments=segments, affect='EDGES')
    obj = mesh_from_bmesh(bm, name, material)
    obj.location = loc
    return obj

def auto_uv(obj):
    """Cheap box projection (1 UV unit = 1 m) so the runtime's textured PBR materials have something to map."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.verify()
    bm.normal_update()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            l[uvl].uv = (c.y, c.z) if ax == 0 else ((c.x, c.z) if ax == 1 else (c.x, c.y))
    bm.to_mesh(me)
    bm.free()
    return obj

def finalize(name, parts, children=()):
    """Apply transforms, join `parts` into the root mesh, parent `children` (kept separate), origin -> bottom-centre."""
    parts = [p for p in parts if p is not None]
    children = [c for c in children if c is not None]
    apply_all(parts + children)
    body = join(parts, name) if len(parts) > 1 else parts[0]
    body.name = name
    auto_uv(body)
    for c in children:
        if not c.name.startswith("screen"):
            auto_uv(c)
    objs = [body] + children
    xs, ys, zs = [], [], []
    for o in objs:
        for v in o.data.vertices:
            xs.append(v.co.x); ys.append(v.co.y); zs.append(v.co.z)
    off = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    for o in objs:
        for v in o.data.vertices:
            v.co -= off
    for c in children:
        c.parent = body
    return body

def export_asset(body, rel, kind, budget=FIXTURE_BUDGET):
    objs = [body] + list(body.children_recursive)
    xs, ys, zs = [], [], []
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    w, d, h = max(xs) - min(xs), max(ys) - min(ys), max(zs)
    export_glb(body, rel, {"kind": kind, "height": round(h, 3), "footprint": [round(w, 3), round(d, 3)]})
    tris = bpl_lib._manifest[rel]["tris"]
    TABLE.append((rel, tris, budget, h, w, d))
    if tris >= budget:
        OVER.append((rel, tris, budget))
    clear_objects()

def character(name, parts, height, rel):
    body = finalize(name, parts)
    zmax = max(v.co.z for v in body.data.vertices)
    k = height / zmax
    for v in body.data.vertices:
        v.co *= k
    export_asset(body, rel, "character", CHAR_BUDGET)

def pos_monitor(x, y, z, w=0.32, h=0.22, a=math.radians(-15), sw=0.29, sh=0.19):
    """Small POS/register display on a stub post; returns (parts, screen)."""
    post = cyl("post", 0.02, 0.12, (x, y, z + 0.06), "metal_alu", 8)
    mon = box("monitor", (w, 0.02, h), material="plastic_black")
    tilt(mon, (x, y, z + 0.12), a, (0, 0, h / 2))
    scr = screen_quad("screen", sw, sh)
    tilt(scr, (x, y, z + 0.12), a, (0, -0.0105, h / 2))
    return [post, mon], scr

# ----------------------------------------------------------------------------- APPLE

def apple_table(name, L, rel):
    top = box("top", (L, 1.2, 0.08), (0, 0, 0.86), "wood_oak")
    legs = [box("leg", (0.10, 0.10, 0.82), (sx * (L / 2 - 0.16), sy * 0.44, 0.41), "wood_oak")
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    export_asset(finalize(name, [top] + legs), rel, "table")

def apple_iphone_stand():
    puck = cylinder_bottom("puck", 0.06, 0.02, material="plastic_white", segments=8)
    a = math.radians(-20)
    slab = tilt(box("slab", (0.075, 0.008, 0.15), material="plastic_black"), (0, 0.01, 0.02), a, (0, 0, 0.075))
    scr = tilt(screen_quad("screen", 0.068, 0.14), (0, 0.01, 0.02), a, (0, -0.0045, 0.075))
    export_asset(finalize("apple_iphone_stand", [puck, slab], [scr]), "retail/apple_iphone_stand", "device", 60)

def apple_ipad_stand():
    puck = cylinder_bottom("puck", 0.08, 0.02, material="plastic_white", segments=8)
    a = math.radians(-25)
    slab = tilt(box("slab", (0.25, 0.008, 0.18), material="plastic_black"), (0, 0.02, 0.02), a, (0, 0, 0.09))
    scr = tilt(screen_quad("screen", 0.235, 0.165), (0, 0.02, 0.02), a, (0, -0.0045, 0.09))
    export_asset(finalize("apple_ipad_stand", [puck, slab], [scr]), "retail/apple_ipad_stand", "device")

def apple_macbook():
    base = box("base", (0.30, 0.21, 0.012), (0, 0, 0.006), "metal_alu")
    keys = box("keys", (0.26, 0.10, 0.004), (0, 0.03, 0.013), "plastic_black")
    pad = box("pad", (0.10, 0.06, 0.003), (0, -0.06, 0.013), "plastic_grey")
    a = math.radians(-20)
    hinge = (0, 0.105, 0.012)
    lid = tilt(box("lid", (0.30, 0.006, 0.20), material="metal_alu"), hinge, a, (0, 0, 0.10))
    scr = tilt(screen_quad("screen", 0.28, 0.175), hinge, a, (0, -0.0035, 0.10))
    export_asset(finalize("apple_macbook", [base, keys, pad, lid], [scr]), "retail/apple_macbook", "device")

def apple_imac():
    foot = box("foot", (0.22, 0.18, 0.012), (0, 0.02, 0.006), "metal_alu")
    neck = box("neck", (0.20, 0.02, 0.22), (0, 0.06, 0.12), "metal_alu")
    panel = box("panel", (0.55, 0.018, 0.40), (0, 0, 0.29), "metal_alu")
    scr = screen_quad("screen", 0.52, 0.30, (0, -0.0095, 0.33))
    export_asset(finalize("apple_imac", [foot, neck, panel], [scr]), "retail/apple_imac", "device")

def apple_watch_stand():
    puck = cylinder_bottom("puck", 0.03, 0.01, material="plastic_white", segments=8)
    post = cyl("post", 0.006, 0.05, (0, 0.004, 0.035), "metal_alu", 6)
    watch = box("watch", (0.036, 0.012, 0.044), (0, -0.004, 0.075), "plastic_black")
    strap = box("strap", (0.03, 0.006, 0.09), (0, 0.002, 0.075), "plastic_black")
    scr = screen_quad("screen", 0.03, 0.036, (0, -0.0101, 0.075))
    export_asset(finalize("apple_watch_stand", [puck, post, watch, strap], [scr]), "retail/apple_watch_stand", "device")

def apple_headphones():
    base = cylinder_bottom("base", 0.07, 0.015, material="metal_alu", segments=12)
    post = cyl("post", 0.01, 0.245, (0, 0, 0.1375), "metal_alu", 8)
    hook = cyl("hook", 0.012, 0.07, (0, 0, 0.26), "metal_alu", 8, rotation=(0, math.pi / 2, 0))
    pts = [(0.10 * math.cos(t), 0, 0.15 + 0.10 * math.sin(t)) for t in [math.pi * i / 10 for i in range(11)]]
    bandt = tube("band", pts, 0.012, "plastic_black", 6)
    parts = [base, post, hook, bandt]
    for sx in (-1, 1):
        parts.append(cyl("cup", 0.045, 0.035, (sx * 0.115, 0, 0.155), "plastic_black", 12, rotation=(0, math.pi / 2, 0)))
        parts.append(cyl("pad", 0.04, 0.016, (sx * 0.09, 0, 0.155), "fabric_black", 12, rotation=(0, math.pi / 2, 0)))
    export_asset(finalize("apple_headphones", parts), "retail/apple_headphones", "device")

def apple_avenue_shelf():
    W, H, D = 3.0, 3.0, 0.5
    parts = [
        box("pierL", (0.15, D, H), (-(W / 2 - 0.075), 0, H / 2), "sandstone"),
        box("pierR", (0.15, D, H), ((W / 2 - 0.075), 0, H / 2), "sandstone"),
        box("lintel", (W - 0.3, D, 0.15), (0, 0, H - 0.075), "sandstone"),
        box("plinth", (W - 0.3, D, 0.10), (0, 0, 0.05), "sandstone"),
        box("back", (W - 0.3, 0.04, H - 0.25), (0, D / 2 - 0.02, 0.10 + (H - 0.25) / 2), "sandstone"),
    ]
    for z in (0.45, 0.85, 1.25):
        parts.append(box("shelf", (W - 0.3, 0.42, 0.04), (0, D / 2 - 0.04 - 0.21, z - 0.02), "wood_oak"))
    scr = screen_quad("screen", 2.6, 1.2, (0, D / 2 - 0.041, 2.05))
    export_asset(finalize("apple_avenue_shelf", parts, [scr]), "retail/apple_avenue_shelf", "shelf")

def apple_stool():
    seat = bevel_box("seat", (0.45, 0.45, 0.45), (0, 0, 0.225), "fabric_cream", 0.035, 2)
    export_asset(finalize("apple_stool", [seat]), "retail/apple_stool", "seat")

def apple_bench_forum():
    parts = [box("top", (3.0, 0.5, 0.08), (0, 0, 0.41), "wood_light"),
             box("mid", (0.08, 0.40, 0.37), (0, 0, 0.185), "wood_light")]
    for sx in (-1, 1):
        parts.append(box("end", (0.08, 0.46, 0.37), (sx * 1.36, 0, 0.185), "wood_light"))
    export_asset(finalize("apple_bench_forum", parts), "retail/apple_bench_forum", "seat")

def apple_planter_tree_box():
    parts = [box("wallF", (2.0, 0.1, 0.6), (0, -0.95, 0.3), "granite_grey"),
             box("wallB", (2.0, 0.1, 0.6), (0, 0.95, 0.3), "granite_grey"),
             box("wallL", (0.1, 1.8, 0.6), (-0.95, 0, 0.3), "granite_grey"),
             box("wallR", (0.1, 1.8, 0.6), (0.95, 0, 0.3), "granite_grey"),
             box("soil", (1.82, 1.82, 0.50), (0, 0, 0.27), "soil")]
    export_asset(finalize("apple_planter_tree_box", parts), "retail/apple_planter_tree_box", "planter")

def apple_video_wall_frame():
    parts = [box("plate", (11.2, 0.10, 6.4), (0, 0.35, 3.4), "plastic_black"),
             box("stoneL", (0.3, 0.4, 6.8), (-5.75, 0.2, 3.4), "sandstone"),
             box("stoneR", (0.3, 0.4, 6.8), (5.75, 0.2, 3.4), "sandstone"),
             box("stoneB", (11.8, 0.4, 0.2), (0, 0.2, 0.1), "sandstone"),
             box("stoneT", (11.8, 0.4, 0.2), (0, 0.2, 6.7), "sandstone")]
    scr = screen_quad("screen", 11.0, 6.2, (0, 0.35 - 0.051, 3.4))
    export_asset(finalize("apple_video_wall_frame", parts, [scr]), "retail/apple_video_wall_frame", "screen_wall")

def apple_stair_module():
    step = box("step", (1.0, 0.30, 0.16), (0, 0, 0.08), "granite_grey")
    export_asset(finalize("apple_stair_module", [step]), "retail/apple_stair_module", "stair")

def apple_glass_balustrade_1m():
    parts = [box("channel", (1.0, 0.06, 0.05), (0, 0, 0.025), "metal_alu"),
             box("glass", (1.0, 0.016, 1.02), (0, 0, 0.55), "glass_clear"),
             box("rail", (1.0, 0.06, 0.04), (0, 0, 1.08), "metal_alu")]
    export_asset(finalize("apple_glass_balustrade_1m", parts), "retail/apple_glass_balustrade_1m", "balustrade")

def apple_genius_table():
    parts = [cyl("top", 0.8, 0.06, (0, 0, 0.87), "wood_oak", 32),
             cyl("column", 0.14, 0.81, (0, 0, 0.435), "wood_oak", 16),
             cyl("foot", 0.40, 0.03, (0, 0, 0.015), "wood_oak", 24)]
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        parts.append(cyl("stool", 0.19, 0.45, (1.08 * math.cos(a), 1.08 * math.sin(a), 0.225), "fabric_cream", 12))
    export_asset(finalize("apple_genius_table", parts), "retail/apple_genius_table", "table")

# ----------------------------------------------------------------------------- NINTENDO fixtures

def nintendo_gondola():
    W, D, H = 1.8, 0.9, 1.5
    parts = [box("base", (W, D, 0.12), (0, 0, 0.06), "plastic_white"),
             box("spine", (W, 0.06, H - 0.12), (0, 0, 0.12 + (H - 0.12) / 2), "plastic_white"),
             box("cap", (W, 0.14, 0.04), (0, 0, H - 0.02), "plastic_white")]
    shelf_z = (0.30, 0.62, 0.94, 1.26)
    prods = []
    mats = ("plastic_black", "paint_red", "plastic_white", "paint_red", "plastic_black")
    for side in (-1, 1):
        for z in shelf_z:
            parts.append(box("shelf", (W, 0.40, 0.03), (0, side * 0.23, z - 0.015), "plastic_white"))
            for k in range(5):
                x = -0.68 + k * 0.34
                prods.append(box("p", (0.16, 0.20, 0.18), (x, side * 0.21, z + 0.09), mats[(k + (z > 0.8)) % 5]))
        for z in (0.545, 1.185):
            parts.append(cyl("bar", 0.012, W - 0.1, (0, side * 0.09, z), "metal_alu", 8, rotation=(0, math.pi / 2, 0)))
            for k in range(5):
                parts.append(cyl("peg", 0.005, 0.14, (-0.7 + k * 0.35, side * 0.16, z), "metal_alu", 6, rotation=(math.pi / 2, 0, 0)))
    products = join(prods, "products")
    export_asset(finalize("nintendo_gondola", parts, [products]), "retail/nintendo_gondola", "gondola")

def nintendo_wall_shelf_3m():
    W, D, H = 3.0, 0.45, 2.6
    parts = [box("back", (W, 0.04, H - 0.6), (0, D / 2 - 0.02, (H - 0.6) / 2), "plastic_white"),
             box("sideL", (0.04, D, H - 0.6), (-(W / 2 - 0.02), 0, (H - 0.6) / 2), "plastic_white"),
             box("sideR", (0.04, D, H - 0.6), ((W / 2 - 0.02), 0, (H - 0.6) / 2), "plastic_white"),
             box("header", (W, D, 0.6), (0, 0, H - 0.3), "plastic_white"),
             box("kick", (W, 0.10, 0.10), (0, D / 2 - 0.07, 0.05), "paint_red")]
    prods = []
    mats = ("paint_red", "plastic_white", "plastic_black", "paint_red", "plastic_white", "paint_blue")
    for i, z in enumerate((0.30, 0.70, 1.10, 1.50, 1.90)):
        parts.append(box("shelf", (W - 0.08, 0.40, 0.03), (0, -0.015, z - 0.015), "plastic_white"))
        for k in range(6):
            x = -1.15 + k * 0.46
            prods.append(box("p", (0.30, 0.22, 0.26), (x, 0.0, z + 0.13), mats[(k + i) % 6]))
    products = join(prods, "products")
    scr = screen_quad("screen", W - 0.02, 0.58, (0, -D / 2 - 0.001, H - 0.3))
    export_asset(finalize("nintendo_wall_shelf_3m", parts, [scr, products]), "retail/nintendo_wall_shelf_3m", "shelf")

def nintendo_demo_kiosk():
    a = math.radians(-30)
    pivot = (0, 0.05, 0.95)
    parts = [box("ped", (0.8, 0.6, 0.95), (0, 0, 0.475), "plastic_white"),
             box("stripe", (0.81, 0.61, 0.06), (0, 0, 0.32), "paint_red"),
             tilt(box("mount", (0.56, 0.03, 0.36), material="plastic_black"), pivot, a, (0, 0, 0.18)),
             box("dock", (0.22, 0.09, 0.10), (0, -0.19, 1.0), "plastic_black"),
             box("console", (0.24, 0.02, 0.12), (0, -0.19, 1.07), "plastic_black"),
             box("jcL", (0.03, 0.022, 0.10), (-0.135, -0.19, 1.08), "paint_blue"),
             box("jcR", (0.03, 0.022, 0.10), (0.135, -0.19, 1.08), "paint_red")]
    scr = tilt(screen_quad("screen", 0.5, 0.3), pivot, a, (0, -0.016, 0.18))
    export_asset(finalize("nintendo_demo_kiosk", parts, [scr]), "retail/nintendo_demo_kiosk", "kiosk")

def nintendo_led_wall():
    bezel = box("bezel", (6.2, 0.12, 3.6), (0, 0, 1.8), "plastic_black")
    scr = screen_quad("screen", 6.0, 3.4, (0, -0.061, 1.8))
    export_asset(finalize("nintendo_led_wall", [bezel], [scr]), "retail/nintendo_led_wall", "screen_wall")

def nintendo_checkout():
    parts = [box("body", (4.0, 0.9, 0.92), (0, 0, 0.46), "plastic_white"),
             box("top", (4.06, 0.96, 0.04), (0, 0, 0.94), "plastic_white"),
             box("stripe", (4.02, 0.02, 0.18), (0, -0.45, 0.55), "paint_red")]
    screens = []
    for x in (-1.3, 0.0, 1.3):
        p, s = pos_monitor(x, 0.1, 0.96)
        parts += p
        screens.append(s)
        parts.append(box("reader", (0.08, 0.10, 0.05), (x + 0.35, -0.2, 0.985), "plastic_black"))
    export_asset(finalize("nintendo_checkout", parts, screens), "retail/nintendo_checkout", "counter")

def nintendo_plush_bin():
    parts = [cyl("bin", 0.6, 0.7, (0, 0, 0.35), "plastic_white", 24),
             cyl("rim", 0.62, 0.04, (0, 0, 0.70), "paint_red", 24)]
    cols = ("paint_red", "paint_yellow", "paint_green", "paint_blue")
    rng = random.Random(7)
    n = 0
    for layer, (z, count, rad) in enumerate(((0.66, 14, 0.46), (0.76, 10, 0.32), (0.86, 6, 0.16))):
        for i in range(count):
            t = 2 * math.pi * i / count + layer * 0.4
            r = rad if i % 2 == 0 or layer > 0 else rad * 0.55
            x, y = r * math.cos(t) + rng.uniform(-0.02, 0.02), r * math.sin(t) + rng.uniform(-0.02, 0.02)
            parts.append(ico("plush", 0.075, (x, y, z + rng.uniform(-0.02, 0.02)), cols[n % 4]))
            n += 1
    export_asset(finalize("nintendo_plush_bin", parts), "retail/nintendo_plush_bin", "bin")

def nintendo_warp_pipe():
    pipe = lathe("pipe", [(0.55, 0), (0.55, 1.3), (0.60, 1.3), (0.60, 1.6), (0.50, 1.6), (0.50, 1.40)], "paint_green", 24)
    smooth(pipe, sides_only=True, thresh=0.999)
    hole = cyl("hole", 0.5, 0.02, (0, 0, 1.41), "plastic_black", 24)
    export_asset(finalize("nintendo_warp_pipe", [pipe, hole]), "retail/nintendo_warp_pipe", "prop")

def nintendo_question_block():
    S = 0.9
    parts = [box("cube", (S, S, S), (0, 0, S / 2), "paint_yellow")]
    glyph = [" ### ", "#   #", "    #", "   # ", "  #  ", "     ", "  #  "]
    cell = 0.09
    faces = ((Vector((0, -1, 0)), Vector((1, 0, 0))), (Vector((0, 1, 0)), Vector((-1, 0, 0))),
             (Vector((-1, 0, 0)), Vector((0, -1, 0))), (Vector((1, 0, 0)), Vector((0, 1, 0))))
    for n, r in faces:
        along_y = abs(n.y) > 0.5
        size = (cell, 0.02, cell) if along_y else (0.02, cell, cell)
        for row, line in enumerate(glyph):
            for col, ch in enumerate(line):
                if ch != '#':
                    continue
                c = n * (S / 2 + 0.01) + r * ((col - 2) * cell) + Vector((0, 0, S / 2 + (3 - row) * cell))
                parts.append(box("q", size, tuple(c), "paint_white"))
        rs = (0.06, 0.02, 0.06) if along_y else (0.02, 0.06, 0.06)
        for su in (-1, 1):
            for sz in (-1, 1):
                c = n * (S / 2 + 0.01) + r * (su * 0.37) + Vector((0, 0, S / 2 + sz * 0.37))
                parts.append(box("rivet", rs, tuple(c), "wood_dark"))
    export_asset(finalize("nintendo_question_block", parts), "retail/nintendo_question_block", "prop")

def nintendo_pedestal_statue():
    ped = cyl("ped", 0.5, 0.5, (0, 0, 0.25), "plastic_white", 32)
    scr = band("screen", 0.505, 0.15, 0.32, 32)
    export_asset(finalize("nintendo_pedestal_statue", [ped], [scr]), "retail/nintendo_pedestal_statue", "pedestal")

def nintendo_switch2_display():
    a = math.radians(-12)
    pivot = (0, 0.05, 0.55)
    parts = [box("base", (1.2, 0.6, 0.05), (0, 0, 0.025), "metal_alu"),
             box("post", (0.14, 0.08, 0.52), (0, 0.06, 0.29), "metal_alu"),
             tilt(box("brace", (1.0, 0.04, 0.5), material="plastic_grey"), pivot, a, (0, 0.06, 0.31)),
             tilt(box("tablet", (1.40, 0.06, 0.62), material="plastic_black"), pivot, a, (0, 0, 0.31))]
    for side, accent in ((-1, "paint_blue"), (1, "paint_red")):
        parts.append(tilt(box("jc", (0.30, 0.07, 0.64), material="plastic_grey"), pivot, a, (side * 0.85, 0, 0.31)))
        parts.append(tilt(box("strip", (0.015, 0.075, 0.60), material=accent), pivot, a, (side * 0.705, 0, 0.31)))
        zs = 0.31 + (0.14 if side < 0 else -0.10)
        parts.append(tilt(cyl("stick", 0.045, 0.05, (0, 0, 0), "plastic_black", 8), pivot, a, (side * 0.85, -0.06, zs), math.pi / 2))
        zb = 0.31 + (-0.12 if side < 0 else 0.12)
        for dx, dz in ((0, 0.055), (0, -0.055), (0.055, 0), (-0.055, 0)):
            parts.append(tilt(cyl("btn", 0.02, 0.03, (0, 0, 0), "plastic_black", 8), pivot, a, (side * 0.85 + dx, -0.05, zb + dz), math.pi / 2))
    scr = tilt(screen_quad("screen", 1.30, 0.54), pivot, a, (0, -0.031, 0.31))
    export_asset(finalize("nintendo_switch2_display", parts, [scr]), "retail/nintendo_switch2_display", "device")

# ----------------------------------------------------------------------------- characters

def plumber(name, shirt, height, rel, slim=1.0):
    s = slim
    P = []
    for sx in (-1, 1):
        P.append(ellipsoid("shoe", (0.10, 0.15, 0.07), (sx * 0.12, -0.03, 0.07), "wood_dark", 10))
        P.append(cyl("leg", 0.075 * s, 0.28, (sx * 0.12, 0, 0.22), "paint_blue", 8))
        P.append(box("strap", (0.06, 0.03, 0.18), (sx * 0.11 * s, -0.19 * s, 0.86), "paint_blue"))
        P.append(ball("button", 0.025, (sx * 0.11 * s, -0.225 * s, 0.78), "paint_yellow", 6))
        P.append(cyl("arm", 0.06, 0.34, (sx * 0.33 * s, -0.02, 0.71), shirt, 8, rotation=(0, -sx * 0.5, 0)))
        P.append(ball("hand", 0.075, (sx * 0.42 * s, -0.03, 0.55), "paint_white", 8))
        P.append(ball("ear", 0.05, (sx * 0.25, 0.0, 1.13), "skin", 6))
        P.append(ellipsoid("moustache", (0.085, 0.05, 0.04), (sx * 0.075, -0.225, 1.04), "wood_dark", 8))
        P.append(ball("eye", 0.04, (sx * 0.075, -0.215, 1.20), "paint_white", 6))
        P.append(ball("pupil", 0.02, (sx * 0.075, -0.245, 1.20), "plastic_black", 6))
    P.append(ellipsoid("overalls", (0.27 * s, 0.23 * s, 0.30), (0, 0, 0.60), "paint_blue", 12))
    P.append(ellipsoid("shirt", (0.25 * s, 0.21 * s, 0.20), (0, 0, 0.82), shirt, 12))
    P.append(ball("head", 0.25, (0, 0, 1.15), "skin", 16))
    P.append(ellipsoid("hair", (0.24, 0.21, 0.13), (0, 0.06, 1.04), "wood_dark", 10))
    P.append(ball("nose", 0.085, (0, -0.25, 1.12), "skin", 10))
    P.append(hemisphere("cap", 0.265, (0, 0, 1.17), shirt, 16, 4))
    P.append(cyl("brim", 0.20, 0.025, (0, -0.17, 1.18), shirt, 12))
    P.append(cyl("emblem", 0.06, 0.012, (0, -0.235, 1.30), "paint_white", 8, rotation=(math.pi / 2, 0, 0)))
    character(name, P, height, rel)

def char_link():
    P = []
    for sx in (-1, 1):
        P.append(ellipsoid("boot", (0.07, 0.13, 0.06), (sx * 0.10, -0.02, 0.06), "wood_dark", 8))
        P.append(cyl("bootshaft", 0.06, 0.18, (sx * 0.10, 0, 0.15), "wood_dark", 8))
        P.append(cyl("leg", 0.055, 0.45, (sx * 0.10, 0, 0.45), "paint_cream", 8))
        P.append(cyl("arm", 0.05, 0.50, (sx * 0.25, 0, 0.95), "skin", 8, rotation=(0, -sx * 0.15, 0)))
        P.append(ball("hand", 0.06, (sx * 0.29, 0, 0.68), "skin", 8))
        P.append(ellipsoid("bang", (0.05, 0.10, 0.12), (sx * 0.13, -0.05, 1.40), "paint_yellow", 8))
        P.append(cyl("ear", 0.03, 0.09, (sx * 0.18, 0, 1.47), "skin", 6, rotation=(0, sx * math.pi / 2, 0), r2=0.0))
    P.append(cyl("tunic", 0.24, 0.35, (0, 0, 0.795), "paint_green", 12, r2=0.17))
    P.append(cyl("chest", 0.17, 0.30, (0, 0, 1.10), "paint_green", 12))
    P.append(cyl("belt", 0.18, 0.06, (0, 0, 0.94), "wood_dark", 12))
    P.append(cyl("neck", 0.05, 0.08, (0, 0, 1.29), "skin", 8))
    P.append(ball("head", 0.15, (0, 0, 1.45), "skin", 16))
    P.append(hemisphere("hair", 0.16, (0, 0.005, 1.45), "paint_yellow", 12, 3))
    P.append(ellipsoid("backhair", (0.14, 0.08, 0.14), (0, 0.10, 1.38), "paint_yellow", 8))
    P.append(tilt(cyl("cap", 0.17, 0.45, (0, 0, 0), "paint_green", 12, r2=0.0), (0, 0, 1.50), -1.1, (0, 0, 0.225)))
    P.append(box("shield", (0.34, 0.05, 0.42), (0.02, 0.24, 1.0), "paint_blue", rotation=(0, 0, 0.1)))
    P.append(box("shieldrim", (0.36, 0.02, 0.44), (0.02, 0.265, 1.0), "steel", rotation=(0, 0, 0.1)))
    P.append(box("sword", (0.035, 0.02, 0.65), (-0.12, 0.29, 1.2), "steel", rotation=(0, 0.35, 0)))
    P.append(box("hilt", (0.14, 0.03, 0.03), (-0.01, 0.29, 1.51), "wood_dark", rotation=(0, 0.35, 0)))
    P.append(ball("pommel", 0.025, (0.03, 0.29, 1.62), "paint_blue", 6))
    character("char_link", P, 1.7, "retail/char_link")

def char_isabelle():
    P = []
    for sx in (-1, 1):
        P.append(ellipsoid("foot", (0.06, 0.09, 0.04), (sx * 0.07, -0.02, 0.04), "plastic_black", 6))
        P.append(cyl("leg", 0.045, 0.18, (sx * 0.07, 0, 0.17), "paint_yellow", 8))
        P.append(cyl("arm", 0.04, 0.28, (sx * 0.17, 0, 0.55), "paint_white", 8, rotation=(0, -sx * 0.2, 0)))
        P.append(ball("paw", 0.05, (sx * 0.21, 0, 0.40), "paint_yellow", 8))
        P.append(ellipsoid("eye", (0.03, 0.02, 0.05), (sx * 0.09, -0.215, 0.97), "plastic_black", 6))
        P.append(ellipsoid("ear", (0.06, 0.05, 0.14), (sx * 0.25, 0.0, 0.86), "paint_yellow", 8, rotation=(0, sx * 0.35, 0)))
    P.append(cyl("skirt", 0.20, 0.16, (0, 0, 0.32), "paint_blue", 12, r2=0.13))
    P.append(cyl("shirt", 0.135, 0.26, (0, 0, 0.53), "paint_white", 12))
    P.append(cyl("vest", 0.145, 0.22, (0, 0, 0.53), "paint_green", 12))
    P.append(box("placket", (0.10, 0.03, 0.22), (0, -0.145, 0.53), "paint_white"))
    P.append(box("bow", (0.08, 0.03, 0.05), (0, -0.155, 0.65), "paint_red"))
    P.append(ball("head", 0.24, (0, 0, 0.92), "paint_yellow", 16))
    P.append(ellipsoid("muzzle", (0.11, 0.09, 0.09), (0, -0.20, 0.86), "paint_cream", 10))
    P.append(ball("nose", 0.035, (0, -0.285, 0.89), "plastic_black", 6))
    P.append(ball("topknot", 0.075, (0, 0.02, 1.19), "paint_yellow", 8))
    P.append(ball("bell", 0.03, (0, -0.04, 1.13), "paint_red", 6))
    character("char_isabelle", P, 1.2, "retail/char_isabelle")

def pikmin(name, col, kind, rel):
    P = []
    for sx in (-1, 1):
        P.append(cyl("leg", 0.015, 0.14, (sx * 0.035, 0, 0.07), col, 6))
        P.append(cyl("arm", 0.012, 0.14, (sx * 0.08, 0, 0.26), col, 6, rotation=(0, -sx * 0.3, 0)))
        P.append(ball("eye", 0.028, (sx * 0.05, -0.085, 0.46), "plastic_black", 6))
        if kind == "yellow":
            P.append(ellipsoid("ear", (0.02, 0.05, 0.07), (sx * 0.12, 0, 0.45), col, 6))
    P.append(ellipsoid("body", (0.065, 0.06, 0.12), (0, 0, 0.25), col, 10))
    P.append(ball("head", 0.105, (0, 0, 0.43), col, 12))
    P.append(cyl("nose", 0.03, 0.08, (0, -0.14, 0.43), col, 8, rotation=(math.pi / 2, 0, 0), r2=0.0))
    if kind == "blue":
        P.append(ellipsoid("mouth", (0.03, 0.01, 0.012), (0, -0.10, 0.37), "plastic_black", 6))
    P.append(cyl("stem", 0.008, 0.12, (0, 0, 0.59), "leaf_green", 6))
    P.append(ellipsoid("leaf", (0.035, 0.07, 0.006), (0, 0.03, 0.65), "leaf_green", 8))
    character(name, P, 0.6, rel)

def char_kirby():
    P = [ball("body", 0.36, (0, 0, 0.42), "skin", 20)]
    for sx in (-1, 1):
        P.append(ellipsoid("foot", (0.14, 0.22, 0.09), (sx * 0.16, -0.08, 0.09), "paint_red", 12))
        P.append(ellipsoid("arm", (0.12, 0.09, 0.09), (sx * 0.36, -0.05, 0.42), "skin", 10))
        P.append(ellipsoid("eye", (0.035, 0.02, 0.08), (sx * 0.10, -0.33, 0.52), "plastic_black", 6))
        P.append(ellipsoid("cheek", (0.045, 0.015, 0.025), (sx * 0.20, -0.29, 0.40), "paint_red", 6))
    P.append(ellipsoid("mouth", (0.03, 0.01, 0.02), (0, -0.355, 0.36), "paint_red", 6))
    character("char_kirby", P, 0.9, "retail/char_kirby")

def char_toad():
    P = []
    for sx in (-1, 1):
        P.append(ellipsoid("shoe", (0.08, 0.12, 0.06), (sx * 0.10, -0.02, 0.06), "wood_dark", 8))
        P.append(cyl("leg", 0.05, 0.14, (sx * 0.10, 0, 0.19), "paint_white", 8))
        P.append(cyl("arm", 0.045, 0.26, (sx * 0.21, 0, 0.47), "paint_white", 8, rotation=(0, -sx * 0.25, 0)))
        P.append(ball("hand", 0.055, (sx * 0.25, -0.01, 0.34), "paint_white", 8))
        P.append(ellipsoid("eye", (0.025, 0.015, 0.05), (sx * 0.07, -0.18, 0.70), "plastic_black", 6))
    P.append(ellipsoid("pants", (0.20, 0.17, 0.12), (0, 0, 0.30), "paint_white", 10))
    P.append(cyl("torso", 0.16, 0.24, (0, 0, 0.48), "paint_white", 12))
    P.append(cyl("vest", 0.175, 0.22, (0, 0, 0.49), "paint_blue", 12))
    P.append(box("placket", (0.12, 0.03, 0.22), (0, -0.175, 0.49), "paint_white"))
    P.append(ball("head", 0.19, (0, 0, 0.68), "skin", 12))
    cap = lathe("cap", [(0.30, 0.78), (0.40, 0.84), (0.38, 0.96), (0.28, 1.08), (0.12, 1.15), (0.02, 1.17)], "plastic_white", 16)
    P.append(smooth(cap, sides_only=True, thresh=0.999))
    for x, y, z in ((0, -0.34, 0.92), (-0.34, 0, 0.92), (0.34, 0, 0.92), (0, 0.34, 0.92), (0, 0, 1.12)):
        P.append(ball("spot", 0.11, (x, y, z), "paint_red", 8))
    character("char_toad", P, 1.2, "retail/char_toad")

# ----------------------------------------------------------------------------- GENERIC

def mannequin_parts(mat, base=(0, 0, 0)):
    bx, by, bz = base
    P = []
    for sx in (-1, 1):
        P.append(ellipsoid("foot", (0.05, 0.12, 0.035), (bx + sx * 0.09, by - 0.03, bz + 0.035), mat, 6))
        P.append(cyl("leg", 0.05, 0.85, (bx + sx * 0.09, by, bz + 0.495), mat, 8, r2=0.075))
        P.append(cyl("arm", 0.045, 0.65, (bx + sx * 0.28, by, bz + 1.11), mat, 8, rotation=(0, -sx * 0.065, 0)))
        P.append(ball("hand", 0.05, (bx + sx * 0.31, by, bz + 0.75), mat, 6))
    torso = lathe("torso", [(0.16, 0.85), (0.19, 1.0), (0.16, 1.15), (0.20, 1.35), (0.22, 1.45), (0.06, 1.52)], mat, 12)
    smooth(torso, sides_only=True, thresh=0.999)
    torso.location = (bx, by, bz)
    torso.scale = (1, 0.65, 1)
    P.append(torso)
    P.append(cyl("neck", 0.05, 0.10, (bx, by, bz + 1.55), mat, 8))
    P.append(ball("head", 0.12, (bx, by, bz + 1.68), mat, 10))
    return P

def gen_mannequin(name, mat, rel):
    export_asset(finalize(name, mannequin_parts(mat)), rel, "mannequin", 900)

def gen_clothing_rack():
    parts = [cyl("rail", 0.015, 1.6, (0, 0, 1.48), "chrome", 8, rotation=(0, math.pi / 2, 0))]
    for sx in (-1, 1):
        parts.append(cyl("upright", 0.015, 1.48, (sx * 0.7, 0, 0.74), "chrome", 8))
        parts.append(box("foot", (0.06, 0.5, 0.04), (sx * 0.7, 0, 0.02), "chrome"))
    mats = ("fabric_black", "fabric_cream", "paint_blue")
    for k in range(8):
        x = -0.6 + k * 0.17
        parts.append(box("garment", (0.10, 0.36, 0.75), (x, 0, 1.05), mats[k % 3]))
        parts.append(box("hook", (0.012, 0.012, 0.08), (x, 0, 1.45), "chrome"))
    export_asset(finalize("gen_clothing_rack", parts), "retail/gen_clothing_rack", "rack")

def gen_jewelry_case():
    parts = [box("base", (1.5, 0.6, 0.6), (0, 0, 0.3), "wood_dark"),
             box("deck", (1.44, 0.54, 0.02), (0, 0, 0.61), "fabric_black"),
             box("glass", (1.46, 0.56, 0.40), (0, 0, 0.80), "glass_clear"),
             box("strip", (1.40, 0.015, 0.01), (0, 0.26, 0.985), "emissive_white")]
    export_asset(finalize("gen_jewelry_case", parts), "retail/gen_jewelry_case", "case")

def gen_display_pedestal(name, h, rel):
    export_asset(finalize(name, [box("ped", (0.6, 0.6, h), (0, 0, h / 2), "plaster_white")]), rel, "pedestal")

def gen_checkout():
    parts = [box("body", (2.0, 0.7, 0.92), (0, 0, 0.46), "wood_oak"),
             box("top", (2.05, 0.75, 0.04), (0, 0, 0.94), "granite_dark"),
             box("reader", (0.08, 0.10, 0.05), (0.85, -0.2, 0.985), "plastic_black")]
    p, scr = pos_monitor(0.5, 0.1, 0.96)
    export_asset(finalize("gen_checkout", parts + p, [scr]), "retail/gen_checkout", "counter")

def gen_shelf_wall_3m():
    W, D, H = 3.0, 0.4, 2.2
    parts = [box("back", (W, 0.04, H), (0, D / 2 - 0.02, H / 2), "plaster_white"),
             box("sideL", (0.04, D, H), (-(W / 2 - 0.02), 0, H / 2), "plaster_white"),
             box("sideR", (0.04, D, H), ((W / 2 - 0.02), 0, H / 2), "plaster_white")]
    rng = random.Random(3)
    mats = ("cardboard", "plastic_white", "paint_blue", "paint_red", "plastic_black", "cardboard", "paint_green")
    prods = []
    for i, z in enumerate((0.30, 0.72, 1.14, 1.56, 1.98)):
        parts.append(box("shelf", (W - 0.08, 0.36, 0.03), (0, -0.02, z - 0.015), "wood_light"))
        x = -1.35
        k = 0
        while x < 1.2:
            w = rng.uniform(0.18, 0.32)
            h = rng.uniform(0.15, 0.32)
            d = rng.uniform(0.18, 0.30)
            prods.append(box("p", (w, d, h), (x + w / 2, -0.04, z + h / 2), mats[(k + i) % 7]))
            x += w + 0.06
            k += 1
    products = join(prods, "products")
    export_asset(finalize("gen_shelf_wall_3m", parts, [products]), "retail/gen_shelf_wall_3m", "shelf")

def gen_cafe_table():
    parts = [cyl("top", 0.35, 0.03, (0, 0, 0.735), "marble_white", 24),
             cyl("post", 0.025, 0.70, (0, 0, 0.37), "metal_black", 8),
             cyl("foot", 0.22, 0.02, (0, 0, 0.01), "metal_black", 16)]
    export_asset(finalize("gen_cafe_table", parts), "retail/gen_cafe_table", "table")

def gen_cafe_chair():
    parts = [cyl("seat", 0.19, 0.02, (0, 0, 0.45), "metal_black", 12)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(cyl("leg", 0.012, 0.44, (sx * 0.15, sy * 0.15, 0.22), "metal_black", 6))
        parts.append(cyl("post", 0.012, 0.40, (sx * 0.15, 0.16, 0.66), "metal_black", 6))
    for z in (0.65, 0.82):
        parts.append(box("slat", (0.34, 0.02, 0.05), (0, 0.16, z), "metal_black"))
    export_asset(finalize("gen_cafe_chair", parts), "retail/gen_cafe_chair", "seat", 400)

def gen_hotel_lobby_sofa():
    parts = [box("base", (2.2, 0.9, 0.35), (0, 0, 0.275), "fabric_cream"),
             bevel_box("back", (1.76, 0.26, 0.45), (0, 0.32, 0.67), "fabric_cream", 0.03),
             bevel_box("cushionL", (0.86, 0.62, 0.14), (-0.44, -0.10, 0.52), "fabric_cream", 0.03),
             bevel_box("cushionR", (0.86, 0.62, 0.14), (0.44, -0.10, 0.52), "fabric_cream", 0.03)]
    for sx in (-1, 1):
        parts.append(box("arm", (0.22, 0.9, 0.55), (sx * 0.99, 0, 0.375), "fabric_cream"))
        for sy in (-1, 1):
            parts.append(box("leg", (0.06, 0.06, 0.10), (sx * 1.0, sy * 0.35, 0.05), "wood_dark"))
    export_asset(finalize("gen_hotel_lobby_sofa", parts), "retail/gen_hotel_lobby_sofa", "sofa")

def gen_lobby_lamp():
    shade = lathe("shade", [(0.21, 1.38), (0.17, 1.66)], "fabric_cream", 16)
    smooth(shade, sides_only=True, thresh=0.999)
    parts = [cyl("foot", 0.15, 0.02, (0, 0, 0.01), "metal_black", 16),
             cyl("post", 0.012, 1.40, (0, 0, 0.72), "metal_black", 8),
             cyl("bulb", 0.06, 0.06, (0, 0, 1.35), "emissive_warm", 8),
             shade]
    export_asset(finalize("gen_lobby_lamp", parts), "retail/gen_lobby_lamp", "lamp")

def gen_shopping_bag():
    parts = [box("bag", (0.32, 0.14, 0.34), (0, 0, 0.17), "paint_white")]
    for sy in (-1, 1):
        pts = [(0.08 * math.cos(t), sy * 0.04, 0.34 + 0.08 * math.sin(t)) for t in [math.pi * i / 6 for i in range(7)]]
        parts.append(tube("handle", pts, 0.006, "paint_white", 4))
    export_asset(finalize("gen_shopping_bag", parts), "retail/gen_shopping_bag", "prop")

def gen_window_display_dress():
    parts = [box("backdrop", (3.0, 0.06, 2.6), (0, 0.47, 1.3), "plaster_white"),
             box("plinth", (3.0, 0.9, 0.15), (0, -0.05, 0.075), "plaster_white")]
    parts += mannequin_parts("plastic_white", (-0.65, -0.05, 0.15))
    parts += mannequin_parts("plastic_white", (0.65, -0.05, 0.15))
    scr = screen_quad("screen", 2.9, 2.3, (0, 0.47 - 0.031, 1.35))
    export_asset(finalize("gen_window_display_dress", parts, [scr]), "retail/gen_window_display_dress", "window_display")

# ----------------------------------------------------------------------------- main

def main():
    reset_scene()
    # Apple
    apple_table("apple_table", 2.4, "retail/apple_table")
    apple_table("apple_table_long", 3.6, "retail/apple_table_long")
    apple_iphone_stand(); apple_ipad_stand(); apple_macbook(); apple_imac(); apple_watch_stand(); apple_headphones()
    apple_avenue_shelf(); apple_stool(); apple_bench_forum(); apple_planter_tree_box(); apple_video_wall_frame()
    apple_stair_module(); apple_glass_balustrade_1m(); apple_genius_table()
    # Nintendo fixtures
    nintendo_gondola(); nintendo_wall_shelf_3m(); nintendo_demo_kiosk(); nintendo_led_wall(); nintendo_checkout()
    nintendo_plush_bin(); nintendo_warp_pipe(); nintendo_question_block(); nintendo_pedestal_statue()
    nintendo_switch2_display()
    # Characters
    plumber("char_mario", "paint_red", 1.55, "retail/char_mario")
    plumber("char_luigi", "paint_green", 1.75, "retail/char_luigi", slim=0.9)
    char_link(); char_isabelle()
    pikmin("char_pikmin_red", "paint_red", "red", "retail/char_pikmin_red")
    pikmin("char_pikmin_blue", "paint_blue", "blue", "retail/char_pikmin_blue")
    pikmin("char_pikmin_yellow", "paint_yellow", "yellow", "retail/char_pikmin_yellow")
    char_kirby(); char_toad()
    # Generic
    gen_mannequin("gen_mannequin", "plastic_white", "retail/gen_mannequin")
    gen_mannequin("gen_mannequin_black", "plastic_black", "retail/gen_mannequin_black")
    gen_clothing_rack(); gen_jewelry_case()
    gen_display_pedestal("gen_display_pedestal", 0.6, "retail/gen_display_pedestal")
    gen_display_pedestal("gen_display_pedestal_tall", 1.2, "retail/gen_display_pedestal_tall")
    gen_checkout(); gen_shelf_wall_3m(); gen_cafe_table(); gen_cafe_chair(); gen_hotel_lobby_sofa(); gen_lobby_lamp()
    gen_shopping_bag(); gen_window_display_dress()

    write_manifest("retail")
    print("\n%-36s %6s %6s %7s %7s %7s" % ("asset", "tris", "budget", "height", "width", "depth"))
    for rel, tris, budget, h, w, d in TABLE:
        print("%-36s %6d %6d %7.2f %7.2f %7.2f%s" % (rel, tris, budget, h, w, d, "  OVER BUDGET" if tris >= budget else ""))
    print(f"{len(TABLE)} assets, {sum(t[1] for t in TABLE)} tris total")
    if OVER:
        print("BUDGET FAILURES:", OVER)
        sys.exit(1)

if __name__ == "__main__":
    main()
