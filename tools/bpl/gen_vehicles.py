"""
gen_vehicles.py — low-poly (but convincing) vehicles for the SF street scene (Three.js).
Run:  tools/bpl/.venv/bin/python tools/bpl/gen_vehicles.py            (VEH_PREVIEW=1 also renders workbench previews)

Conventions (see bpl_lib.py):
  * metres, Blender Z-up.  Origin = ground level, centre of the wheelbase footprint (x=0, y=0 midway between axles).
  * vehicle FRONT faces Blender -Y  (=> Three.js +Z after export).  Axles are along X.
  * ONLY MATERIAL_LIBRARY names.  'car_paint' = body paint (runtime recolours per instance), 'glass_dark' glass,
    'rubber' tyres, 'metal_alu' rims, 'emissive_white' headlights, 'emissive_red' taillights, 'emissive_amber'
    indicators, 'plastic_black' bumpers/trim, 'plastic_white' plates, 'screen' runtime-textured panels.
  * Structure of every GLB: root Empty named like the asset  ->  children (world transforms kept):
        'body'                                   everything except wheels, joined into one multi-material mesh
        'wheel_fl' 'wheel_fr' 'wheel_rl' 'wheel_rr'   origins at the wheel centres, axle = local X (spin with rotation.x)
                                                 bus adds 'wheel_rl2' 'wheel_rr2' (inner duals); bicycle/scooter: 'wheel_fl' 'wheel_rl'
        runtime objects kept separate:  'toplight' (taxi)  'lightbar' (police_suv)  'box' (box_truck, paint_white)
                                        'destsign' (bus_muni, 'screen' 1.4x0.3)  'number' + 'destboard' (cable car, 'screen')
  * Budgets: cars < 3500 tris, van < 4000, bus < 6000, cable car < 8000, bike/scooter < 1500.
Body construction: a side-view silhouette (y,z) profile — nose, hood, belt line, deck, tail — is lofted across the
width as a closed 'tub' (rings per station, with a rocker chamfer, shoulder and hood-edge inset); the wheel arches are
cut into the lower edge of the loft (no booleans: the bottom ring points follow the arch) and dark wheel-well boxes
sit behind them.  The greenhouse (windshield / side / rear glass / pillars / roof) is a second loft whose rows are
inset for taper; per-face materials pick glass vs paint.
"""
import sys, os, struct; sys.path.insert(0, os.path.dirname(__file__))
from bpl_lib import *

SUMMARY = []
PREVIEW = os.environ.get("VEH_PREVIEW") == "1"
PREVIEW_DIR = os.environ.get("VEH_PREVIEW_DIR", os.path.join(ROOT, "tools", "bpl", "_preview_vehicles"))

# ----------------------------------------------------------------------------- generic helpers

def interp(pts, y):
    """Piecewise-linear interpolation of [(y, v), ...] sorted by y (clamped)."""
    if y <= pts[0][0]:
        return pts[0][1]
    for (y0, v0), (y1, v1) in zip(pts, pts[1:]):
        if y <= y1:
            return v0 if y1 <= y0 else v0 + (v1 - v0) * (y - y0) / (y1 - y0)
    return pts[-1][1]

class MatIndex:
    """Material-slot bookkeeping for a multi-material bmesh."""
    def __init__(self):
        self.names = []
    def __call__(self, name):
        if name not in self.names:
            self.names.append(name)
        return self.names.index(name)

def box_uv(bm):
    """Box-projected UVs (1 unit = 1 m) for every face, so the runtime's textured PBR materials have coordinates."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = l.vert.co
            l[uv].uv = ((c.y, c.z) if ax == 0 else (c.x, c.z) if ax == 1 else (c.x, c.y))

def smooth_split(bm, angle_deg=40.0):
    """Smooth shading with hard edges baked in (split edges sharper than angle)."""
    thr = math.radians(angle_deg)
    for f in bm.faces:
        f.smooth = True
    sharp = []
    for e in bm.edges:
        if len(e.link_faces) == 2:
            try:
                if e.calc_face_angle(0.0) > thr:
                    sharp.append(e)
            except ValueError:
                pass
    if sharp:
        bmesh.ops.split_edges(bm, edges=sharp)

def finish_bm(bm, name, mi, smooth_angle=None, location=(0, 0, 0)):
    """Clean up a bmesh (drop loose verts, UVs, optional smoothing) and turn it into a linked multi-material object."""
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.normal_update()
    if smooth_angle:
        smooth_split(bm, smooth_angle)
    bm.normal_update()
    box_uv(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    for n in mi.names:
        obj.data.materials.append(mat(n))
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    return obj

def loft(name, stations, seg_mat, closed=True, caps=(None, None), smooth_angle=None):
    """Loft closed/open rings.  stations = [(y, [(x, z), ...]), ...] (same point count, ordered: up the left side,
    over the top, down the right side => outward normals).  seg_mat(i, j) -> material for the quad between
    station i and i+1 at ring segment j.  caps = (front_mat, rear_mat) planar n-gons at the first/last station."""
    bm = bmesh.new(); mi = MatIndex()
    rings = [[bm.verts.new((x, y, z)) for (x, z) in ring] for (y, ring) in stations]
    n = len(rings[0])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for j in range(n if closed else n - 1):
            k = (j + 1) % n
            uniq = []
            for v in (a[j], a[k], b[k], b[j]):
                if all((v.co - u.co).length > 1e-6 for u in uniq):
                    uniq.append(v)
            if len(uniq) < 3:
                continue
            try:
                f = bm.faces.new(uniq)
            except ValueError:
                continue
            f.material_index = mi(seg_mat(i, j))
    for ring, m, rev in ((rings[0], caps[0], True), (rings[-1], caps[1], False)):
        if not m:
            continue
        uniq = []
        for v in (reversed(ring) if rev else ring):
            if all((v.co - u.co).length > 1e-6 for u in uniq):
                uniq.append(v)
        if len(uniq) >= 3:
            f = bm.faces.new(uniq); f.material_index = mi(m)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    return finish_bm(bm, name, mi, smooth_angle)

def bm_box(bm, size, centre, midx, rot=None, smooth=False):
    sx, sy, sz = [s / 2 for s in size]
    c = Vector(centre)
    corners = [Vector((x, y, z)) for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)]
    if rot is not None:
        corners = [rot @ v for v in corners]
    vs = [bm.verts.new(c + v) for v in corners]
    fs = []
    for idx in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
        f = bm.faces.new([vs[i] for i in idx]); f.material_index = midx; f.smooth = smooth; fs.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs

def bm_lathe_x(bm, profile, segs, midx, closed=False, smooth=True):
    """Revolve a (radius, x) profile around the X axis; radius ~0 points collapse to a centre vertex."""
    rings = []
    for (rad, x) in profile:
        if rad < 1e-6:
            rings.append([bm.verts.new((x, 0, 0))])
        else:
            rings.append([bm.verts.new((x, rad * math.cos(2 * math.pi * i / segs), rad * math.sin(2 * math.pi * i / segs)))
                          for i in range(segs)])
    pairs = list(zip(rings, rings[1:]))
    if closed:
        pairs.append((rings[-1], rings[0]))
    faces = []
    for a, b in pairs:
        if len(a) == 1 and len(b) == 1:
            continue
        for i in range(segs):
            k = (i + 1) % segs
            vs = [a[0], b[k], b[i]] if len(a) == 1 else ([a[i], a[k], b[0]] if len(b) == 1 else [a[i], a[k], b[k], b[i]])
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            f.material_index = midx; f.smooth = smooth; faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces

def bm_arch(bm, cy, cz, r_in, r_out, x0, x1, segs, midx, z_floor):
    """Fender flare: partial annulus in the YZ plane (from z_floor up and over the wheel), thick from x0 to x1."""
    a0 = math.asin(max(-1.0, min(1.0, (z_floor - cz) / r_in)))
    angs = [a0 + (math.pi - 2 * a0) * i / segs for i in range(segs + 1)]
    def ring(rad, x):
        return [bm.verts.new((x, cy + rad * math.cos(a), cz + rad * math.sin(a))) for a in angs]
    ri0, ro0, ri1, ro1 = ring(r_in, x0), ring(r_out, x0), ring(r_in, x1), ring(r_out, x1)
    fs = []
    for i in range(segs):
        for quad in ((ro0[i], ro0[i + 1], ro1[i + 1], ro1[i]), (ri1[i], ri1[i + 1], ri0[i + 1], ri0[i]),
                     (ri1[i], ro1[i], ro1[i + 1], ri1[i + 1]), (ro0[i], ri0[i], ri0[i + 1], ro0[i + 1])):
            f = bm.faces.new(quad); f.material_index = midx; fs.append(f)
    for end in ((ri0[0], ro0[0], ro1[0], ri1[0]), (ri0[-1], ri1[-1], ro1[-1], ro0[-1])):
        f = bm.faces.new(end); f.material_index = midx; fs.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    return fs

def bm_cyl(bm, r, length, centre, axis, midx, segs=8, smooth=True):
    """Cylinder along 'X'|'Y'|'Z' centred at centre."""
    prof = [(0, -length / 2), (r, -length / 2), (r, length / 2), (0, length / 2)]
    faces = bm_lathe_x(bm, prof, segs, midx, smooth=smooth)
    verts = {v for f in faces for v in f.verts}
    rot = Matrix.Identity(3) if axis == 'X' else (Matrix.Rotation(math.pi / 2, 3, 'Z') if axis == 'Y' else Matrix.Rotation(-math.pi / 2, 3, 'Y'))
    for v in verts:
        v.co = rot @ v.co + Vector(centre)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces

def parts_obj(name, builder, location=(0, 0, 0), smooth_angle=None):
    """Build one multi-material object from a function builder(bm, mi)."""
    bm = bmesh.new(); mi = MatIndex()
    builder(bm, mi)
    return finish_bm(bm, name, mi, smooth_angle, location)

def quad_face(name, centre, w, h, material, normal='-Y'):
    """Flat w x h rectangle (origin at its centre, explicit 0..1 UVs) facing normal: '-Y' '+Y' '-X' '+X' '+Z'."""
    bm = bmesh.new()
    hw, hh = w / 2, h / 2
    if normal in ('-Y', '+Y'):
        pts = [(-hw, 0, -hh), (hw, 0, -hh), (hw, 0, hh), (-hw, 0, hh)]
    elif normal in ('-X', '+X'):
        pts = [(0, hw, -hh), (0, -hw, -hh), (0, -hw, hh), (0, hw, hh)]
    else:
        pts = [(-hw, -hh, 0), (hw, -hh, 0), (hw, hh, 0), (-hw, hh, 0)]
    f = bm.faces.new([bm.verts.new(p) for p in pts])
    bm.normal_update()
    want = {'-Y': (0, -1, 0), '+Y': (0, 1, 0), '-X': (-1, 0, 0), '+X': (1, 0, 0), '+Z': (0, 0, 1)}[normal]
    if f.normal.dot(Vector(want)) < 0:
        bmesh.ops.reverse_faces(bm, faces=[f])
    uv = bm.loops.layers.uv.verify()
    # uv: u along the panel width (left->right seen from the normal side), v up
    for l in f.loops:
        c = l.vert.co
        u = {'-Y': c.x / w, '+Y': -c.x / w, '-X': c.y / w, '+X': -c.y / w, '+Z': c.x / w}[normal] + 0.5
        v = (c.z / h if normal != '+Z' else c.y / h) + 0.5
        l[uv].uv = (u, v)
    o = mesh_from_bmesh(bm, name, material)
    o.location = centre
    o["uv_explicit"] = True
    return o

def seg_cyl(name, p0, p1, r, material, segs=6):
    """Cylinder between two points (for tube frames)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    o = cylinder(name, r, d.length, (p0 + p1) / 2, material, segs)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return o

def make_wheel(name, r, w, loc, side=1, segs=18, spokes=5, mat_rim="metal_alu", rim_ratio=0.62, spoke_style='box'):
    """Car wheel: axle along local X, origin at the centre, outer (dished) face toward `side` (+1 => +X)."""
    def build(bm, mi):
        rr = r * rim_ratio
        h = w / 2
        ty = mi("rubber"); al = mi(mat_rim)
        bm_lathe_x(bm, [(rr - 0.005, -h + 0.012), (r - 0.025, -h), (r, -h + 0.03), (r, h - 0.03), (r - 0.025, h), (rr - 0.005, h - 0.012)],
                   segs, ty, closed=True)
        xo = h - 0.015
        dish = 0.045 if r > 0.25 else 0.02
        prof = [(0, xo - dish), (rr * 0.32, xo - dish), (rr * 0.42, xo - dish - 0.02), (rr * 0.82, xo - dish - 0.02),
                (rr * 0.93, xo - 0.005), (rr, xo), (rr, -h + 0.02), (0, -h + 0.02)]
        bm_lathe_x(bm, prof, max(10, segs - 6), al, closed=True)
        if spokes:
            for i in range(spokes):
                a = 2 * math.pi * i / spokes
                rot = Matrix.Rotation(a, 3, 'X')
                c = rot @ Vector((xo - dish - 0.01, 0, rr * 0.58))
                bm_box(bm, (0.028, rr * 0.16 if spoke_style == 'box' else 0.02, rr * 0.55), c, al, rot)
        if side < 0:
            for v in bm.verts:
                v.co = Vector((-v.co.x, -v.co.y, v.co.z))
            for f in bm.faces:
                f.normal_flip()
    return parts_obj(name, build, loc, smooth_angle=55)

def make_root(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    return root

def ensure_uv(obj):
    """Box-projected UVs for joined meshes (bpl_lib primitives carry no UV layer); 'screen' quads keep their own."""
    if obj.type != 'MESH' or obj.get("uv_explicit"):
        return
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bm.normal_update()
    box_uv(bm)
    bm.to_mesh(obj.data); bm.free()

def attach(root, *objs):
    for o in objs:
        ensure_uv(o)
        o.parent = root      # root is at the origin with identity transform => world transforms unchanged
    return objs

def body_join(parts):
    parts = [p for p in parts if p is not None]
    if len(parts) == 1:
        parts[0].name = "body"; return parts[0]
    return join(parts, "body")

def glb_json(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    clen, ctype = struct.unpack_from("<II", data, 12)
    return json.loads(data[20:20 + clen].decode("utf-8"))

def preview(root, rel):
    """Workbench render (3/4 front view) for eyeballing; optional (VEH_PREVIEW=1)."""
    try:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        sc = bpy.context.scene
        sc.render.engine = 'BLENDER_WORKBENCH'
        sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'MATERIAL'
        sc.display.shading.show_shadows = True; sc.display.shading.show_cavity = True
        sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 1000, 640, 100
        sc.render.film_transparent = False
        for m in bpy.data.materials:
            if m.name in MATERIAL_LIBRARY:
                m.diffuse_color = (*MATERIAL_LIBRARY[m.name][0], 1.0)
        xs, ys, zs = [], [], []
        for o in root.children_recursive:
            if o.type == 'MESH':
                for v in o.data.vertices:
                    p = o.matrix_world @ v.co; xs.append(p.x); ys.append(p.y); zs.append(p.z)
        c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
        size = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
        cam_data = bpy.data.cameras.new("cam"); cam_data.lens = 40
        cam = bpy.data.objects.new("cam", cam_data); bpy.context.scene.collection.objects.link(cam)
        sc.camera = cam
        plane("ground", (size * 4, size * 4), (c.x, c.y, -0.001), "concrete")
        for suffix, d in (("", Vector((-1.0, -1.3, 0.65))), ("_rear", Vector((1.0, 1.3, 0.6)))):
            cam.location = c + d.normalized() * (size * 1.35 + 0.8)
            cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(PREVIEW_DIR, rel.split("/")[-1] + suffix + ".png")
            bpy.ops.render.render(write_still=True)
    except Exception as e:  # preview is best effort only
        print("preview failed:", e)

def ship(root, rel, L, W, H, wb, r, budget, wheels, extra_nodes=(), **meta_extra):
    kids = list(root.children_recursive)
    tris = tri_count(kids)
    meta = {"kind": "vehicle", "length": L, "width": W, "height": H, "wheelbase": wb, "wheelRadius": r, "front": "-Y",
            "wheels": list(wheels)}
    if extra_nodes:
        meta["parts"] = list(extra_nodes)
    meta.update(meta_extra)
    path = export_glb([root], rel, meta)
    # ---- verify the exported GLB: node names + hierarchy + materials
    js = glb_json(path)
    nodes = js.get("nodes", [])
    names = [n.get("name") for n in nodes]
    expected = ["body", *wheels, *extra_nodes]
    missing = [n for n in expected if n not in names]
    root_nodes = [n for n in nodes if n.get("name") == root.name]
    child_names = [names[i] for i in root_nodes[0].get("children", [])] if root_nodes else []
    not_children = [n for n in expected if n not in child_names]
    mats = [m.get("name") for m in js.get("materials", [])]
    bad = [m for m in mats if m not in MATERIAL_LIBRARY]
    problems = []
    if missing: problems.append(f"missing nodes {missing}")
    if not_children: problems.append(f"not children of root: {not_children}")
    if bad: problems.append(f"bad materials {bad}")
    if tris >= budget: problems.append(f"OVER BUDGET {tris} >= {budget}")
    SUMMARY.append((rel, tris, budget, L, W, H, len(nodes), "; ".join(problems) or "ok"))
    if PREVIEW:
        preview(root, rel)
    assert not problems, f"{rel}: {problems}"
    clear_objects()

# ----------------------------------------------------------------------------- cars (tub + greenhouse lofts)

def car_geometry(p):
    """Shared lofted body for sedan / hatch / SUV / van / truck cab.  Returns (parts, wheel objects, info)."""
    L, W, H, wb, fo, r, tw, zbot = p['L'], p['W'], p['H'], p['wb'], p['fo'], p['r'], p['tw'], p['zbot']
    yF = -wb / 2 - fo
    yR = yF + p.get('L_body', L)
    ws = W / 2
    Ra = r + p.get('arch_gap', 0.07)
    zbelt, zroof, zsh = p['zbelt'], H, p['zsh']
    top_inset = p.get('top_inset', 0.10)
    wc = ws - top_inset - 0.012            # greenhouse half width at the belt (just inside the tub's top edge)
    wr = p.get('wroof', wc - 0.10)         # roof half width (taper)
    bumper_len = p.get('bumper_len', 0.22)
    paint = p.get('paint', 'car_paint')
    arch_ys = p.get('arch_wheels', (-wb / 2, wb / 2))
    ztop_pts, ws_pts = p['ztop'], p['ws']

    def zbot_at(y):
        z = zbot
        for wy in arch_ys:
            d = y - wy
            if abs(d) < Ra:
                z = max(z, r + math.sqrt(Ra * Ra - d * d))
        return z

    # stations: silhouette key points + 7 samples per wheel arch
    ys = {yF, yR}
    ys.update(y for y, _ in ztop_pts); ys.update(y for y, _ in ws_pts)
    for wy in arch_ys:
        t0 = math.asin((zbot - r) / Ra)
        for i in range(7):
            t = t0 + (math.pi - 2 * t0) * i / 6
            ys.add(wy + Ra * math.cos(t))
    ys = sorted(y for y in ys if yF - 1e-6 <= y <= yR + 1e-6)

    def tub_ring(y):
        w = interp(ws_pts, y); zt = interp(ztop_pts, y); zb = zbot_at(y)
        zsh_y = min(zsh, zt - 0.05)
        z_sill = max(zbot + 0.10, zb)
        z_bump = max(zbot + 0.32, zb)
        wt = w - top_inset
        left = [(-(w - 0.05), zb), (-w, z_sill), (-w, min(z_bump, zsh_y - 0.02)), (-(w + 0.01), zsh_y), (-wt, zt)]
        return left + [(0, zt + p.get('crown', 0.015))] + [(-x, z) for (x, z) in reversed(left)]

    def tub_mat(i, j):
        y = ys[i]
        if j == 9:
            return 'plastic_black'                                    # underside
        if j in (0, 1, 8, 9) and (y < yF + bumper_len - 1e-6 or y >= yR - bumper_len - 1e-6):
            return 'plastic_black'                                    # wrap-around bumper band
        return paint
    tub = loft("tub", [(y, tub_ring(y)) for y in ys], tub_mat, closed=True, caps=(paint, paint), smooth_angle=38)

    # greenhouse
    zmid = zbelt + 0.55 * (zroof - zbelt)
    wm = wc - 0.02
    def cab_ring(kind, wflat=None):
        if kind == 'flat':
            w0 = wc if wflat is None else wflat
            return [(-w0, zbelt)] * 3 + [(0, zbelt)] + [(w0, zbelt)] * 3
        left = [(-wc, zbelt), (-wm, zmid), (-wr, zroof - 0.025)]
        return left + [(0, zroof)] + [(-x, z) for (x, z) in reversed(left)]
    cab_st = [(y, cab_ring(kind, wf)) for (y, kind, wf) in p['cab_stations']]
    secs = p['cab_secs']
    def cab_mat(i, j):
        jj = j if j < 3 else 5 - j
        return secs[i][jj]
    cab = loft("cab", cab_st, cab_mat, closed=False, caps=(None, None), smooth_angle=38)
    parts = [tub, cab]

    # ---- wheel wells + underbody (dark boxes behind the arch cut-outs)
    parts.append(box_bottom("under", (2 * (ws - 0.07), yR - yF - 0.5, zbot + 0.03 - 0.12), (0, (yF + yR) / 2, 0.12), "plastic_black"))
    for wy in arch_ys:
        parts.append(box_bottom("well", (2 * (ws - 0.065), 2 * Ra + 0.04, r + Ra + 0.02 - 0.12), (0, wy, 0.12), "plastic_black"))
    if p.get('flare'):
        def flares(bm, mi):
            m = mi(p['flare'])
            for wy in arch_ys:
                for sx in (-1, 1):
                    x0, x1 = sx * (ws - 0.02), sx * (ws + 0.035)
                    bm_arch(bm, wy, r, Ra - 0.01, Ra + 0.055, min(x0, x1), max(x0, x1), 8, m, zbot + 0.08)
        parts.append(parts_obj("flares", flares))

    # ---- front face details
    wF = interp(ws_pts, yF); ztF = interp(ztop_pts, yF)
    hl_w = p.get('hl_w', 0.40)
    parts += [
        box("bumper_f", (2 * wF + 0.02, 0.10, 0.20), (0, yF - 0.03, zbot + 0.19), "plastic_black"),
        box("grille", (p.get('grille_w', 0.70), 0.04, 0.16), (0, yF - 0.01, ztF - 0.14), "plastic_black"),
        box("plate_f", (0.32, 0.02, 0.15), (0, yF - 0.09, zbot + 0.19), "plastic_white"),
    ]
    for sx in (-1, 1):
        parts += [
            box("headlight", (hl_w, 0.05, 0.14), (sx * (wF - 0.10 - hl_w / 2), yF - 0.015, ztF - 0.13), "emissive_white"),
            box("indicator_f", (0.10, 0.05, 0.07), (sx * (wF - 0.06), yF - 0.01, ztF - 0.30), "emissive_amber"),
        ]
    # ---- rear face details
    wR = interp(ws_pts, yR); ztR = interp(ztop_pts, yR)
    parts += [
        box("bumper_r", (2 * wR + 0.02, 0.10, 0.20), (0, yR + 0.03, zbot + 0.19), "plastic_black"),
        box("plate_r", (0.32, 0.02, 0.15), (0, yR + 0.09, zbot + 0.30), "plastic_white"),
        cylinder("exhaust", 0.03, 0.16, (-(wR - 0.35), yR + 0.03, zbot + 0.02), "steel", 8, rotation=(math.pi / 2, 0, 0)),
    ]
    tl = p.get('taillight', (0.45, 0.13))
    for sx in (-1, 1):
        parts += [
            box("taillight", (tl[0], 0.05, tl[1]), (sx * (wR - 0.08 - tl[0] / 2), yR + 0.015, ztR - 0.12 - p.get('tl_drop', 0)), "emissive_red"),
            box("indicator_r", (0.10, 0.05, 0.07), (sx * (wR - 0.06), yR + 0.01, ztR - 0.28 - p.get('tl_drop', 0)), "emissive_amber"),
        ]
    # ---- mirrors + door handles
    yA = p['cab_stations'][0][0]
    for sx in (-1, 1):
        parts += [
            box("mirror", (0.09, 0.17, 0.10), (sx * (wc + 0.15), yA + 0.16, zbelt + 0.09), paint),
            box("mirror_arm", (0.14, 0.05, 0.03), (sx * (wc + 0.07), yA + 0.16, zbelt + 0.06), "plastic_black"),
        ]
        for hy in p.get('handles', ()):
            parts.append(box("handle", (0.02, 0.12, 0.03), (sx * (ws + 0.012), hy, zbelt - 0.13), "plastic_black"))
    # ---- wheels
    wheels = []
    wheel_names = p.get('wheel_names', ("wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"))
    axle_x = ws - 0.012 - tw / 2
    for name, sx, wy in ((wheel_names[0], -1, -wb / 2), (wheel_names[1], 1, -wb / 2), (wheel_names[2], -1, wb / 2), (wheel_names[3], 1, wb / 2)):
        w_here = p.get('rear_tw', tw) if wy > 0 else tw
        x_here = ws - 0.012 - w_here / 2
        wheels.append(make_wheel(name, r, w_here, (sx * x_here, wy, r), sx, segs=p.get('wheel_segs', 18), spokes=p.get('spokes', 5)))
    return parts, wheels, dict(yF=yF, yR=yR, ws=ws, wc=wc, wr=wr, zbelt=zbelt)

def sedan_spec(L=4.7, W=1.85, H=1.45, wb=2.8, fo=0.9, r=0.33):
    yF = -wb / 2 - fo; yR = yF + L; ws = W / 2
    yA, yB, yC, yD, yP = yF + 1.3, yF + 2.25, yF + 3.35, yF + 4.0, yF + 2.8
    zbelt = 0.95
    return dict(L=L, W=W, H=H, wb=wb, fo=fo, r=r, tw=0.22, zbot=0.20, zbelt=zbelt, zsh=0.82,
                ztop=[(yF, 0.60), (yF + 0.05, 0.72), (yF + 0.28, 0.80), (yF + 0.9, 0.87), (yA - 0.02, zbelt), (yD + 0.02, zbelt),
                      (yD + 0.15, 0.93), (yR - 0.12, 0.92), (yR, 0.84)],
                ws=[(yF, ws - 0.10), (yF + 0.3, ws - 0.03), (yF + 1.2, ws), (yR - 1.0, ws), (yR - 0.3, ws - 0.03), (yR, ws - 0.10)],
                cab_stations=[(yA, 'flat', None), (yB, 'full', None), (yP - 0.05, 'full', None), (yP + 0.05, 'full', None), (yC, 'full', None), (yD, 'flat', None)],
                cab_secs=[{0: 'glass_dark', 1: 'glass_dark', 2: 'glass_dark'}, {0: 'glass_dark', 1: 'glass_dark', 2: 'car_paint'},
                          {0: 'car_paint', 1: 'car_paint', 2: 'car_paint'}, {0: 'glass_dark', 1: 'glass_dark', 2: 'car_paint'},
                          {0: 'car_paint', 1: 'car_paint', 2: 'glass_dark'}],
                handles=(yB + 0.35, yP + 0.45), name_y=(yB, yC))

def hatch_spec():
    L, W, H, wb, fo, r = 4.2, 1.8, 1.5, 2.55, 0.8, 0.31
    yF = -wb / 2 - fo; yR = yF + L; ws = W / 2
    yA, yB, yC, yD, yP = yF + 1.15, yF + 2.05, yF + 3.45, yF + 3.95, yF + 2.65
    zbelt = 0.95
    return dict(L=L, W=W, H=H, wb=wb, fo=fo, r=r, tw=0.20, zbot=0.20, zbelt=zbelt, zsh=0.82,
                ztop=[(yF, 0.60), (yF + 0.05, 0.72), (yF + 0.25, 0.80), (yF + 0.8, 0.88), (yA - 0.02, zbelt), (yR, zbelt)],
                ws=[(yF, ws - 0.10), (yF + 0.3, ws - 0.03), (yF + 1.1, ws), (yR - 0.6, ws), (yR - 0.2, ws - 0.03), (yR, ws - 0.08)],
                cab_stations=[(yA, 'flat', None), (yB, 'full', None), (yP - 0.05, 'full', None), (yP + 0.05, 'full', None), (yC, 'full', None), (yD, 'flat', ws - 0.16)],
                cab_secs=[{0: 'glass_dark', 1: 'glass_dark', 2: 'glass_dark'}, {0: 'glass_dark', 1: 'glass_dark', 2: 'car_paint'},
                          {0: 'car_paint', 1: 'car_paint', 2: 'car_paint'}, {0: 'glass_dark', 1: 'glass_dark', 2: 'car_paint'},
                          {0: 'car_paint', 1: 'car_paint', 2: 'glass_dark'}],
                handles=(yB + 0.3, yP + 0.4), taillight=(0.30, 0.22), tl_drop=0.05, name_y=(yB, yC))

def suv_spec(L=4.9, W=1.95, H=1.75, wb=2.85, fo=0.9, r=0.38):
    yF = -wb / 2 - fo; yR = yF + L; ws = W / 2
    yA, yB, yC, yD, yP = yF + 1.4, yF + 2.3, yF + 4.4, yF + 4.75, yF + 3.0
    zbelt = 1.10
    return dict(L=L, W=W, H=H, wb=wb, fo=fo, r=r, tw=0.26, zbot=0.30, zbelt=zbelt, zsh=0.96, arch_gap=0.08, flare='plastic_black',
                ztop=[(yF, 0.78), (yF + 0.05, 0.92), (yF + 0.3, 1.00), (yF + 1.0, 1.05), (yA - 0.02, zbelt), (yR, zbelt)],
                ws=[(yF, ws - 0.10), (yF + 0.3, ws - 0.03), (yF + 1.1, ws), (yR - 0.6, ws), (yR - 0.2, ws - 0.03), (yR, ws - 0.08)],
                cab_stations=[(yA, 'flat', None), (yB, 'full', None), (yP - 0.05, 'full', None), (yP + 0.05, 'full', None), (yC, 'full', None), (yD, 'flat', ws - 0.16)],
                cab_secs=[{0: 'glass_dark', 1: 'glass_dark', 2: 'glass_dark'}, {0: 'glass_dark', 1: 'glass_dark', 2: 'car_paint'},
                          {0: 'car_paint', 1: 'car_paint', 2: 'car_paint'}, {0: 'glass_dark', 1: 'glass_dark', 2: 'car_paint'},
                          {0: 'car_paint', 1: 'car_paint', 2: 'glass_dark'}],
                handles=(yB + 0.35, yP + 0.5), taillight=(0.28, 0.30), tl_drop=0.10, hl_w=0.36, grille_w=0.9, name_y=(yB, yC))

def van_spec():
    L, W, H, wb, fo, r = 5.5, 2.0, 2.4, 3.4, 0.95, 0.36
    yF = -wb / 2 - fo; yR = yF + L; ws = W / 2
    yA, yB, yP = yF + 1.15, yF + 1.95, yF + 3.05
    zbelt = 1.15
    return dict(L=L, W=W, H=H, wb=wb, fo=fo, r=r, tw=0.24, zbot=0.30, zbelt=zbelt, zsh=1.00, wroof=ws - 0.14, top_inset=0.08,
                ztop=[(yF, 0.85), (yF + 0.05, 1.0), (yF + 0.4, 1.07), (yA - 0.02, zbelt), (yR, zbelt)],
                ws=[(yF, ws - 0.10), (yF + 0.3, ws - 0.03), (yF + 1.0, ws), (yR - 0.1, ws), (yR, ws - 0.03)],
                cab_stations=[(yA, 'flat', None), (yB, 'full', None), (yP - 0.05, 'full', None), (yP + 0.05, 'full', None), (yR, 'full', None), (yR, 'flat', ws - 0.12)],
                cab_secs=[{0: 'glass_dark', 1: 'glass_dark', 2: 'glass_dark'}, {0: 'glass_dark', 1: 'glass_dark', 2: 'car_paint'},
                          {0: 'car_paint', 1: 'car_paint', 2: 'car_paint'}, {0: 'car_paint', 1: 'car_paint', 2: 'car_paint'},
                          {0: 'car_paint', 1: 'car_paint', 2: 'car_paint'}],
                handles=(yB + 0.35, yP + 0.9), taillight=(0.16, 0.55), tl_drop=0.25, hl_w=0.36, grille_w=1.0, name_y=(yB, yP))

def gen_car(rel, p, extras=None, budget=3500, kind_extra=None):
    """extras(info, parts) -> list of separate child objects (runtime-addressed)."""
    root = make_root(rel.split("/")[-1])
    parts, wheels, info = car_geometry(p)
    separate = extras(info, parts) if extras else []
    body = body_join(parts)
    attach(root, body, *wheels, *separate)
    ship(root, rel, p['L'], p['W'], p['H'], p['wb'], p['r'], budget, [w.name for w in wheels], [s.name for s in separate],
         **(kind_extra or {}))

def gen_sedan():
    gen_car("vehicles/sedan", sedan_spec())

def gen_hatch():
    gen_car("vehicles/hatch", hatch_spec())

def gen_suv():
    gen_car("vehicles/suv", suv_spec())

def gen_taxi():
    p = sedan_spec()
    def extras(info, parts):
        yB, yC = p['name_y']
        return [box("toplight", (0.50, 0.20, 0.12), (0, (yB + yC) / 2 - 0.15, p['H'] + 0.06), "emissive_amber")]
    gen_car("vehicles/taxi", p, extras, kind_extra={"variant": "taxi"})

def gen_police_suv():
    p = suv_spec()
    def extras(info, parts):
        yB, yC = p['name_y']
        yl = (yB + yC) / 2 - 0.25
        base = box("lightbar", (1.10, 0.26, 0.05), (0, yl, p['H'] + 0.035), "plastic_black")
        lamps = []
        for i in range(8):
            x = -0.48 + i * 0.137
            lamps.append(box("lamp", (0.12, 0.22, 0.09), (x, yl, p['H'] + 0.10), "emissive_red" if i < 4 else "emissive_white"))
        parts.append(box("push_bumper", (1.1, 0.12, 0.35), (0, info['yF'] - 0.12, p['zbot'] + 0.32), "plastic_black"))
        return [join([base] + lamps, "lightbar")]
    gen_car("vehicles/police_suv", p, extras, kind_extra={"variant": "police"})

def gen_van():
    p = van_spec()
    def extras(info, parts):
        yR = info['yR']
        parts.append(box("door_gap", (2 * info['ws'] - 0.3, 0.02, 0.02), (0, yR + 0.01, p['zbelt'] + 0.6), "plastic_black"))
        parts.append(box("rear_glass_l", (0.55, 0.03, 0.55), (-0.5, yR + 0.015, p['H'] - 0.55), "glass_dark"))
        parts.append(box("rear_glass_r", (0.55, 0.03, 0.55), (0.5, yR + 0.015, p['H'] - 0.55), "glass_dark"))
        return []
    gen_car("vehicles/van_delivery", p, extras, budget=4000)

def gen_box_truck():
    L, W, H, wb, fo, r = 6.5, 2.2, 3.3, 3.8, 1.1, 0.42
    yF = -wb / 2 - fo; yR = yF + L; ws = W / 2
    Lc = 2.3; yCr = yF + Lc                             # cab rear
    yA, yB = yF + 0.95, yF + 1.55
    zbelt, Hc = 1.35, 2.55
    p = dict(L=L, W=W, H=Hc, wb=wb, fo=fo, r=r, tw=0.28, rear_tw=0.50, zbot=0.45, zbelt=zbelt, zsh=1.15, wroof=ws - 0.18, top_inset=0.08,
             L_body=Lc, arch_wheels=(-wb / 2,), arch_gap=0.09,
             ztop=[(yF, 1.0), (yF + 0.05, 1.18), (yF + 0.4, 1.25), (yA - 0.02, zbelt), (yCr, zbelt)],
             ws=[(yF, ws - 0.10), (yF + 0.3, ws - 0.03), (yF + 0.8, ws), (yCr, ws)],
             cab_stations=[(yA, 'flat', None), (yB, 'full', None), (yB + 0.55, 'full', None), (yB + 0.62, 'full', None), (yCr, 'full', None), (yCr, 'flat', ws - 0.12)],
             cab_secs=[{0: 'glass_dark', 1: 'glass_dark', 2: 'glass_dark'}, {0: 'glass_dark', 1: 'glass_dark', 2: 'car_paint'},
                       {0: 'car_paint', 1: 'car_paint', 2: 'car_paint'}, {0: 'car_paint', 1: 'car_paint', 2: 'car_paint'},
                       {0: 'car_paint', 1: 'car_paint', 2: 'car_paint'}],
             handles=(yB + 0.3,), hl_w=0.36, grille_w=1.1, name_y=(yB, yCr))
    def extras(info, parts):
        # chassis, rear bumper/lights, mud flaps in the body; cargo 'box' kept separate (paint_white)
        parts.append(box("chassis", (1.0, yR - yCr + 0.3, 0.28), (0, (yCr + yR) / 2 - 0.15, 0.72), "iron_painted"))
        parts.append(box("bumper_rr", (2 * ws - 0.2, 0.10, 0.20), (0, yR + 0.03, 0.55), "plastic_black"))
        parts.append(box("plate_rr", (0.32, 0.02, 0.15), (0, yR + 0.09, 0.55), "plastic_white"))
        for sx in (-1, 1):
            parts.append(box("tail_rr", (0.16, 0.05, 0.30), (sx * (ws - 0.20), yR + 0.015, 1.12), "emissive_red"))
            parts.append(box("mudflap", (0.45, 0.03, 0.40), (sx * (ws - 0.30), wb / 2 + r + 0.05, 0.25), "plastic_black"))
        y0, y1 = yCr + 0.22, yR
        cargo = box("box", (W + 0.05, y1 - y0, 2.35), (0, (y0 + y1) / 2, 0.95 + 2.35 / 2), "paint_white")
        door = box("rolldoor", (W - 0.35, 0.03, 2.05), (0, y1 + 0.015, 0.95 + 0.12 + 2.05 / 2), "plastic_grey")
        rail = box("rail", (W - 0.30, 0.03, 0.08), (0, y1 + 0.02, 0.95 + 2.25), "plastic_black")
        return [join([cargo, door, rail], "box")]
    root = make_root("box_truck")
    parts, wheels, info = car_geometry(p)
    separate = extras(info, parts)
    body = body_join(parts)
    attach(root, body, *wheels, *separate)
    ship(root, "vehicles/box_truck", L, W, H, wb, r, 4000, [w.name for w in wheels], [s.name for s in separate])

# ----------------------------------------------------------------------------- buses

def bus_shell(L, W, zroof, wb, fo, r, zbot, paint, front_mat=None, red_len=0.0, arch_gap=0.08):
    """Coach-style lofted shell with arches cut at both axles.  Returns (loft_obj, yF, yR, ws, Ra)."""
    yF = -wb / 2 - fo; yR = yF + L; ws = W / 2
    Ra = r + arch_gap
    ws_pts = [(yF, ws - 0.09), (yF + 0.10, ws - 0.03), (yF + 0.55, ws), (yR - 0.55, ws), (yR - 0.10, ws - 0.03), (yR, ws - 0.09)]
    ys = {y for y, _ in ws_pts}
    for wy in (-wb / 2, wb / 2):
        t0 = math.asin((zbot - r) / Ra)
        for i in range(7):
            t = t0 + (math.pi - 2 * t0) * i / 6
            ys.add(wy + Ra * math.cos(t))
    ys.add(yF + red_len) if red_len else None
    ys = sorted(ys)
    def zb_at(y):
        z = zbot
        for wy in (-wb / 2, wb / 2):
            d = y - wy
            if abs(d) < Ra:
                z = max(z, r + math.sqrt(Ra * Ra - d * d))
        return z
    def ring(y):
        w = interp(ws_pts, y); zb = zb_at(y)
        left = [(-(w - 0.05), zb), (-w, max(zb, zbot + 0.18)), (-w, zroof - 0.32), (-(w - 0.06), zroof - 0.10), (-(w - 0.28), zroof - 0.01)]
        return left + [(0, zroof)] + [(-x, z) for (x, z) in reversed(left)]
    def m(i, j):
        if j == 9:
            return 'plastic_black'
        if red_len and ys[i] < yF + red_len - 1e-6 and j not in (4, 5):
            return front_mat
        return paint
    shell = loft("shell", [(y, ring(y)) for y in ys], m, closed=True, caps=(front_mat or paint, paint), smooth_angle=38)
    return shell, yF, yR, ws, Ra

def bus_wheels(names, ws, wb, r, tw, inner=None):
    wheels = []
    for name, sx, wy in ((names[0], -1, -wb / 2), (names[1], 1, -wb / 2), (names[2], -1, wb / 2), (names[3], 1, wb / 2)):
        wheels.append(make_wheel(name, r, tw, (sx * (ws - 0.03 - tw / 2), wy, r), sx, segs=18, spokes=0, rim_ratio=0.58))
    if inner:
        for name, sx in ((inner[0], -1), (inner[1], 1)):
            wheels.append(make_wheel(name, r, tw, (sx * (ws - 0.03 - tw / 2 - tw - 0.03), wb / 2, r), sx, segs=14, spokes=0, rim_ratio=0.58))
    return wheels

def window_strip(parts, sx, ws, y0, y1, z0, z1, pane=1.35, gap=0.08, mat="glass_dark", name="win"):
    """Row of window panes proud of a bus side (x = sx*ws) between y0..y1."""
    y = y0
    n = max(1, round((y1 - y0 + gap) / (pane + gap)))
    pane = (y1 - y0 - gap * (n - 1)) / n
    for i in range(n):
        parts.append(box(name, (0.03, pane, z1 - z0), (sx * (ws + 0.005), y + pane / 2, (z0 + z1) / 2), mat))
        y += pane + gap

def bus_door(parts, sx, ws, yc, zbot, height=2.35, width=1.15):
    parts.append(box("door_frame", (0.03, width, height), (sx * (ws + 0.012), yc, zbot + 0.02 + height / 2), "plastic_black"))
    parts.append(box("door_glass", (0.03, width - 0.12, 1.25), (sx * (ws + 0.028), yc, zbot + 0.02 + height - 0.10 - 0.625), "glass_dark"))
    parts.append(box("door_split", (0.03, 0.03, height - 0.1), (sx * (ws + 0.04), yc, zbot + 0.02 + height / 2), "plastic_black"))

def gen_bus_muni():
    L, W, H, wb, fo, r, tw = 12.2, 2.6, 3.3, 6.5, 2.6, 0.5, 0.28
    zbot, zroof = 0.35, 3.1
    shell, yF, yR, ws, Ra = bus_shell(L, W, zroof, wb, fo, r, zbot, "car_paint", "paint_red", red_len=1.0)
    parts = [shell]
    parts.append(box_bottom("under", (2 * ws - 0.2, L - 0.6, zbot + 0.05 - 0.15), (0, (yF + yR) / 2, 0.15), "plastic_black"))
    for wy in (-wb / 2, wb / 2):
        parts.append(box_bottom("well", (2 * ws - 0.14, 2 * Ra + 0.05, r + Ra + 0.02 - 0.15), (0, wy, 0.15), "plastic_black"))
    zw0, zw1 = 1.45, 2.62
    # windows: driver side full length; curb side (-X) around the two doors
    window_strip(parts, +1, ws, yF + 1.05, yR - 0.55, zw0, zw1)
    d1, d2 = yF + 1.15, wb / 2 - r - 0.75
    bus_door(parts, -1, ws, d1, zbot); bus_door(parts, -1, ws, d2, zbot)
    window_strip(parts, -1, ws, d1 + 0.65, d2 - 0.65, zw0, zw1)
    window_strip(parts, -1, ws, d2 + 0.65, yR - 0.55, zw0, zw1)
    # front
    wF = ws - 0.09
    parts += [
        box("windshield", (2 * wF - 0.10, 0.04, 1.35), (0, yF - 0.012, 2.05), "glass_dark"),
        box("bumper_f", (2 * wF + 0.06, 0.12, 0.38), (0, yF - 0.04, zbot + 0.30), "plastic_black"),
        box("plate_f", (0.32, 0.02, 0.15), (0, yF - 0.11, zbot + 0.30), "plastic_white"),
        box("grille_f", (1.2, 0.03, 0.18), (0, yF - 0.012, 1.08), "plastic_black"),
        box("sign_frame", (1.5, 0.05, 0.40), (0, yF - 0.015, 2.95), "plastic_black"),
    ]
    for sx in (-1, 1):
        parts += [
            box("headlight", (0.36, 0.05, 0.20), (sx * (wF - 0.40), yF - 0.015, 0.92), "emissive_white"),
            box("indicator_f", (0.16, 0.05, 0.10), (sx * (wF - 0.14), yF - 0.012, 1.10), "emissive_amber"),
            box("mirror", (0.20, 0.10, 0.45), (sx * (ws + 0.30), yF + 0.05, 2.15), "plastic_black"),
            box("mirror_arm", (0.34, 0.04, 0.04), (sx * (ws + 0.12), yF + 0.05, 2.35), "plastic_black"),
        ]
    # rear
    wR = ws - 0.09
    parts += [
        box("engine_grille", (1.3, 0.03, 1.30), (0, yR + 0.012, 1.35), "plastic_black"),
        box("rear_glass", (2 * wR - 0.4, 0.03, 0.7), (0, yR + 0.012, 2.45), "glass_dark"),
        box("bumper_r", (2 * wR + 0.06, 0.12, 0.38), (0, yR + 0.04, zbot + 0.30), "plastic_black"),
        box("plate_r", (0.32, 0.02, 0.15), (0, yR + 0.11, zbot + 0.30), "plastic_white"),
    ]
    for sx in (-1, 1):
        parts += [box("taillight", (0.18, 0.05, 0.55), (sx * (wR - 0.22), yR + 0.015, 1.65), "emissive_red"),
                  box("indicator_r", (0.18, 0.05, 0.14), (sx * (wR - 0.22), yR + 0.012, 2.05), "emissive_amber")]
    # roof: AC unit + vents
    parts.append(box("ac_unit", (1.8, 2.6, 0.20), (0, 0.8, zroof + 0.10), "plastic_grey"))
    parts.append(box("vent", (1.2, 0.8, 0.10), (0, yR - 2.2, zroof + 0.05), "plastic_grey"))
    dest = quad_face("destsign", (0, yF - 0.045, 2.95), 1.4, 0.3, "screen", '-Y')
    wheels = bus_wheels(("wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"), ws, wb, r, tw, inner=("wheel_rl2", "wheel_rr2"))
    root = make_root("bus_muni")
    body = body_join(parts)
    attach(root, body, *wheels, dest)
    ship(root, "vehicles/bus_muni", L, W, H, wb, r, 6000, [w.name for w in wheels], ["destsign"], doorSide="-X", doorsY=[round(d1, 3), round(d2, 3)])

def gen_bus_tour():
    L, W, H, wb, fo, r, tw = 11.0, 2.55, 4.3, 5.8, 2.4, 0.5, 0.28
    zbot, zdeck = 0.35, 2.35
    paint = "paint_red"
    shell, yF, yR, ws, Ra = bus_shell(L, W, zdeck, wb, fo, r, zbot, paint)
    parts = [shell]
    parts.append(box_bottom("under", (2 * ws - 0.2, L - 0.6, zbot + 0.05 - 0.15), (0, (yF + yR) / 2, 0.15), "plastic_black"))
    for wy in (-wb / 2, wb / 2):
        parts.append(box_bottom("well", (2 * ws - 0.14, 2 * Ra + 0.05, r + Ra + 0.02 - 0.15), (0, wy, 0.15), "plastic_black"))
    zw0, zw1 = 1.40, 2.15
    window_strip(parts, +1, ws, yF + 0.9, yR - 0.5, zw0, zw1, pane=1.2)
    d1 = yF + 1.0
    bus_door(parts, -1, ws, d1, zbot, height=1.95, width=1.05)
    window_strip(parts, -1, ws, d1 + 0.6, yR - 0.5, zw0, zw1, pane=1.2)
    wF = ws - 0.09
    parts += [
        box("windshield", (2 * wF - 0.10, 0.04, 1.05), (0, yF - 0.012, 1.72), "glass_dark"),
        box("bumper_f", (2 * wF + 0.06, 0.12, 0.35), (0, yF - 0.04, zbot + 0.28), "plastic_black"),
        box("plate_f", (0.32, 0.02, 0.15), (0, yF - 0.11, zbot + 0.28), "plastic_white"),
        box("grille_f", (1.1, 0.03, 0.16), (0, yF - 0.012, 1.0), "plastic_black"),
        box("bumper_r", (2 * wF + 0.06, 0.12, 0.35), (0, yR + 0.04, zbot + 0.28), "plastic_black"),
        box("plate_r", (0.32, 0.02, 0.15), (0, yR + 0.11, zbot + 0.28), "plastic_white"),
        box("engine_grille", (1.2, 0.03, 0.9), (0, yR + 0.012, 1.3), "plastic_black"),
    ]
    for sx in (-1, 1):
        parts += [
            box("headlight", (0.34, 0.05, 0.18), (sx * (wF - 0.38), yF - 0.015, 0.85), "emissive_white"),
            box("indicator_f", (0.14, 0.05, 0.10), (sx * (wF - 0.12), yF - 0.012, 1.02), "emissive_amber"),
            box("mirror", (0.18, 0.10, 0.40), (sx * (ws + 0.28), yF + 0.05, 1.9), "plastic_black"),
            box("mirror_arm", (0.30, 0.04, 0.04), (sx * (ws + 0.12), yF + 0.05, 2.05), "plastic_black"),
            box("taillight", (0.18, 0.05, 0.45), (sx * (wF - 0.22), yR + 0.015, 1.45), "emissive_red"),
        ]
    # ---- upper deck: enclosed front section + open rear with parapet, rail and seat rows
    yE = yF + 1.7                                              # rear of the enclosed upper front
    wU = ws - 0.10
    parts += [
        box("upper_roof", (2 * wU, yE - yF + 0.05, 0.08), (0, (yF + yE) / 2, H - 0.04), paint),
        box("upper_windshield", (2 * wU - 0.30, 0.04, 1.55), (0, yF - 0.012, zdeck + 0.15 + 0.8 + 0.2), "glass_dark"),
        box("upper_front_sill", (2 * wU, 0.06, 0.55), (0, yF + 0.03, zdeck + 0.28), paint),
    ]
    for sx in (-1, 1):
        parts += [
            box("upper_post", (0.10, 0.10, H - zdeck), (sx * (wU - 0.05), yF + 0.05, (zdeck + H) / 2), paint),
            box("upper_post2", (0.10, 0.10, H - zdeck), (sx * (wU - 0.05), yE - 0.05, (zdeck + H) / 2), paint),
            box("upper_side_glass", (0.03, yE - yF - 0.2, 1.3), (sx * (wU - 0.015), (yF + yE) / 2, zdeck + 0.5 + 0.65), "glass_dark"),
            box("upper_side_sill", (0.06, yE - yF, 0.55), (sx * (wU - 0.03), (yF + yE) / 2, zdeck + 0.28), paint),
            box("parapet", (0.06, yR - yE, 0.95), (sx * (wU - 0.03), (yE + yR) / 2, zdeck + 0.475), paint),
            box("rail", (0.05, yR - yE, 0.05), (sx * (wU - 0.03), (yE + yR) / 2, zdeck + 0.975), "metal_alu"),
        ]
    parts.append(box("parapet_rear", (2 * wU, 0.06, 0.95), (0, yR - 0.03, zdeck + 0.475), paint))
    parts.append(box("rail_rear", (2 * wU, 0.05, 0.05), (0, yR - 0.03, zdeck + 0.975), "metal_alu"))
    parts.append(box("stair_box", (0.9, 1.1, 1.0), (-(wU - 0.5), yR - 0.65, zdeck + 0.5), paint))
    y = yE + 0.55
    while y < yR - 1.5:
        for sx in (-1, 1):
            parts.append(box("seat", (0.95, 0.42, 0.10), (sx * (wU - 0.55), y, zdeck + 0.45), "plastic_grey"))
            parts.append(box("seat_back", (0.95, 0.08, 0.55), (sx * (wU - 0.55), y + 0.21, zdeck + 0.72), "plastic_grey"))
        y += 0.78
    wheels = bus_wheels(("wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"), ws, wb, r, tw)
    root = make_root("bus_tour")
    body = body_join(parts)
    attach(root, body, *wheels)
    ship(root, "vehicles/bus_tour", L, W, H, wb, r, 6000, [w.name for w in wheels], doorSide="-X", doorsY=[round(d1, 3)])

# ----------------------------------------------------------------------------- cable car (Powell St single-ended)

def gen_cable_car():
    L, W, H, wb, r = 8.4, 2.4, 3.2, 2.8, 0.30
    yF, yR = -L / 2, L / 2
    z0 = 0.75                                      # floor top
    zw0, zw1 = z0 + 0.85, z0 + 1.80                # window band
    zR = z0 + 1.95                                 # roof edge
    yS = -0.85                                     # open section / closed cabin partition
    hw = W / 2
    maroon, cream, wood = "paint_maroon", "paint_cream", "wood_dark"
    parts = []
    # underframe, truck, floor, running boards
    parts += [
        box("truck", (1.7, 3.4, 0.28), (0, 0, 0.36), "iron_painted"),
        box("underframe", (2.0, L - 0.3, 0.22), (0, 0, 0.61), "iron_painted"),
        box("skirt_f", (2.0, 0.12, 0.35), (0, yF + 0.25, 0.45), maroon),
        box("floor", (W, L, 0.08), (0, 0, z0 - 0.04), wood),
        box("floor_trim", (W + 0.04, L + 0.04, 0.10), (0, 0, z0 - 0.10), cream),
    ]
    for sx in (-1, 1):
        parts += [box("runboard", (0.34, L - 0.4, 0.05), (sx * (hw + 0.14), 0, 0.40), "wood_oak")]
        for y in (yF + 0.5, -1.5, 1.5, yR - 0.5):
            parts.append(box("rb_bracket", (0.30, 0.05, 0.05), (sx * (hw + 0.10), y, 0.45), "iron_painted"))
    # ---- open front section: outward-facing benches, centre grip cabinet, brass poles
    for sx in (-1, 1):
        parts += [
            box("bench_seat", (0.45, yS - yF - 0.5, 0.06), (sx * 0.80, (yF + yS) / 2 + 0.05, z0 + 0.45), wood),
            box("bench_back", (0.06, yS - yF - 0.5, 0.45), (sx * 0.56, (yF + yS) / 2 + 0.05, z0 + 0.70), wood),
            box("bench_leg", (0.40, 0.05, 0.42), (sx * 0.80, yF + 0.45, z0 + 0.21), "iron_painted"),
            box("bench_leg2", (0.40, 0.05, 0.42), (sx * 0.80, yS - 0.25, z0 + 0.21), "iron_painted"),
        ]
    parts += [
        box("grip_cab", (0.55, 1.10, 0.95), (0, yF + 1.35, z0 + 0.475), wood),
        box("grip_lever", (0.05, 0.05, 1.10), (0.12, yF + 0.95, z0 + 1.45), "iron_painted"),
        box("brake_lever", (0.05, 0.05, 0.80), (-0.15, yF + 1.7, z0 + 1.30), "iron_painted"),
        box("dash", (W - 0.16, 0.10, 0.95), (0, yF + 0.06, z0 + 0.475), maroon),
        box("dash_trim", (W - 0.10, 0.12, 0.07), (0, yF + 0.06, z0 + 0.95), cream),
        box("dash_step", (W - 0.6, 0.30, 0.14), (0, yF + 0.16, 0.30), "iron_painted"),
    ]
    pole_ys = [yF + 0.12 + i * (yS - yF - 0.24) / 4 for i in range(5)]
    for sx in (-1, 1):
        for y in pole_ys:
            parts.append(cylinder("pole", 0.022, zR - z0, (sx * (hw - 0.07), y, (z0 + zR) / 2), "brass", 6))
        parts.append(cylinder("rail_h", 0.018, yS - yF - 0.24, (sx * (hw - 0.07), (yF + yS) / 2, z0 + 1.05), "brass", 6, rotation=(math.pi / 2, 0, 0)))
    # ---- enclosed rear cabin: maroon lower panels, cream belt trim, wood window frames, glass, top panel
    for sx in (-1, 1):
        parts += [
            box("side_lower", (0.07, yR - yS, zw0 - z0), (sx * (hw - 0.035), (yS + yR) / 2, (z0 + zw0) / 2), maroon),
            box("side_belt", (0.09, yR - yS + 0.02, 0.07), (sx * (hw - 0.03), (yS + yR) / 2, zw0), cream),
            box("side_top", (0.07, yR - yS, zR - zw1), (sx * (hw - 0.035), (yS + yR) / 2, (zw1 + zR) / 2), wood),
            box("side_cornice", (0.09, yR - yS + 0.02, 0.06), (sx * (hw - 0.03), (yS + yR) / 2, zR - 0.03), cream),
        ]
        nwin = 5
        pw = (yR - yS - 0.2) / nwin
        for i in range(nwin):
            yc = yS + 0.1 + pw * (i + 0.5)
            parts.append(box("win_glass", (0.03, pw - 0.10, zw1 - zw0 - 0.10), (sx * (hw - 0.035), yc, (zw0 + zw1) / 2), "glass_clear"))
            parts.append(box("mullion", (0.07, 0.08, zw1 - zw0), (sx * (hw - 0.035), yc - pw / 2, (zw0 + zw1) / 2), wood))
        parts.append(box("mullion_end", (0.07, 0.08, zw1 - zw0), (sx * (hw - 0.035), yR - 0.06, (zw0 + zw1) / 2), wood))
        parts.append(box("win_sill", (0.07, yR - yS, 0.05), (sx * (hw - 0.035), (yS + yR) / 2, zw1 - 0.02), wood))
    # rear wall + partition (with door opening and window)
    parts += [
        box("rear_lower", (W, 0.07, zw0 - z0), (0, yR - 0.035, (z0 + zw0) / 2), maroon),
        box("rear_belt", (W + 0.02, 0.09, 0.07), (0, yR - 0.03, zw0), cream),
        box("rear_top", (W, 0.07, zR - zw1), (0, yR - 0.035, (zw1 + zR) / 2), wood),
        box("rear_frame_l", (0.12, 0.07, zw1 - zw0), (-(hw - 0.06), yR - 0.035, (zw0 + zw1) / 2), wood),
        box("rear_frame_r", (0.12, 0.07, zw1 - zw0), ((hw - 0.06), yR - 0.035, (zw0 + zw1) / 2), wood),
        box("rear_frame_m", (0.10, 0.07, zw1 - zw0), (0, yR - 0.035, (zw0 + zw1) / 2), wood),
        box("rear_glass", (W - 0.3, 0.03, zw1 - zw0 - 0.1), (0, yR - 0.035, (zw0 + zw1) / 2), "glass_clear"),
        box("part_l", (0.75, 0.07, zR - z0), (-(hw - 0.375), yS, (z0 + zR) / 2), maroon),
        box("part_r", (0.75, 0.07, zR - z0), ((hw - 0.375), yS, (z0 + zR) / 2), maroon),
        box("part_head", (W - 1.5, 0.07, zR - (z0 + 1.95)), (0, yS, (z0 + 1.95 + zR) / 2), wood),
        box("part_glass_l", (0.55, 0.03, 0.75), (-(hw - 0.375), yS, (zw0 + zw1) / 2), "glass_clear"),
        box("part_glass_r", (0.55, 0.03, 0.75), ((hw - 0.375), yS, (zw0 + zw1) / 2), "glass_clear"),
    ]
    # interior benches of the closed cabin (longitudinal)
    for sx in (-1, 1):
        parts.append(box("cab_bench", (0.42, yR - yS - 0.4, 0.06), (sx * (hw - 0.30), (yS + yR) / 2, z0 + 0.45), wood))
    # ---- arched cream roof with clerestory (lofted along Y) + clerestory windows
    def roof_ring(y, ends=False):
        e = 0.0 if not ends else 0.08
        left = [(-(hw + 0.08), zR - 0.06), (-(hw + 0.09), zR + 0.02), (-(hw - 0.35), zR + 0.20), (-(hw - 0.75), zR + 0.30),
                (-(hw - 0.78), zR + 0.30 + 0.20), (-(hw - 0.85), zR + 0.30 + 0.30), (-(hw - 1.05), zR + 0.30 + 0.34)]
        pts = left + [(0, zR + 0.30 + 0.35)] + [(-x, z) for (x, z) in reversed(left)]
        if ends:  # squash the clerestory at the roof ends
            pts = [(x, min(z, zR + 0.30)) for (x, z) in pts]
        return pts
    ry0, ry1 = yF - 0.25, yR + 0.25
    roof_st = [(ry0, roof_ring(ry0, True)), (ry0 + 0.55, roof_ring(ry0 + 0.55)), (ry1 - 0.55, roof_ring(ry1 - 0.55)), (ry1, roof_ring(ry1, True))]
    roof = loft("roof", roof_st, lambda i, j: cream if j in (0, 1, 2, 12, 13, 14, 15) else ("glass_clear" if (j in (4, 10) and i == 1) else cream),
                closed=True, caps=(cream, cream), smooth_angle=45)
    parts.append(roof)
    parts.append(box("roof_soffit", (W + 0.16, L + 0.5, 0.05), (0, 0, zR - 0.085), "wood_dark"))
    # ---- headlamp, bell, number panel, destination boards
    parts += [
        cylinder("lamp_body", 0.13, 0.16, (0, yF + 0.02, z0 + 1.30), "brass", 12, rotation=(math.pi / 2, 0, 0)),
        cylinder("lamp_lens", 0.10, 0.03, (0, yF - 0.07, z0 + 1.30), "emissive_white", 12, rotation=(math.pi / 2, 0, 0)),
        lathe("bell", [(0.0, 0.0), (0.13, 0.0), (0.12, 0.10), (0.07, 0.20), (0.03, 0.26), (0.0, 0.27)], "brass", 10),
        box("bell_bracket", (0.05, 0.05, 0.25), (0, yF + 0.35, zR - 0.20), "iron_painted"),
        box("fare_box", (0.30, 0.30, 0.9), (-(hw - 0.55), yS + 0.35, z0 + 0.45), "iron_painted"),
    ]
    parts[-4].location = (0, yF + 0.35, zR - 0.36)
    parts.append(box("number_frame", (0.58, 0.05, 0.38), (0, yF + 0.01, z0 + 1.72), cream))
    number = quad_face("number", (0, yF - 0.02, z0 + 1.72), 0.5, 0.3, "screen", '-Y')
    parts.append(box("board_frame_l", (0.05, 1.7, 0.36), (-(hw + 0.02), yF + 1.75, zR - 0.30), wood))
    parts.append(box("board_frame_r", (0.05, 1.7, 0.36), ((hw + 0.02), yF + 1.75, zR - 0.30), wood))
    bl = quad_face("destboard_l", (-(hw + 0.05), yF + 1.75, zR - 0.30), 1.6, 0.3, "screen", '-X')
    br = quad_face("destboard_r", ((hw + 0.05), yF + 1.75, zR - 0.30), 1.6, 0.3, "screen", '+X')
    destboard = join([bl, br], "destboard")
    # ---- wheels (rail wheels, mostly hidden under the truck)
    wheels = []
    for name, sx, wy in (("wheel_fl", -1, -wb / 2), ("wheel_fr", 1, -wb / 2), ("wheel_rl", -1, wb / 2), ("wheel_rr", 1, wb / 2)):
        wheels.append(make_wheel(name, r, 0.10, (sx * 0.72, wy, r), sx, segs=14, spokes=0, mat_rim="steel", rim_ratio=0.75))
    root = make_root("cable_car_powell")
    body = body_join(parts)
    attach(root, body, *wheels, number, destboard)
    ship(root, "vehicles/cable_car_powell", L, W, H, wb, r, 8000, [w.name for w in wheels], ["number", "destboard"],
         openSection="front", floorHeight=z0)

# ----------------------------------------------------------------------------- bicycle / scooter / standalone wheel

def bike_wheel(name, r, loc, segs=16, spokes=8):
    def build(bm, mi):
        ru = mi("rubber"); al = mi("metal_alu")
        bm_lathe_x(bm, [(r - 0.035, -0.012), (r, -0.016), (r, 0.016), (r - 0.035, 0.012)], segs, ru, closed=True)
        bm_lathe_x(bm, [(r - 0.062, -0.008), (r - 0.034, -0.011), (r - 0.034, 0.011), (r - 0.062, 0.008)], segs, al, closed=True)
        bm_cyl(bm, 0.03, 0.09, (0, 0, 0), 'X', al, segs=8)
        for i in range(spokes):
            a = 2 * math.pi * i / spokes
            rot = Matrix.Rotation(a, 3, 'X')
            bm_box(bm, (0.004, 0.004, r - 0.07), rot @ Vector((0, 0, (r - 0.07) / 2 + 0.02)), al, rot)
    return parts_obj(name, build, loc, smooth_angle=50)

def gen_bicycle():
    L, W, H, wb, r = 1.7, 0.56, 1.02, 1.04, 0.34
    fw, rw = (0, -wb / 2, r), (0, wb / 2, r)
    BB = (0, 0.06, 0.27); ST = (0, 0.17, 0.82); HT = (0, -0.36, 0.86); HB = (0, -0.31, 0.62)
    paint, alu, blk = "car_paint", "metal_alu", "plastic_black"
    t = 0.017
    parts = [
        seg_cyl("down_tube", HB, BB, t, paint), seg_cyl("top_tube", HT, ST, t, paint), seg_cyl("seat_tube", BB, ST, t, paint),
        seg_cyl("head_tube", (0, -0.30, 0.58), (0, -0.375, 0.92), 0.02, paint),
        seg_cyl("stem", (0, -0.375, 0.92), (0, -0.44, 0.97), 0.012, alu),
        cylinder("handlebar", 0.012, W, (0, -0.44, 0.97), alu, 6, rotation=(0, math.pi / 2, 0)),
        seg_cyl("seat_post", ST, (0, 0.19, 0.95), 0.012, alu),
        box("saddle", (0.14, 0.26, 0.05), (0, 0.19, 0.975), blk),
        cylinder("chainring", 0.085, 0.01, (0.045, 0.06, 0.27), alu, 14, rotation=(0, math.pi / 2, 0)),
        cylinder("bb_shell", 0.02, 0.10, (0, 0.06, 0.27), alu, 6, rotation=(0, math.pi / 2, 0)),
        cylinder("cassette", 0.045, 0.02, (0.04, wb / 2, r), alu, 10, rotation=(0, math.pi / 2, 0)),
    ]
    for sx in (-1, 1):
        parts += [
            seg_cyl("chainstay", (sx * 0.045, 0.06, 0.27), (sx * 0.05, wb / 2, r), 0.010, paint),
            seg_cyl("seatstay", (sx * 0.01, 0.17, 0.80), (sx * 0.05, wb / 2, r), 0.010, paint),
            seg_cyl("fork", (sx * 0.015, -0.31, 0.60), (sx * 0.05, -wb / 2, r), 0.010, paint),
            box("grip", (0.09, 0.03, 0.03), (sx * (W / 2 - 0.045), -0.44, 0.97), blk),
            box("crank", (0.015, 0.035, 0.17), (sx * 0.07, 0.06, 0.27 - sx * 0.06), alu),
            box("pedal", (0.09, 0.07, 0.02), (sx * 0.12, 0.06, 0.27 - sx * 0.14), blk),
        ]
    for i in range(2):  # chain (top & bottom run)
        parts.append(seg_cyl("chain", (0.045, 0.06, 0.27 + (0.085 if i == 0 else -0.085)), (0.045, wb / 2, r + (0.045 if i == 0 else -0.045)), 0.005, blk, 4))
    wheels = [bike_wheel("wheel_fl", r, fw), bike_wheel("wheel_rl", r, rw)]
    root = make_root("bicycle")
    body = body_join(parts)
    attach(root, body, *wheels)
    ship(root, "vehicles/bicycle", L, W, H, wb, r, 1500, [w.name for w in wheels])

def gen_scooter():
    L, W, H, wb, r = 1.2, 0.50, 1.12, 0.84, 0.11
    paint, alu, blk = "car_paint", "metal_alu", "plastic_black"
    parts = [
        box("deck", (0.17, 0.62, 0.045), (0, 0.05, 0.145), paint),
        box("deck_grip", (0.15, 0.58, 0.01), (0, 0.05, 0.172), blk),
        box("battery", (0.14, 0.50, 0.05), (0, 0.05, 0.10), blk),
        box("rear_fender", (0.07, 0.20, 0.03), (0, wb / 2 - 0.02, r + 0.05), paint),
        seg_cyl("stem", (0, -0.34, 0.16), (0, -0.44, 1.05), 0.022, paint),
        seg_cyl("stem_lower", (0, -0.30, 0.10), (0, -0.34, 0.20), 0.03, paint),
        cylinder("handlebar", 0.013, W, (0, -0.44, 1.06), alu, 6, rotation=(0, math.pi / 2, 0)),
        box("display", (0.08, 0.05, 0.02), (0, -0.44, 1.08), blk),
        box("front_fender", (0.06, 0.18, 0.03), (0, -wb / 2, r + 0.045), paint),
        box("kickstand", (0.01, 0.02, 0.12), (0.06, 0.15, 0.06), alu),
    ]
    for sx in (-1, 1):
        parts += [box("grip", (0.10, 0.03, 0.03), (sx * (W / 2 - 0.05), -0.44, 1.06), blk),
                  seg_cyl("fork", (sx * 0.03, -0.32, 0.14), (sx * 0.04, -wb / 2, r), 0.010, paint)]
    wheels = [make_wheel("wheel_fl", r, 0.05, (0, -wb / 2, r), 1, segs=14, spokes=0, rim_ratio=0.6),
              make_wheel("wheel_rl", r, 0.05, (0, wb / 2, r), 1, segs=14, spokes=0, rim_ratio=0.6)]
    root = make_root("scooter_share")
    body = body_join(parts)
    attach(root, body, *wheels)
    ship(root, "vehicles/scooter_share", L, W, H, wb, r, 1500, [w.name for w in wheels])

def gen_wheel_generic():
    r, tw = 0.33, 0.22
    wheel = make_wheel("wheel", r, tw, (0, 0, r), 1, segs=20, spokes=5)
    root = make_root("wheel_generic")
    attach(root, wheel)
    kids = [wheel]
    tris = tri_count(kids)
    meta = {"kind": "wheel", "length": 2 * r, "width": tw, "height": 2 * r, "wheelbase": 0.0, "wheelRadius": r, "front": "-Y", "wheels": ["wheel"]}
    path = export_glb([root], "vehicles/wheel_generic", meta)
    js = glb_json(path)
    names = [n.get("name") for n in js.get("nodes", [])]
    ok = "wheel" in names and tris < 1500
    SUMMARY.append(("vehicles/wheel_generic", tris, 1500, 2 * r, tw, 2 * r, len(names), "ok" if ok else "BAD"))
    assert ok
    if PREVIEW:
        preview(root, "vehicles/wheel_generic")
    clear_objects()

# ----------------------------------------------------------------------------- main

def main():
    reset_scene()
    gen_sedan(); gen_suv(); gen_hatch(); gen_taxi(); gen_police_suv()
    gen_van(); gen_box_truck()
    gen_bus_muni(); gen_bus_tour()
    gen_cable_car()
    gen_bicycle(); gen_scooter()
    gen_wheel_generic()
    write_manifest("vehicles")
    print("\n%-30s %6s %7s  %-18s %5s  %s" % ("asset", "tris", "budget", "L x W x H", "nodes", "check"))
    for rel, tris, budget, L, W, H, nn, status in SUMMARY:
        print("%-30s %6d %7d  %5.2f x %4.2f x %4.2f %5d  %s" % (rel, tris, budget, L, W, H, nn, status))
    print("total assets:", len(SUMMARY), " max tris:", max(s[1] for s in SUMMARY))

if __name__ == "__main__":
    main()
