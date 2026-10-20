"""
gen_arch.py — reusable FAÇADE MODULES for the Union Square Three.js reconstruction.

Run:  tools/bpl/.venv/bin/python tools/bpl/gen_arch.py

Conventions (in addition to bpl_lib):
  * Wall plane = Blender XZ plane at y=0. Module spans x = width (centred on 0), z = height (from 0 up).
  * Street side = Blender -Y. Everything that projects from the wall goes into -Y, recessed parts
    (window glass, vestibules) go into +Y.  After the Y-up glTF export Blender -Y == Three.js +Z.
  * Origin = bottom-centre of the wall line (bbox min z == 0, x centred on 0, y=0 on the wall plane).
  * meta["opening"] / meta["opening_z"] give the nominal opening size and the z of its bottom edge
    (sills sit below the opening, so the opening does not start exactly at z=0).
  * Assets with more than LOD_THRESHOLD tris also get a simplified "<name>_lod1" variant.
"""
import sys, os, math, time
sys.path.insert(0, os.path.dirname(__file__))
from bpl_lib import *
from mathutils import Vector

LOD_THRESHOLD = 150
BUDGET = {"window": 600, "storefront": 600, "door": 600, "trim": 300, "fire_escape": 800, "marquee": 1500}
DEFAULT_BUDGET = 1500

# ----------------------------------------------------------------------------------------------
# local geometry helpers (bpl_lib is not modified)
# ----------------------------------------------------------------------------------------------
def bx(name, x0, x1, y0, y1, z0, z1, m):
    """Axis-aligned box given by min/max extents."""
    return box(name, (abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), m)

def _faces_obj(name, faces, m):
    """faces: list of (points, normal_hint). Builds flat polygons with the winding matching the hint."""
    bm = bmesh.new()
    for pts, n in faces:
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        f.normal_update()
        if f.normal.dot(Vector(n)) < 0:
            bmesh.ops.reverse_faces(bm, faces=[f])
    return mesh_from_bmesh(bm, name, m)

def vquad(name, x0, x1, z0, z1, y, m, facing=-1):
    """Vertical quad in the XZ plane at depth y; normal to -Y (street) unless facing=+1."""
    return _faces_obj(name, [([(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1)], (0, facing, 0))], m)

def vquad_yz(name, y0, y1, z0, z1, x, m, facing=1):
    """Vertical quad in the YZ plane at x; normal to +X unless facing=-1."""
    return _faces_obj(name, [([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)], (facing, 0, 0))], m)

def hquad(name, x0, x1, y0, y1, z, m, facing=-1):
    """Horizontal quad at height z; normal down (-Z) unless facing=+1."""
    return _faces_obj(name, [([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], (0, 0, facing))], m)

def poly_xz(name, pts, y, m, facing=-1):
    return _faces_obj(name, [([(x, y, z) for (x, z) in pts], (0, facing, 0))], m)

def poly_xy(name, pts, z, m, facing=-1):
    return _faces_obj(name, [([(x, y, z) for (x, y) in pts], (0, 0, facing))], m)

def prism(name, pts, axis, a0, a1, m):
    """Closed prism: 2D polygon `pts` extruded along `axis` from a0 to a1.
    axis 'Y': pts are (x,z);  axis 'X': pts are (y,z);  axis 'Z': pts are (x,y)."""
    bm = bmesh.new()
    def P(u, v, a):
        return {'X': (a, u, v), 'Y': (u, a, v), 'Z': (u, v, a)}[axis]
    f = bm.faces.new([bm.verts.new(P(u, v, a0)) for (u, v) in pts])
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    ev = [e for e in res["geom"] if isinstance(e, bmesh.types.BMVert)]
    vec = {'X': (a1 - a0, 0, 0), 'Y': (0, a1 - a0, 0), 'Z': (0, 0, a1 - a0)}[axis]
    bmesh.ops.translate(bm, vec=Vector(vec), verts=ev)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(bm, name, m)

def reveal(name, x0, x1, z0, z1, y0, y1, m, top=True, bottom=True):
    """Inward-facing quads lining a rectangular opening between depth y0 (wall) and y1 (recess)."""
    faces = [
        ([(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], (1, 0, 0)),
        ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (-1, 0, 0)),
    ]
    if top:
        faces.append(([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, -1)))
    if bottom:
        faces.append(([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], (0, 0, 1)))
    return _faces_obj(name, faces, m)

def arc_pts(cx, cz, r, a0, a1, n):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cz + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]

def arc_reveal(name, cx, cz, r, y0, y1, n, m):
    """Quad strip lining a semicircular arch head (0..pi), facing inward/down."""
    pts = arc_pts(cx, cz, r, 0, math.pi, n)
    faces = []
    for i in range(n):
        (xa, za), (xb, zb) = pts[i], pts[i + 1]
        mid = ((xa + xb) / 2 - cx, (za + zb) / 2 - cz)
        faces.append(([(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)], (-mid[0], 0, -mid[1])))
    return _faces_obj(name, faces, m)

def arc_strip(name, cx, cz, r0, r1, y, n, m, a0=0.0, a1=math.pi, facing=-1):
    """Flat annular strip between radii r0<r1 in the XZ plane at depth y (e.g. an arched sash head)."""
    inner = arc_pts(cx, cz, r0, a0, a1, n); outer = arc_pts(cx, cz, r1, a0, a1, n)
    faces = []
    for i in range(n):
        faces.append(([(inner[i][0], y, inner[i][1]), (outer[i][0], y, outer[i][1]),
                       (outer[i + 1][0], y, outer[i + 1][1]), (inner[i + 1][0], y, inner[i + 1][1])], (0, facing, 0)))
    return _faces_obj(name, faces, m)

def voussoirs(prefix, cx, cz, r0, r1, n, y_deep, y_shallow, m, a0=0.0, a1=math.pi):
    """n wedge prisms forming an arch ring between radii r0..r1; projection alternates (y_deep / y_shallow)."""
    out = []
    for i in range(n):
        b0 = a0 + (a1 - a0) * i / n; b1 = a0 + (a1 - a0) * (i + 1) / n
        pts = [(cx + r0 * math.cos(b0), cz + r0 * math.sin(b0)), (cx + r1 * math.cos(b0), cz + r1 * math.sin(b0)),
               (cx + r1 * math.cos(b1), cz + r1 * math.sin(b1)), (cx + r0 * math.cos(b1), cz + r0 * math.sin(b1))]
        out.append(prism(f"{prefix}{i}", pts, 'Y', y_deep if i % 2 == 0 else y_shallow, 0.0, m))
    return out

def _rot_z_to(d):
    return Vector((0, 0, 1)).rotation_difference(Vector(d).normalized()).to_euler()

def bar(name, a, b, tx, ty, m):
    """Box of cross-section tx*ty whose long axis runs from point a to point b."""
    a = Vector(a); b = Vector(b); d = b - a
    return box(name, (tx, ty, d.length), tuple((a + b) / 2), m, rotation=_rot_z_to(d))

def rod(name, a, b, r, m, seg=6):
    """Cylinder from point a to point b."""
    a = Vector(a); b = Vector(b); d = b - a
    return cylinder(name, r, d.length, tuple((a + b) / 2), m, seg, rotation=_rot_z_to(d))

def revolve(name, profile, m, segments=16, flute_depth=0.0, cap=True, cx=0.0, cy=0.0):
    """Lathe around a vertical axis at (cx,cy). profile: (r, z) or (r, z, fluted).
    Fluted rings alternate radius per vertex -> fake flutes (use an even segment count)."""
    bm = bmesh.new()
    rings = []
    for p in profile:
        r, z = p[0], p[1]
        fl = len(p) > 2 and p[2]
        ring = []
        for i in range(segments):
            a = 2 * math.pi * i / segments
            rr = r * (1 - flute_depth) if (fl and i % 2) else r
            ring.append(bm.verts.new((cx + rr * math.cos(a), cy + rr * math.sin(a), z)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for j in range(segments):
            k = (j + 1) % segments
            bm.faces.new((a[j], a[k], b[k], b[j]))
    if cap:
        if profile[0][0] > 1e-6: bm.faces.new(list(reversed(rings[0])))
        if profile[-1][0] > 1e-6: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(bm, name, m)

def grid_mesh(name, origin, u_vec, v_vec, nu, nv, m, normal_hint):
    """Subdivided quad sheet: origin + u_vec*(i/nu) + v_vec*(j/nv). For flags / awning sheets."""
    bm = bmesh.new()
    o, u, v = Vector(origin), Vector(u_vec), Vector(v_vec)
    verts = [[bm.verts.new(o + u * (i / nu) + v * (j / nv)) for j in range(nv + 1)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            f = bm.faces.new((verts[i][j], verts[i + 1][j], verts[i + 1][j + 1], verts[i][j + 1]))
            f.normal_update()
            if f.normal.dot(Vector(normal_hint)) < 0:
                bmesh.ops.reverse_faces(bm, faces=[f])
    return mesh_from_bmesh(bm, name, m)

def finish(parts, name):
    """Join parts into one object named `name`, bake transforms so the origin is the world origin."""
    parts = [p for p in parts if p is not None]
    obj = join(parts, name) if len(parts) > 1 else parts[0]
    obj.name = name
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.location = (0, 0, 0)
    obj.data.name = name
    return obj

def bbox(objs):
    xs, ys, zs = [], [], []
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            xs.append(w.x); ys.append(w.y); zs.append(w.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))

# ----------------------------------------------------------------------------------------------
# façade sub-assemblies
# ----------------------------------------------------------------------------------------------
SILL_H = 0.08      # sill thickness below the opening -> opening bottom sits at z = SILL_H
RECESS = 0.25      # stone window recess

def stone_sill(parts, w, sw, z0, proj=0.12, m="limestone", extra=0.03):
    parts.append(bx("sill", -w / 2 - sw - extra, w / 2 + sw + extra, -proj, 0.0, z0 - SILL_H, z0, m))

def stone_jambs(parts, w, h, sw, z0, proj=0.05, m="limestone"):
    parts.append(bx("jambL", -w / 2 - sw, -w / 2, -proj, 0.0, z0, z0 + h, m))
    parts.append(bx("jambR", w / 2, w / 2 + sw, -proj, 0.0, z0, z0 + h, m))

def stone_lintel(parts, w, h, sw, z0, proj=0.05, m="limestone", keystone=False, lod=0):
    zt = z0 + h
    if keystone:
        parts.append(bx("lintel", -w / 2 - sw, w / 2 + sw, -proj, 0.0, zt, zt + sw, m))
        if lod == 0:
            k = 0.12
            parts.append(prism("keystone", [(-k, zt - 0.02), (k, zt - 0.02), (k + 0.05, zt + sw + 0.06), (-k - 0.05, zt + sw + 0.06)],
                               'Y', -proj - 0.05, 0.0, m))
    else:
        parts.append(bx("lintel", -w / 2 - sw, w / 2 + sw, -proj, 0.0, zt, zt + sw, m))

def dh_sash(parts, x0, x1, z0, z1, y_front, lod=0, frame="paint_white", glass="glass_tint", fw=0.06, fd=0.04, tag=""):
    """Double-hung 1-over-1 sash inside an opening x0..x1 / z0..z1; frame front face at y_front (+Y = deeper)."""
    y1 = y_front + fd
    parts += [bx("stL" + tag, x0, x0 + fw, y_front, y1, z0, z1, frame),
              bx("stR" + tag, x1 - fw, x1, y_front, y1, z0, z1, frame),
              bx("head" + tag, x0 + fw, x1 - fw, y_front, y1, z1 - fw, z1, frame),
              bx("foot" + tag, x0 + fw, x1 - fw, y_front, y1, z0, z0 + fw, frame)]
    zm = (z0 + z1) / 2
    if lod == 0:
        parts.append(bx("rail" + tag, x0 + fw, x1 - fw, y_front, y1, zm - 0.035, zm + 0.035, frame))
        parts.append(vquad("glU" + tag, x0 + fw, x1 - fw, zm + 0.035, z1 - fw, y_front + fd * 0.5, glass))
        parts.append(vquad("glL" + tag, x0 + fw, x1 - fw, z0 + fw, zm - 0.035, y_front + fd * 0.75, glass))
    else:
        parts.append(vquad("gl" + tag, x0 + fw, x1 - fw, z0 + fw, z1 - fw, y_front + fd * 0.5, glass))

def frame_border(parts, x0, x1, z0, z1, y0, y1, fw, m, tag=""):
    """Rectangular frame (4 boxes) between depths y0..y1."""
    parts += [bx("fL" + tag, x0, x0 + fw, y0, y1, z0, z1, m),
              bx("fR" + tag, x1 - fw, x1, y0, y1, z0, z1, m),
              bx("fT" + tag, x0 + fw, x1 - fw, y0, y1, z1 - fw, z1, m),
              bx("fB" + tag, x0 + fw, x1 - fw, y0, y1, z0, z0 + fw, m)]

def glass_door_leaf(parts, x0, x1, z0, z1, y0, y1, frame_m, glass_m, lod=0, push="chrome", hinge_left=True, tag=""):
    """Full-glass door leaf with stiles, rails, bottom rail and a horizontal push bar."""
    fw = 0.08
    parts += [bx("dsL" + tag, x0, x0 + fw, y0, y1, z0, z1, frame_m),
              bx("dsR" + tag, x1 - fw, x1, y0, y1, z0, z1, frame_m),
              bx("dtop" + tag, x0 + fw, x1 - fw, y0, y1, z1 - fw, z1, frame_m),
              bx("dbot" + tag, x0 + fw, x1 - fw, y0, y1, z0, z0 + 0.25, frame_m)]
    parts.append(vquad("dgl" + tag, x0 + fw, x1 - fw, z0 + 0.25, z1 - fw, (y0 + y1) / 2, glass_m))
    if lod == 0:
        zb = z0 + 1.0
        yb = y0 - 0.07
        parts.append(rod("push" + tag, (x0 + 0.12, yb, zb), (x1 - 0.12, yb, zb), 0.016, push, seg=6))
        for i, xx in enumerate((x0 + 0.15, x1 - 0.15)):
            parts.append(bx(f"pstand{tag}{i}", xx - 0.015, xx + 0.015, yb, y0, zb - 0.015, zb + 0.015, push))

def balusters(parts, m, pts, lod=0, tag="b"):
    """Stone balusters (lathe) centred at each (x, y); z from 0.1 (plinth top) to 0.85 (rail bottom)."""
    if lod == 0:
        prof = [(0.07, 0.10), (0.10, 0.30), (0.045, 0.65), (0.075, 0.85)]
        seg = 8
    else:
        prof = [(0.07, 0.10), (0.09, 0.40), (0.07, 0.85)]
        seg = 4
    for i, (x, y) in enumerate(pts):
        parts.append(revolve(f"{tag}{i}", prof, m, segments=seg, cx=x, cy=y))

# ----------------------------------------------------------------------------------------------
# WINDOWS
# ----------------------------------------------------------------------------------------------
def win_dh_stone(w, h, keystone=False, lod=0):
    sw = 0.15; z0 = SILL_H; parts = []
    stone_jambs(parts, w, h, sw, z0)
    stone_lintel(parts, w, h, sw, z0, keystone=keystone, lod=lod)
    stone_sill(parts, w, sw, z0)
    parts.append(reveal("reveal", -w / 2, w / 2, z0, z0 + h, 0.0, RECESS, "limestone"))
    dh_sash(parts, -w / 2, w / 2, z0, z0 + h, RECESS - 0.05, lod=lod)
    return [finish(parts, "win_dh")]

def win_arch_stone(w, h, lod=0):
    r = w / 2; sw = 0.15; z0 = SILL_H; zs = z0 + h - r   # spring line
    n = 12 if lod == 0 else 6
    parts = []
    stone_jambs(parts, w, h - r, sw, z0)
    stone_sill(parts, w, sw, z0)
    # imposts at the spring line
    for s in (-1, 1):
        parts.append(bx(f"impost{s}", s * (w / 2 + sw + 0.04) - 0.02 - sw / 2, s * (w / 2 + sw + 0.04) + 0.02 + sw / 2,
                        -0.08, 0.0, zs - 0.10, zs, "limestone"))
    parts += voussoirs("vous", 0, zs, r, r + sw + 0.05, 9 if lod == 0 else 5, -0.08, -0.05, "limestone")
    parts.append(reveal("revJ", -r, r, z0, zs, 0.0, RECESS, "limestone", top=False))
    parts.append(arc_reveal("revA", 0, zs, r, 0.0, RECESS, n, "limestone"))
    # glass: rectangle + semicircle
    gpts = [(-r + 0.06, z0 + 0.06), (r - 0.06, z0 + 0.06)] + arc_pts(0, zs, r - 0.06, 0, math.pi, n)
    parts.append(poly_xz("glass", gpts, RECESS - 0.02, "glass_tint"))
    # sash: stiles, spring transom, arched head strip, meeting rail, radial muntins
    yf = RECESS - 0.05; fd = 0.04
    parts += [bx("stL", -r, -r + 0.06, yf, yf + fd, z0, zs, "paint_white"),
              bx("stR", r - 0.06, r, yf, yf + fd, z0, zs, "paint_white"),
              bx("foot", -r + 0.06, r - 0.06, yf, yf + fd, z0, z0 + 0.06, "paint_white"),
              bx("spring", -r + 0.06, r - 0.06, yf, yf + fd, zs - 0.04, zs + 0.04, "paint_white"),
              arc_strip("head", 0, zs, r - 0.06, r, yf + 0.01, n, "paint_white")]
    if lod == 0:
        zm = z0 + (zs - z0) / 2
        parts.append(bx("rail", -r + 0.06, r - 0.06, yf, yf + fd, zm - 0.035, zm + 0.035, "paint_white"))
        for a in (math.pi / 4, math.pi / 2, 3 * math.pi / 4):
            parts.append(bar(f"muntin{int(a*100)}", (0, yf + 0.02, zs), ((r - 0.06) * math.cos(a), yf + 0.02, zs + (r - 0.06) * math.sin(a)), 0.03, 0.03, "paint_white"))
    return [finish(parts, "win_arch")]

def win_pair_stone(w, h, lod=0):
    sw = 0.15; mull = 0.30; z0 = SILL_H
    ow = (w - mull) / 2   # each opening width
    parts = []
    stone_jambs(parts, w, h, sw, z0)
    parts.append(bx("mullion", -mull / 2, mull / 2, -0.05, 0.0, z0, z0 + h, "limestone"))
    parts.append(bx("lintel", -w / 2 - sw, w / 2 + sw, -0.05, 0.0, z0 + h, z0 + h + sw, "limestone"))
    stone_sill(parts, w, sw, z0)
    # cornice hood (Beaux-Arts) on 2 consoles
    zt = z0 + h + sw
    hw = w / 2 + sw + 0.10
    prof = [(0, zt), (-0.06, zt), (-0.12, zt + 0.07), (-0.24, zt + 0.15), (-0.24, zt + 0.21), (0, zt + 0.21)]
    parts.append(prism("hood", prof, 'X', -hw, hw, "limestone"))
    if lod == 0:
        for s in (-1, 1):
            parts.append(bx(f"console{s}", s * (w / 2 + sw / 2) - 0.07, s * (w / 2 + sw / 2) + 0.07, -0.20, 0.0, zt - 0.22, zt, "limestone"))
    for s, tag in ((-1, "L"), (1, "R")):
        x0 = s * mull / 2 if s > 0 else -mull / 2 - ow
        x1 = x0 + ow
        parts.append(reveal("rev" + tag, x0, x1, z0, z0 + h, 0.0, RECESS, "limestone"))
        dh_sash(parts, x0, x1, z0, z0 + h, RECESS - 0.05, lod=lod, tag=tag)
    return [finish(parts, "win_pair")]

def win_punched_modern(w, h, lod=0):
    rec = 0.10; parts = []
    parts.append(reveal("reveal", -w / 2, w / 2, 0, h, 0.0, rec, "metal_alu"))
    frame_border(parts, -w / 2, w / 2, 0, h, rec - 0.06, rec, 0.06, "metal_alu")
    parts.append(vquad("glass", -w / 2 + 0.06, w / 2 - 0.06, 0.06, h - 0.06, rec - 0.01, "glass_tint"))
    return [finish(parts, "win_punched")]

def win_office_strip(w, h, lights=3, lod=0):
    rec = 0.08; fw = 0.05; parts = []
    parts.append(reveal("reveal", -w / 2, w / 2, 0, h, 0.0, rec, "metal_alu"))
    frame_border(parts, -w / 2, w / 2, 0, h, rec - 0.05, rec, fw, "metal_alu")
    lw = w / lights
    for i in range(1, lights):
        x = -w / 2 + lw * i
        parts.append(bx(f"mull{i}", x - 0.025, x + 0.025, rec - 0.05, rec, fw, h - fw, "metal_alu"))
    parts.append(vquad("glass", -w / 2 + fw, w / 2 - fw, fw, h - fw, rec - 0.01, "glass_tint"))
    return [finish(parts, "win_strip")]

def win_curtain(w, h, spandrel=0.9, lod=0):
    md = 0.15; mw = 0.06; parts = []   # mullion depth / width
    parts.append(bx("spandrel", -w / 2, w / 2, -0.02, 0.0, 0, spandrel, "granite_dark"))
    parts.append(vquad("glass", -w / 2, w / 2, spandrel, h, -0.01, "glass_tint"))
    # half mullions at both edges (tile to a full mullion), full mullion in the centre
    parts += [bx("mulL", -w / 2, -w / 2 + mw / 2, -md, 0.0, 0, h, "metal_alu"),
              bx("mulR", w / 2 - mw / 2, w / 2, -md, 0.0, 0, h, "metal_alu"),
              bx("mulC", -mw / 2, mw / 2, -md, 0.0, 0, h, "metal_alu"),
              bx("transom", -w / 2, w / 2, -md, 0.0, spandrel - mw / 2, spandrel + mw / 2, "metal_alu"),
              bx("transT", -w / 2, w / 2, -md, 0.0, h - mw / 2, h, "metal_alu"),
              bx("transB", -w / 2, w / 2, -md, 0.0, 0, mw / 2, "metal_alu")]
    if lod == 0:
        parts.append(bx("cap", -w / 2, w / 2, -md - 0.03, -md, spandrel - 0.02, spandrel + 0.08, "metal_alu"))
    return [finish(parts, "win_curtain")]

def win_bay_oriel(w, h, proj=0.6, lod=0):
    # plan: A(-w/2,0) B(-w/2+proj,-proj) C(w/2-proj,-proj) D(w/2,0)
    A, B, C, D = (-w / 2, 0.0), (-w / 2 + proj, -proj), (w / 2 - proj, -proj), (w / 2, 0.0)
    plan = [A, B, C, D]
    z_br, z_slab, z_panel, z_glass, z_roof = 0.0, 0.30, 0.45, 1.0, 2.7
    wd, glass_m, frame_m = "wood_dark", "glass_tint", "paint_white"
    parts = []
    parts.append(prism("slab", plan, 'Z', z_slab, z_panel, wd))
    if lod == 0:
        for s in (-1, 1):
            parts.append(bar(f"bracket{s}", (s * (w / 2 - 0.3), 0.0, z_br), (s * (w / 2 - 0.3), -proj + 0.1, z_slab), 0.12, 0.08, wd))
    faces = [(A, B), (B, C), (C, D)]
    for i, (p, q) in enumerate(faces):
        # side panel below the glazing, sill rail, glazing, head rail
        px, py = p; qx, qy = q
        ang = math.atan2(qy - py, qx - px); L = math.hypot(qx - px, qy - py)
        cx, cy = (px + qx) / 2, (py + qy) / 2
        # offset boxes outward (normal = (sin ang, -cos ang)) by half thickness
        nx, ny = math.sin(ang), -math.cos(ang)
        th = 0.08
        def seg_box(name, z0, z1, thick, off, mat_):
            return box(name, (L, thick, z1 - z0), (cx + nx * off, cy + ny * off, (z0 + z1) / 2), mat_, rotation=(0, 0, ang))
        parts.append(seg_box(f"panel{i}", z_panel, z_glass - 0.1, th, -th / 2 + 0.01, wd))
        parts.append(seg_box(f"sill{i}", z_glass - 0.1, z_glass, 0.12, 0.0, wd))
        parts.append(seg_box(f"head{i}", z_roof - 0.1, z_roof, th, -th / 2 + 0.01, wd))
        # glazing: a plane rotated (x->along segment)
        gz0, gz1 = z_glass, z_roof - 0.1
        if lod == 0:
            zm = (gz0 + gz1) / 2
            parts.append(seg_box(f"rail{i}", zm - 0.03, zm + 0.03, 0.05, -0.02, frame_m))
            parts.append(plane(f"glU{i}", (L - 0.1, gz1 - zm - 0.03), (cx, cy, (zm + 0.03 + gz1) / 2), glass_m, rotation=(math.pi / 2, 0, ang)))
            parts.append(plane(f"glL{i}", (L - 0.1, zm - 0.03 - gz0), (cx, cy, (gz0 + zm - 0.03) / 2), glass_m, rotation=(math.pi / 2, 0, ang)))
        else:
            parts.append(plane(f"gl{i}", (L - 0.1, gz1 - gz0), (cx, cy, (gz0 + gz1) / 2), glass_m, rotation=(math.pi / 2, 0, ang)))
    # corner posts
    for i, (px, py) in enumerate(plan):
        parts.append(bx(f"post{i}", px - 0.05, px + 0.05, py - 0.05, py + 0.05, z_panel, z_roof, frame_m))
    # roof: two stacked prisms (cornice + cap), slightly bigger than the plan
    def offset_plan(d):
        return [(A[0] - d, A[1]), (B[0] - d * 0.7, B[1] - d), (C[0] + d * 0.7, C[1] - d), (D[0] + d, D[1])]
    parts.append(prism("cornice", offset_plan(0.06), 'Z', z_roof, z_roof + 0.15, wd))
    parts.append(prism("cap", offset_plan(0.0), 'Z', z_roof + 0.15, h, wd))
    return [finish(parts, "win_bay")]

# ----------------------------------------------------------------------------------------------
# STOREFRONTS / DOORS
# ----------------------------------------------------------------------------------------------
def storefront_bay(w, h, transom_z, lights=1, bulk=0.4, lod=0, frame_m="metal_black", glass_m="glass_clear", bulk_m="granite_dark"):
    fw = 0.08; fd = 0.10; parts = []
    parts.append(bx("bulkhead", -w / 2, w / 2, -0.06, 0.02, 0, bulk, bulk_m))
    parts += [bx("stL", -w / 2, -w / 2 + fw, -fd, 0.0, bulk, h, frame_m),
              bx("stR", w / 2 - fw, w / 2, -fd, 0.0, bulk, h, frame_m),
              bx("head", -w / 2 + fw, w / 2 - fw, -fd, 0.0, h - fw, h, frame_m),
              bx("sillrail", -w / 2 + fw, w / 2 - fw, -fd, 0.0, bulk, bulk + 0.06, frame_m),
              bx("transom", -w / 2 + fw, w / 2 - fw, -fd, 0.0, transom_z - 0.04, transom_z + 0.04, frame_m)]
    lw = (w - 2 * fw) / lights
    for i in range(1, lights):
        x = -w / 2 + fw + lw * i
        parts.append(bx(f"mull{i}", x - 0.03, x + 0.03, -fd, 0.0, bulk + 0.06, transom_z - 0.04, frame_m))
    parts.append(vquad("glassLow", -w / 2 + fw, w / 2 - fw, bulk + 0.06, transom_z - 0.04, -0.04, glass_m))
    parts.append(vquad("glassTr", -w / 2 + fw, w / 2 - fw, transom_z + 0.04, h - fw, -0.04, glass_m))
    return [finish(parts, "storefront")]

def storefront_door_double(bay_w=3.0, bay_h=3.2, dw=2.0, dh=2.8, lod=0):
    fw = 0.08; fd = 0.10; fm, gm = "metal_black", "glass_clear"; parts = []
    parts += [bx("stL", -bay_w / 2, -bay_w / 2 + fw, -fd, 0.0, 0, bay_h, fm),
              bx("stR", bay_w / 2 - fw, bay_w / 2, -fd, 0.0, 0, bay_h, fm),
              bx("head", -bay_w / 2 + fw, bay_w / 2 - fw, -fd, 0.0, bay_h - fw, bay_h, fm),
              bx("postL", -dw / 2 - fw, -dw / 2, -fd, 0.0, 0, bay_h - fw, fm),
              bx("postR", dw / 2, dw / 2 + fw, -fd, 0.0, 0, bay_h - fw, fm),
              bx("transom", -dw / 2, dw / 2, -fd, 0.0, dh, dh + 0.06, fm)]
    # sidelights
    for s, tag in ((-1, "L"), (1, "R")):
        x0, x1 = (-bay_w / 2 + fw, -dw / 2 - fw) if s < 0 else (dw / 2 + fw, bay_w / 2 - fw)
        parts.append(bx("kick" + tag, x0, x1, -fd, 0.0, 0, 0.25, fm))
        parts.append(vquad("sl" + tag, x0, x1, 0.25, bay_h - fw, -0.05, gm))
    parts.append(vquad("trGlass", -dw / 2, dw / 2, dh + 0.06, bay_h - fw, -0.05, gm))
    # two leaves, slightly recessed within the frame
    glass_door_leaf(parts, -dw / 2, 0.0, 0.0, dh, -0.06, -0.01, fm, gm, lod=lod, tag="A")
    glass_door_leaf(parts, 0.0, dw / 2, 0.0, dh, -0.06, -0.01, fm, gm, lod=lod, tag="B")
    return [finish(parts, "storefront_door")]

def storefront_door_recessed(w=3.0, h=4.5, depth=1.5, lod=0):
    fm, gm = "metal_black", "glass_clear"; fw = 0.08; fd = 0.1
    z_soffit = 3.2; dw = 2.0; dh = 2.8; xin = 1.0
    parts = []
    # frame around the whole bay at the wall plane + transom glass above the soffit line
    parts += [bx("stL", -w / 2, -w / 2 + fw, -fd, 0.0, 0, h, fm),
              bx("stR", w / 2 - fw, w / 2, -fd, 0.0, 0, h, fm),
              bx("head", -w / 2 + fw, w / 2 - fw, -fd, 0.0, h - fw, h, fm),
              bx("soffitBeam", -w / 2 + fw, w / 2 - fw, -fd, 0.0, z_soffit - 0.08, z_soffit, fm)]
    parts.append(vquad("trGlass", -w / 2 + fw, w / 2 - fw, z_soffit, h - fw, -0.03, gm))
    # soffit (facing down) and floor (facing up) of the vestibule
    trap = [(-w / 2, 0.0), (w / 2, 0.0), (xin, depth), (-xin, depth)]
    parts.append(poly_xy("soffit", trap, z_soffit - 0.08, "plaster_white", facing=-1))
    parts.append(poly_xy("floor", trap, 0.01, "granite_dark", facing=1))
    # angled display windows: from (±w/2, 0) to (±xin, depth)
    for s, tag in ((-1, "L"), (1, "R")):
        p = (s * (w / 2 - fw / 2), 0.0); q = (s * xin, depth)
        ang = math.atan2(q[1] - p[1], q[0] - p[0]); L = math.hypot(q[0] - p[0], q[1] - p[1])
        cx, cy = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
        # normal toward the vestibule interior: for the left window interior is +X-ish
        parts.append(box("bulk" + tag, (L, 0.1, 0.4), (cx, cy, 0.2), "granite_dark", rotation=(0, 0, ang)))
        parts.append(box("sillr" + tag, (L, 0.08, 0.06), (cx, cy, 0.43), fm, rotation=(0, 0, ang)))
        parts.append(box("headr" + tag, (L, 0.08, 0.08), (cx, cy, z_soffit - 0.12), fm, rotation=(0, 0, ang)))
        parts.append(box("postIn" + tag, (0.1, 0.1, z_soffit - 0.08), (q[0], q[1], (z_soffit - 0.08) / 2), fm))
        parts.append(plane("dgl" + tag, (L - 0.1, z_soffit - 0.16 - 0.46), (cx, cy, (0.46 + z_soffit - 0.16) / 2), gm,
                           rotation=(math.pi / 2, 0, ang + (math.pi if s < 0 else 0))))
    # rear wall with double doors at y = depth
    parts.append(bx("rearHead", -xin, xin, depth - 0.05, depth + 0.05, dh, z_soffit - 0.08, fm))
    parts.append(vquad("rearTr", -xin + 0.1, xin - 0.1, dh + 0.06, z_soffit - 0.16, depth, gm))
    glass_door_leaf(parts, -dw / 2, 0.0, 0.0, dh, depth - 0.05, depth, fm, gm, lod=lod, tag="A")
    glass_door_leaf(parts, 0.0, dw / 2, 0.0, dh, depth - 0.05, depth, fm, gm, lod=lod, tag="B")
    return [finish(parts, "storefront_recessed")]

def door_revolving(dia=2.4, h=2.6, lod=0):
    r = dia / 2; seg = 24 if lod == 0 else 12; parts = []
    # drum walls: two glass arcs on the sides (openings toward the street -Y and the interior +Y)
    for (a0, a1, tag) in ((math.radians(-55), math.radians(55), "R"), (math.radians(125), math.radians(235), "L")):
        n = 6 if lod == 0 else 3
        bm = bmesh.new()
        pts = [(r * math.cos(a0 + (a1 - a0) * i / n), r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
        for i in range(n):
            (xa, ya), (xb, yb) = pts[i], pts[i + 1]
            f = bm.faces.new([bm.verts.new(p) for p in [(xa, ya, 0.1), (xb, yb, 0.1), (xb, yb, h - 0.15), (xa, ya, h - 0.15)]])
            f.normal_update()
            if f.normal.dot(Vector(((xa + xb) / 2, (ya + yb) / 2, 0))) < 0:
                bmesh.ops.reverse_faces(bm, faces=[f])
        parts.append(mesh_from_bmesh(bm, "drum" + tag, "glass_clear"))
        # brass edge posts at the arc ends
        for (xa, ya) in (pts[0], pts[-1]):
            parts.append(bx(f"post{tag}{round(xa,2)}", xa - 0.03, xa + 0.03, ya - 0.03, ya + 0.03, 0, h - 0.15, "brass"))
    parts.append(cylinder("canopy", r + 0.05, 0.15, (0, 0, h - 0.075), "brass", segments=seg))
    parts.append(cylinder("base", r + 0.02, 0.1, (0, 0, 0.05), "brass", segments=seg))
    parts.append(cylinder("hub", 0.05, h - 0.25, (0, 0, 0.1 + (h - 0.25) / 2), "brass", segments=8 if lod == 0 else 4))
    # four wings
    for i in range(4):
        a = math.pi / 2 * i + math.pi / 4
        ex, ey = (r - 0.08) * math.cos(a), (r - 0.08) * math.sin(a)
        parts.append(plane(f"wing{i}", (r - 0.13, h - 0.35), (ex / 2, ey / 2, 0.1 + (h - 0.25) / 2), "glass_clear", rotation=(math.pi / 2, 0, a)))
        parts.append(bx(f"wingbar{i}", ex - 0.02, ex + 0.02, ey - 0.02, ey + 0.02, 0.1, h - 0.15, "brass"))
    return [finish(parts, "door_revolving")]

def door_hotel_marquee(w=6.0, lod=0):
    fm, gm = "brass", "glass_clear"; parts = []
    dw, dh = 1.4, 2.8; pier = 0.35; z_tr = 3.6
    # three door bays at x = -2.0, 0, 2.0 with marble piers between and at ends
    centres = (-2.0, 0.0, 2.0)
    for i, c in enumerate(centres):
        x0, x1 = c - dw / 2, c + dw / 2
        frame_border(parts, x0 - 0.08, x1 + 0.08, 0, z_tr, -0.12, 0.0, 0.08, fm, tag=f"d{i}")
        parts.append(bx(f"tr{i}", x0, x1, -0.12, 0.0, dh, dh + 0.06, fm))
        parts.append(vquad(f"trg{i}", x0, x1, dh + 0.06, z_tr - 0.08, -0.06, gm))
        glass_door_leaf(parts, x0, x1, 0.0, dh, -0.08, -0.02, fm, gm, lod=lod, push="brass", tag=f"d{i}")
    # piers (marble) between/around the doors
    xs = [(-w / 2, centres[0] - dw / 2 - 0.08), (centres[0] + dw / 2 + 0.08, centres[1] - dw / 2 - 0.08),
          (centres[1] + dw / 2 + 0.08, centres[2] - dw / 2 - 0.08), (centres[2] + dw / 2 + 0.08, w / 2)]
    for i, (a, b) in enumerate(xs):
        parts.append(bx(f"pier{i}", a, b, -0.15, 0.0, 0, z_tr + 0.3, "marble_white"))
    parts.append(bx("lintel", -w / 2, w / 2, -0.18, 0.0, z_tr, z_tr + 0.3, "marble_white"))
    # marquee canopy: 6 m wide, 4 m deep, top of slab at 4.3, fascia 3.9..4.45
    z_c = 4.0; D = 4.0
    parts.append(bx("slab", -w / 2 + 0.05, w / 2 - 0.05, -D + 0.05, 0.0, z_c, z_c + 0.25, "metal_black"))
    parts += [bx("fasciaF", -w / 2, w / 2, -D - 0.05, -D + 0.05, z_c - 0.1, z_c + 0.45, fm),
              bx("fasciaL", -w / 2 - 0.05, -w / 2 + 0.05, -D, 0.0, z_c - 0.1, z_c + 0.45, fm),
              bx("fasciaR", w / 2 - 0.05, w / 2 + 0.05, -D, 0.0, z_c - 0.1, z_c + 0.45, fm),
              bx("fasciaBand", -w / 2 - 0.02, w / 2 + 0.02, -D - 0.08, -D - 0.05, z_c + 0.05, z_c + 0.30, "metal_black")]
    parts.append(hquad("underside", -w / 2, w / 2, -D, 0.0, z_c - 0.02, "paint_cream", facing=-1))
    if lod == 0:
        for ix in range(5):
            for iy in range(3):
                x = -w / 2 + 0.6 + ix * (w - 1.2) / 4
                y = -D + 0.6 + iy * (D - 1.2) / 2
                parts.append(hquad(f"light{ix}{iy}", x - 0.12, x + 0.12, y - 0.12, y + 0.12, z_c - 0.035, "emissive_warm", facing=-1))
    # tie rods from fascia top to the wall
    for s in (-1, 1):
        parts.append(rod(f"rod{s}", (s * (w / 2 - 0.3), -D + 0.1, z_c + 0.45), (s * (w / 2 - 0.3), 0.0, z_c + 2.6), 0.03, fm, seg=6))
        parts.append(bx(f"rodplate{s}", s * (w / 2 - 0.3) - 0.1, s * (w / 2 - 0.3) + 0.1, -0.03, 0.0, z_c + 2.5, z_c + 2.7, fm))
    return [finish(parts, "door_hotel_marquee")]

def storefront_luxury(w=4.0, h=5.0, lod=0):
    fm, gm = "brass", "glass_clear"; pil = 0.4; fascia = 0.8; parts = []
    z_top = h - fascia
    for s in (-1, 1):
        x0, x1 = (s * w / 2, s * (w / 2 - pil)) if s < 0 else (s * (w / 2 - pil), s * w / 2)
        x0, x1 = min(x0, x1), max(x0, x1)
        parts.append(bx(f"pilaster{s}", x0, x1, -0.20, 0.0, 0, z_top, "marble_white"))
        parts.append(bx(f"pilbase{s}", x0 - 0.02, x1 + 0.02, -0.24, 0.0, 0, 0.5, "marble_white"))
        parts.append(bx(f"pilcap{s}", x0 - 0.03, x1 + 0.03, -0.26, 0.0, z_top - 0.2, z_top, "marble_white"))
    parts.append(bx("fascia", -w / 2, w / 2, -0.25, 0.0, z_top, h, "marble_white"))
    parts.append(bx("fasciaMould", -w / 2, w / 2, -0.32, 0.0, h - 0.08, h, "marble_white"))
    iw0, iw1 = -w / 2 + pil, w / 2 - pil
    fw = 0.07; fd = 0.10; tz = 3.4
    parts.append(bx("bulkhead", iw0, iw1, -0.08, 0.0, 0, 0.5, "granite_dark"))
    parts += [bx("stL", iw0, iw0 + fw, -fd, 0.0, 0.5, z_top, fm),
              bx("stR", iw1 - fw, iw1, -fd, 0.0, 0.5, z_top, fm),
              bx("head", iw0 + fw, iw1 - fw, -fd, 0.0, z_top - fw, z_top, fm),
              bx("sillr", iw0 + fw, iw1 - fw, -fd, 0.0, 0.5, 0.56, fm),
              bx("transom", iw0 + fw, iw1 - fw, -fd, 0.0, tz - 0.04, tz + 0.04, fm)]
    parts.append(vquad("glassLow", iw0 + fw, iw1 - fw, 0.56, tz - 0.04, -0.04, gm))
    parts.append(vquad("glassTr", iw0 + fw, iw1 - fw, tz + 0.04, z_top - fw, -0.04, gm))
    if lod == 0:
        # bronze grille pattern on the transom: 3 vertical bars
        for i in range(1, 4):
            x = iw0 + (iw1 - iw0) * i / 4
            parts.append(bx(f"trbar{i}", x - 0.02, x + 0.02, -fd, 0.0, tz + 0.04, z_top - fw, fm))
    return [finish(parts, "storefront_luxury")]

def storefront_arcade_arch(w=4.0, h=5.5, lod=0):
    pier = 0.5; ring = 0.5; r_in = w / 2 - pier; r_out = w / 2   # 1.5 / 2.0
    zs = h - r_out                                               # spring line (3.5)
    n = 12 if lod == 0 else 6
    fm, gm, sm = "metal_black", "glass_clear", "limestone"; parts = []
    parts.append(bx("pierL", -w / 2, -r_in, -0.15, 0.0, 0, zs, sm))
    parts.append(bx("pierR", r_in, w / 2, -0.15, 0.0, 0, zs, sm))
    for s in (-1, 1):
        parts.append(bx(f"impost{s}", s * (r_in + pier / 2) - pier / 2 - 0.04, s * (r_in + pier / 2) + pier / 2 + 0.04, -0.2, 0.0, zs - 0.15, zs, sm))
    parts += voussoirs("vous", 0, zs, r_in, r_out, 11 if lod == 0 else 5, -0.15, -0.11, sm)
    rec = 0.30
    parts.append(reveal("revJ", -r_in, r_in, 0, zs, 0.0, rec, sm, top=False))
    parts.append(arc_reveal("revA", 0, zs, r_in, 0.0, rec, n, sm))
    # glass infill (rect + semicircle) with black frame
    fw = 0.08
    gpts = [(-r_in + fw, 0.45), (r_in - fw, 0.45)] + arc_pts(0, zs, r_in - fw, 0, math.pi, n)
    parts.append(poly_xz("glass", gpts, rec - 0.03, gm))
    yf = rec - 0.1
    parts += [bx("bulkhead", -r_in, r_in, yf - 0.02, rec, 0, 0.45, "granite_dark"),
              bx("stL", -r_in, -r_in + fw, yf, rec, 0.45, zs, fm),
              bx("stR", r_in - fw, r_in, yf, rec, 0.45, zs, fm),
              bx("spring", -r_in + fw, r_in - fw, yf, rec, zs - 0.05, zs + 0.05, fm),
              arc_strip("head", 0, zs, r_in - fw, r_in, yf + 0.01, n, fm)]
    for i in range(1, 3):
        x = -r_in + (2 * r_in) * i / 3
        parts.append(bx(f"mull{i}", x - 0.03, x + 0.03, yf, rec, 0.45, zs - 0.05, fm))
    if lod == 0:
        for a in (math.pi / 3, math.pi / 2, 2 * math.pi / 3):
            parts.append(bar(f"fan{int(a*100)}", (0, yf + 0.03, zs), ((r_in - fw) * math.cos(a), yf + 0.03, zs + (r_in - fw) * math.sin(a)), 0.05, 0.05, fm))
        parts.append(bx("transomBar", -r_in + fw, r_in - fw, yf, rec, 2.8, 2.88, fm))
    return [finish(parts, "storefront_arcade")]

# ----------------------------------------------------------------------------------------------
# TRIMS (1 m along X)
# ----------------------------------------------------------------------------------------------
def cornice_heavy(lod=0):
    prof = [(0, 0), (-0.10, 0), (-0.10, 0.15), (-0.20, 0.25), (-0.20, 0.40), (-0.24, 0.40), (-0.24, 0.62),
            (-0.30, 0.62), (-0.45, 0.68), (-0.55, 0.82), (-0.60, 1.05), (-0.56, 1.20), (0, 1.20)]
    parts = [prism("cornice", prof, 'X', -0.5, 0.5, "limestone")]
    if lod == 0:
        for i in range(5):
            x = -0.5 + 0.1 + i * 0.2
            parts.append(bx(f"dentil{i}", x - 0.05, x + 0.05, -0.36, -0.24, 0.42, 0.58, "limestone"))
    return [finish(parts, "cornice_heavy")]

def cornice_medium(lod=0):
    prof = [(0, 0), (-0.08, 0), (-0.08, 0.12), (-0.16, 0.20), (-0.16, 0.32), (-0.26, 0.40), (-0.32, 0.52), (-0.30, 0.60), (0, 0.60)]
    parts = [prism("cornice", prof, 'X', -0.5, 0.5, "limestone")]
    if lod == 0:
        for i in range(4):
            x = -0.5 + 0.125 + i * 0.25
            parts.append(bx(f"block{i}", x - 0.05, x + 0.05, -0.24, -0.16, 0.21, 0.31, "limestone"))
    return [finish(parts, "cornice_medium")]

def stringcourse(lod=0):
    prof = [(0, 0), (-0.06, 0), (-0.06, 0.08), (-0.12, 0.14), (-0.14, 0.22), (-0.10, 0.25), (0, 0.25)]
    return [finish([prism("stringcourse", prof, 'X', -0.5, 0.5, "limestone")], "stringcourse")]

def parapet(lod=0):
    parts = [bx("wall", -0.5, 0.5, -0.10, 0.10, 0, 0.85, "limestone"),
             prism("coping", [(-0.15, 0.85), (0.15, 0.85), (0.15, 0.94), (0.0, 1.0), (-0.15, 0.94)], 'X', -0.5, 0.5, "limestone")]
    return [finish(parts, "parapet")]

def balustrade(lod=0):
    parts = [bx("plinth", -0.5, 0.5, -0.12, 0.12, 0, 0.10, "limestone"),
             bx("rail", -0.5, 0.5, -0.12, 0.12, 0.85, 1.0, "limestone")]
    balusters(parts, "limestone", [(-0.375, 0), (-0.125, 0), (0.125, 0), (0.375, 0)], lod=lod)
    return [finish(parts, "balustrade")]

def rustication(lod=0):
    parts = []
    for i in range(2):
        z0 = i * 0.5; z1 = z0 + 0.5
        b = 0.04; d = -0.08   # bevel width, block projection
        faces = [([(-0.5 + b, d, z0 + b), (0.5 - b, d, z0 + b), (0.5 - b, d, z1 - b), (-0.5 + b, d, z1 - b)], (0, -1, 0)),
                 ([(-0.5, 0, z0), (0.5, 0, z0), (0.5 - b, d, z0 + b), (-0.5 + b, d, z0 + b)], (0, -1, -1)),
                 ([(0.5, 0, z0), (0.5, 0, z1), (0.5 - b, d, z1 - b), (0.5 - b, d, z0 + b)], (1, -1, 0)),
                 ([(0.5, 0, z1), (-0.5, 0, z1), (-0.5 + b, d, z1 - b), (0.5 - b, d, z1 - b)], (0, -1, 1)),
                 ([(-0.5, 0, z1), (-0.5, 0, z0), (-0.5 + b, d, z0 + b), (-0.5 + b, d, z1 - b)], (-1, -1, 0))]
        parts.append(_faces_obj(f"block{i}", faces, "limestone"))
    return [finish(parts, "rustication")]

# ----------------------------------------------------------------------------------------------
# COLUMNS / PILASTERS / ORNAMENT
# ----------------------------------------------------------------------------------------------
def column_corinthian(dia=0.6, h=6.0, lod=0):
    r = dia / 2; parts = []
    parts.append(bx("plinth", -0.42, 0.42, -0.42, 0.42, 0, 0.10, "limestone"))
    if lod == 0:
        parts.append(revolve("base", [(0.40, 0.10), (0.40, 0.18), (0.36, 0.26), (0.32, 0.36), (0.31, 0.45)], "limestone", segments=16))
        parts.append(revolve("shaft", [(0.31, 0.45), (r, 0.50, True), (r * 0.98, 3.6, True), (r * 0.90, 5.05, True), (0.28, 5.10)],
                             "limestone", segments=48, flute_depth=0.06))
        parts.append(revolve("bell", [(0.28, 5.10), (0.30, 5.35), (0.36, 5.65), (0.42, 5.82)], "limestone", segments=16))
        for i in range(8):
            a = 2 * math.pi * i / 8 + math.pi / 8
            b0 = (0.30 * math.cos(a), 0.30 * math.sin(a), 5.15)
            b1 = (0.46 * math.cos(a), 0.46 * math.sin(a), 5.72)
            parts.append(bar(f"leaf{i}", b0, b1, 0.14, 0.05, "limestone"))
    else:
        parts.append(revolve("shaft", [(0.40, 0.10), (0.34, 0.40), (r, 0.50), (r * 0.9, 5.05), (0.42, 5.82)], "limestone", segments=12))
    parts.append(bx("abacus", -0.45, 0.45, -0.45, 0.45, 5.82, 6.0, "limestone"))
    return [finish(parts, "column_corinthian")]

def column_doric(dia=0.5, h=4.0, lod=0):
    r = dia / 2; parts = []
    parts.append(bx("plinth", -0.34, 0.34, -0.34, 0.34, 0, 0.08, "limestone"))
    if lod == 0:
        parts.append(revolve("base", [(0.32, 0.08), (0.30, 0.16), (0.26, 0.22)], "limestone", segments=16))
        parts.append(revolve("shaft", [(0.26, 0.22), (r, 0.26, True), (r * 0.97, 2.4, True), (r * 0.86, 3.55, True), (0.22, 3.60)],
                             "limestone", segments=40, flute_depth=0.06))
        parts.append(revolve("echinus", [(0.22, 3.60), (0.24, 3.66), (0.30, 3.76), (0.34, 3.85)], "limestone", segments=16))
    else:
        parts.append(revolve("shaft", [(0.32, 0.08), (r, 0.26), (r * 0.86, 3.55), (0.34, 3.85)], "limestone", segments=12))
    parts.append(bx("abacus", -0.36, 0.36, -0.36, 0.36, 3.85, 4.0, "limestone"))
    return [finish(parts, "column_doric")]

def pilaster_flat(w, h, proj=0.15, lod=0):
    parts = [bx("base", -w / 2 - 0.05, w / 2 + 0.05, -proj - 0.03, 0.0, 0, 0.35, "limestone"),
             bx("shaft", -w / 2, w / 2, -proj, 0.0, 0.35, h - 0.35, "limestone"),
             bx("neck", -w / 2 - 0.03, w / 2 + 0.03, -proj - 0.02, 0.0, h - 0.35, h - 0.22, "limestone"),
             bx("cap", -w / 2 - 0.08, w / 2 + 0.08, -proj - 0.06, 0.0, h - 0.22, h - 0.08, "limestone"),
             bx("abacus", -w / 2 - 0.10, w / 2 + 0.10, -proj - 0.08, 0.0, h - 0.08, h, "limestone")]
    if lod == 0 and h > 8:
        # giant order: three shallow flutes on the shaft face
        for i in range(3):
            x = -w / 2 + w * (i + 1) / 4
            parts.append(bx(f"flute{i}", x - 0.04, x + 0.04, -proj - 0.015, -proj + 0.01, 0.6, h - 0.6, "limestone"))
    return [finish(parts, "pilaster")]

def balcony_stone(w=2.4, depth=0.9, lod=0):
    m = "limestone"; parts = []
    parts.append(prism("slab", [(0, 0), (-depth + 0.3, 0), (-depth, 0.12), (-depth - 0.02, 0.22), (0, 0.22)], 'X', -w / 2, w / 2, m))
    zb = 0.22   # floor level
    pl = 0.12   # balustrade plinth/rail thickness
    # plinth + rail on 3 sides (front, left, right)
    for (name, x0, x1, y0, y1) in (("F", -w / 2, w / 2, -depth, -depth + pl), ("L", -w / 2, -w / 2 + pl, -depth, 0.0), ("R", w / 2 - pl, w / 2, -depth, 0.0)):
        parts.append(bx("plinth" + name, x0, x1, y0, y1, zb, zb + 0.10, m))
        parts.append(bx("rail" + name, x0, x1, y0, y1, zb + 0.85, zb + 1.0, m))
    for s in (-1, 1):
        parts.append(bx(f"post{s}", s * (w / 2 - 0.08) - 0.08, s * (w / 2 - 0.08) + 0.08, -depth + 0.0, -depth + 0.16, zb, zb + 1.0, m))
    if lod == 0:
        pts = [(-w / 2 + 0.3 + i * (w - 0.6) / 7, -depth + pl / 2) for i in range(8)]
        pts += [(s * (w / 2 - pl / 2), -depth + 0.35 - j * 0.25) for s in (-1, 1) for j in range(2)]
        # balusters sit on the plinth at zb: shift by building them at z offset via a temporary list
        tmp = []
        balusters(tmp, m, pts, lod=0)
        for o in tmp:
            o.location.z += zb
        parts += tmp
    else:
        parts.append(bx("panelF", -w / 2, w / 2, -depth + 0.02, -depth + pl - 0.02, zb + 0.1, zb + 0.85, m))
        parts.append(bx("panelL", -w / 2 + 0.02, -w / 2 + pl - 0.02, -depth, 0.0, zb + 0.1, zb + 0.85, m))
        parts.append(bx("panelR", w / 2 - pl + 0.02, w / 2 - 0.02, -depth, 0.0, zb + 0.1, zb + 0.85, m))
    return [finish(parts, "balcony_stone")]

def balcony_iron(w=2.4, depth=0.6, lod=0):
    m = "iron_painted"; parts = []
    parts.append(bx("platform", -w / 2, w / 2, -depth, 0.0, 0, 0.05, m))
    parts.append(bx("edge", -w / 2, w / 2, -depth - 0.02, -depth + 0.03, 0, 0.12, m))
    h = 1.0; t = 0.03
    for (name, x0, x1, y0, y1) in (("F", -w / 2, w / 2, -depth, -depth + t), ("L", -w / 2, -w / 2 + t, -depth, 0.0), ("R", w / 2 - t, w / 2, -depth, 0.0)):
        parts.append(bx("top" + name, x0, x1, y0, y1, h - t, h, m))
        if lod == 0:
            parts.append(bx("mid" + name, x0, x1, y0, y1, 0.45, 0.45 + 0.02, m))
    step = 0.15 if lod == 0 else 0.3
    n = int(round(w / step))
    for i in range(n + 1):
        x = -w / 2 + i * w / n
        parts.append(bx(f"barF{i}", x - 0.012, x + 0.012, -depth + 0.004, -depth + t - 0.004, 0.05, h - t, m))
    ns = int(round(depth / step))
    for s, tag in ((-1, "L"), (1, "R")):
        for j in range(1, ns + 1):
            y = -depth + j * depth / ns
            parts.append(bx(f"bar{tag}{j}", s * (w / 2 - t / 2) - 0.012, s * (w / 2 - t / 2) + 0.012, y - 0.012, y + 0.012, 0.05, h - t, m))
    return [finish(parts, "balcony_iron")]

def fire_escape(w=2.4, storey=3.6, depth=0.9, lod=0):
    m = "iron_painted"; parts = []
    parts.append(bx("platform", -w / 2, w / 2, -depth, 0.0, 0, 0.06, m))
    parts.append(bx("edge", -w / 2, w / 2, -depth - 0.02, -depth + 0.04, 0, 0.14, m))
    h = 1.0; t = 0.04
    # railings on front + left side (stair leaves from the right side)
    for (name, x0, x1, y0, y1) in (("F", -w / 2, w / 2, -depth, -depth + t), ("L", -w / 2, -w / 2 + t, -depth, 0.0)):
        parts.append(bx("top" + name, x0, x1, y0, y1, h - t, h, m))
        if lod == 0:
            parts.append(bx("mid" + name, x0, x1, y0, y1, 0.5, 0.53, m))
    for i in range(0, 7 if lod == 0 else 4):
        x = -w / 2 + i * w / (6 if lod == 0 else 3)
        parts.append(bx(f"postF{i}", x - 0.02, x + 0.02, -depth, -depth + t, 0.06, h - t, m))
    parts.append(bx("postL", -w / 2, -w / 2 + t, -0.04, 0.0, 0.06, h - t, m))
    # stair run: from the right end of the platform (x=+w/2-0.4, z=0.06) up to (x=-w/2+0.5, z=storey) along the wall-side edge
    sx0, sx1 = w / 2 - 0.3, -w / 2 + 0.4
    sz0, sz1 = 0.06, storey
    ny = -0.55, -0.10   # stair strip in y
    steps = 12 if lod == 0 else 6
    for k in range(steps):
        f0 = k / steps; f1 = (k + 1) / steps
        x = sx0 + (sx1 - sx0) * f0; xn = sx0 + (sx1 - sx0) * f1
        z = sz0 + (sz1 - sz0) * f1
        parts.append(bx(f"tread{k}", min(x, xn), max(x, xn), ny[0], ny[1], z - 0.03, z, m))
    for yy in ny:
        parts.append(bar(f"stringer{yy}", (sx0, yy, sz0), (sx1, yy, sz1), 0.04, 0.16, m))
    parts.append(bar("stairRail", (sx0, ny[0] - 0.02, sz0 + 0.9), (sx1, ny[0] - 0.02, sz1 + 0.9), 0.04, 0.04, m))
    for k in range(0, 4):
        f = k / 3
        x = sx0 + (sx1 - sx0) * f; z = sz0 + (sz1 - sz0) * f
        parts.append(bx(f"srpost{k}", x - 0.02, x + 0.02, ny[0] - 0.04, ny[0], z, z + 0.9, m))
    # wall brackets carrying the platform
    for s in (-1, 1):
        parts.append(bar(f"wallbrk{s}", (s * (w / 2 - 0.2), -depth + 0.15, 0.06), (s * (w / 2 - 0.2), 0.0, 0.6), 0.05, 0.05, m))
    return [finish(parts, "fire_escape")]

def flagpole_facade(L=4.0, lod=0):
    d = Vector((0, -1, 1)).normalized()
    base = Vector((0, 0, 0.15))
    tip = base + d * L
    pole = [bx("bracket", -0.12, 0.12, -0.05, 0.0, 0.0, 0.3, "metal_black"),
            rod("pole", tuple(base), tuple(tip), 0.03, "metal_alu", seg=8),
            sphere("finial", 0.07, tuple(tip + d * 0.05), "brass", segments=8)]
    pole_obj = finish(pole, "pole")
    # flag: hoist along the pole (from 2.4 to 3.9 m), hanging 1.0 m down
    p0 = base + d * 2.4; p1 = base + d * 3.9
    flag = grid_mesh("flag", tuple(p0), tuple(p1 - p0), (0.05, -0.02, -1.0), 6, 4, "fabric_red", (1, 0, 0))
    flag_obj = finish([flag], "flag")
    return [pole_obj, flag_obj]

def awning_fabric(w=3.0, proj=1.2, fabric="fabric_red", lod=0):
    z_front, z_wall = 0.30, 0.80; val = 0.30; parts = []
    parts.append(grid_mesh("sheet", (-w / 2, -proj, z_front), (w, 0, 0), (0, proj, z_wall - z_front), 3 if lod == 0 else 1, 1, fabric, (0, -1, 1)))
    parts.append(vquad("valance", -w / 2, w / 2, z_front - val, z_front, -proj, fabric))
    for s, fac in ((-1, -1), (1, 1)):
        x = s * w / 2
        parts.append(_faces_obj(f"side{s}", [([(x, 0, z_wall), (x, -proj, z_front), (x, -proj, z_front - val), (x, 0, z_front - val)], (fac, 0, 0))], fabric))
    fm = "metal_black"
    parts.append(bx("frontbar", -w / 2, w / 2, -proj - 0.02, -proj + 0.02, z_front - 0.02, z_front + 0.02, fm))
    for s in (-1, 1):
        parts.append(bar(f"arm{s}", (s * (w / 2 - 0.02), 0.0, z_wall), (s * (w / 2 - 0.02), -proj, z_front), 0.03, 0.03, fm))
        parts.append(bar(f"strut{s}", (s * (w / 2 - 0.02), 0.0, z_front - val), (s * (w / 2 - 0.02), -proj, z_front), 0.025, 0.025, fm))
    return [finish(parts, "awning")]

def canopy_metal(w=4.0, depth=2.0, lod=0):
    fm = "metal_black"; parts = []
    parts.append(bx("glass", -w / 2 + 0.05, w / 2 - 0.05, -depth + 0.05, 0.0, 0.12, 0.14, "glass_tint"))
    parts += [bx("beamL", -w / 2, -w / 2 + 0.08, -depth, 0.0, 0, 0.16, fm),
              bx("beamR", w / 2 - 0.08, w / 2, -depth, 0.0, 0, 0.16, fm),
              bx("beamF", -w / 2 + 0.08, w / 2 - 0.08, -depth, -depth + 0.06, 0, 0.16, fm),
              bx("beamB", -w / 2 + 0.08, w / 2 - 0.08, -0.08, 0.0, 0, 0.16, fm)]
    for s in (-1, 1):
        parts.append(rod(f"rod{s}", (s * (w / 2 - 0.04), -depth + 0.1, 0.16), (s * (w / 2 - 0.04), 0.0, 1.5), 0.02, fm, seg=6))
        parts.append(bx(f"plate{s}", s * (w / 2 - 0.04) - 0.08, s * (w / 2 - 0.04) + 0.08, -0.03, 0.0, 1.42, 1.58, fm))
    return [finish(parts, "canopy_metal")]

def roof_penthouse(w=6.0, d=4.0, h=3.0, lod=0):
    parts = [bx("body", -w / 2, w / 2, -d / 2, d / 2, 0, h, "concrete"),
             bx("cap", -w / 2 - 0.1, w / 2 + 0.1, -d / 2 - 0.1, d / 2 + 0.1, h - 0.15, h, "concrete_dark"),
             bx("door", -2.4, -1.5, -d / 2 - 0.05, -d / 2 + 0.01, 0, 2.1, "metal_alu"),
             bx("louvreFrame", 0.2, 2.6, -d / 2 - 0.04, -d / 2 + 0.01, 0.8, 2.4, "metal_alu")]
    if lod == 0:
        for i in range(8):
            z = 0.9 + i * 0.18
            parts.append(box(f"slat{i}", (2.3, 0.02, 0.14), (1.4, -d / 2 - 0.06, z), "metal_alu", rotation=(math.radians(35), 0, 0)))
        parts.append(cylinder("vent", 0.3, 0.9, (1.8, 0.8, h + 0.45), "metal_alu", segments=8))
        parts.append(cylinder("ventcap", 0.4, 0.1, (1.8, 0.8, h + 0.95), "metal_alu", segments=8))
    else:
        parts.append(bx("louvres", 0.25, 2.55, -d / 2 - 0.07, -d / 2 - 0.04, 0.85, 2.35, "metal_alu"))
    return [finish(parts, "roof_penthouse")]

def roof_watertank(dia=3.0, h=5.0, lod=0):
    r = dia / 2; seg = 16 if lod == 0 else 8; parts = []
    z_plat = 2.2
    # steel frame: 4 legs + platform ring + X braces
    lx = r * 0.62
    for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        parts.append(rod(f"leg{i}", (sx * lx, sy * lx, 0), (sx * lx, sy * lx, z_plat), 0.06, "steel", seg=6))
    parts.append(bx("platform", -lx - 0.15, lx + 0.15, -lx - 0.15, lx + 0.15, z_plat, z_plat + 0.12, "steel"))
    if lod == 0:
        for (a, b) in (((-lx, -lx), (lx, -lx)), ((lx, -lx), (lx, lx)), ((lx, lx), (-lx, lx)), ((-lx, lx), (-lx, -lx))):
            parts.append(bar(f"brace{a}{b}a", (a[0], a[1], 0.2), (b[0], b[1], z_plat - 0.2), 0.04, 0.04, "steel"))
            parts.append(bar(f"brace{a}{b}b", (a[0], a[1], z_plat - 0.2), (b[0], b[1], 0.2), 0.04, 0.04, "steel"))
    z_t0 = z_plat + 0.12; z_t1 = h - 0.55
    parts.append(revolve("tank", [(r * 0.97, z_t0), (r, z_t0 + 0.05), (r, z_t1), (r + 0.06, z_t1), (0.06, h)], "wood_dark", segments=seg))
    if lod == 0:
        for i, z in enumerate((z_t0 + 0.3, z_t0 + 1.1, z_t1 - 0.3)):
            parts.append(cylinder(f"hoop{i}", r + 0.03, 0.05, (0, 0, z), "steel", segments=seg))
    return [finish(parts, "roof_watertank")]

def mansard(length=1.0, rise=2.5, depth=2.0, dormer=False, lod=0):
    m = "granite_dark"; parts = []
    back = 0.9
    parts.append(prism("roof", [(0, 0), (back, rise), (depth, rise), (depth, 0)], 'X', -length / 2, length / 2, m))
    parts.append(bx("eave", -length / 2, length / 2, -0.12, 0.05, 0, 0.12, "limestone"))
    if dormer:
        dw, z0, z1 = 0.9, 0.7, 1.9
        yf = 0.05
        parts.append(bx("dormerBody", -dw / 2, dw / 2, yf, back * (z1 / rise) + 0.35, z0 - 0.15, z1 + 0.1, "limestone"))
        parts.append(prism("dormerRoof", [(-dw / 2 - 0.08, z1 + 0.1), (dw / 2 + 0.08, z1 + 0.1), (0, z1 + 0.5)], 'Y', yf - 0.08, back * ((z1 + 0.5) / rise) + 0.3, m))
        parts.append(reveal("dreveal", -dw / 2 + 0.1, dw / 2 - 0.1, z0, z1, yf, yf + 0.12, "limestone"))
        dh_sash(parts, -dw / 2 + 0.1, dw / 2 - 0.1, z0, z1, yf + 0.08, lod=lod, fw=0.05, fd=0.03)
        parts.append(bx("dsill", -dw / 2 + 0.05, dw / 2 - 0.05, yf - 0.06, yf, z0 - 0.06, z0, "limestone"))
    return [finish(parts, "mansard")]

def sign_fascia(w=3.0, h=0.8, d=0.1, lod=0):
    parts = [bx("box", -w / 2, w / 2, -d, 0.0, 0, h, "plastic_black"),
             vquad("screen", -w / 2 + 0.05, w / 2 - 0.05, 0.05, h - 0.05, -d - 0.002, "screen")]
    return [finish(parts, "sign_fascia")]

def sign_blade(L=1.0, h=0.6, lod=0):
    t = 0.08; y0, y1 = -0.15, -0.15 - L; fm = "metal_black"; parts = []
    parts.append(bx("panel", -t / 2, t / 2, y1, y0, 0, h, fm))
    parts.append(vquad_yz("screenR", y1 + 0.03, y0 - 0.03, 0.03, h - 0.03, t / 2 + 0.002, "screen", facing=1))
    parts.append(vquad_yz("screenL", y1 + 0.03, y0 - 0.03, 0.03, h - 0.03, -t / 2 - 0.002, "screen", facing=-1))
    parts.append(bx("arm", -0.02, 0.02, y1 + 0.1, 0.0, h + 0.02, h + 0.06, fm))
    parts.append(bx("plate", -0.08, 0.08, -0.02, 0.0, h - 0.25, h + 0.15, fm))
    if lod == 0:
        parts.append(bar("strut", (0, -0.02, h - 0.2), (0, y1 + 0.15, h + 0.02), 0.02, 0.02, fm))
        parts.append(bx("hang", -0.015, 0.015, y1 + 0.5 - 0.015, y1 + 0.5 + 0.015, h, h + 0.02, fm))
    return [finish(parts, "sign_blade")]

def sign_corner_wrap(L=1.2, h=0.8, d=0.1, lod=0):
    """L-shaped box wrapping a convex corner at the origin; building occupies x<0, y>0 (Blender).
    Arm A runs along -X in front of the wall y=0 (screen faces -Y); arm B runs along +Y in front of the wall x=0 (screen faces +X)."""
    parts = [bx("armA", -L, d, -d, 0.0, 0, h, "plastic_black"),
             bx("armB", 0.0, d, 0.0, L, 0, h, "plastic_black"),
             vquad("screenA", -L + 0.04, d - 0.04, 0.04, h - 0.04, -d - 0.002, "screen", facing=-1),
             vquad_yz("screenB", -d + 0.04, L - 0.04, 0.04, h - 0.04, d + 0.002, "screen", facing=1),
             # L-shaped top cap in two pieces
             bx("capA", -L - 0.02, d + 0.02, -d - 0.02, 0.02, h, h + 0.03, "metal_black"),
             bx("capB", -0.02, d + 0.02, 0.02, L + 0.02, h, h + 0.03, "metal_black")]
    return [finish(parts, "sign_corner")]

def window_ac_unit(lod=0):
    parts = [bx("body", -0.3, 0.3, -0.45, 0.0, 0.0, 0.40, "plastic_grey"),
             vquad("grille", -0.27, 0.27, 0.04, 0.36, -0.452, "plastic_black"),
             bx("bracket", -0.25, 0.25, -0.40, 0.0, -0.0, 0.03, "metal_alu")]
    if lod == 0:
        parts.append(bx("lipL", -0.3, -0.28, -0.46, -0.45, 0.0, 0.4, "plastic_grey"))
        parts.append(bx("lipR", 0.28, 0.3, -0.46, -0.45, 0.0, 0.4, "plastic_grey"))
    return [finish(parts, "window_ac")]

# ----------------------------------------------------------------------------------------------
# asset table
# ----------------------------------------------------------------------------------------------
def M(kind, **kw):
    d = {"kind": kind}; d.update(kw); return d

ASSETS = [
    ("win_dh_stone_1.2x2.2",        lambda lod: win_dh_stone(1.2, 2.2, lod=lod),                 M("window", opening=[1.2, 2.2], opening_z=SILL_H)),
    ("win_dh_stone_1.5x2.6",        lambda lod: win_dh_stone(1.5, 2.6, keystone=True, lod=lod),  M("window", opening=[1.5, 2.6], opening_z=SILL_H)),
    ("win_arch_stone_1.5x3.0",      lambda lod: win_arch_stone(1.5, 3.0, lod=lod),               M("window", opening=[1.5, 3.0], opening_z=SILL_H)),
    ("win_pair_stone_2.4x2.4",      lambda lod: win_pair_stone(2.4, 2.4, lod=lod),               M("window", opening=[2.4, 2.4], opening_z=SILL_H)),
    ("win_punched_modern_1.8x2.0",  lambda lod: win_punched_modern(1.8, 2.0, lod=lod),           M("window", opening=[1.8, 2.0], opening_z=0.0)),
    ("win_office_strip_3.0x1.8",    lambda lod: win_office_strip(3.0, 1.8, lod=lod),             M("window", opening=[3.0, 1.8], opening_z=0.0)),
    ("win_curtain_3.0x3.6",         lambda lod: win_curtain(3.0, 3.6, lod=lod),                  M("window", opening=[3.0, 3.6], opening_z=0.0, spandrel=0.9)),
    ("win_bay_oriel_2.4x3.0",       lambda lod: win_bay_oriel(2.4, 3.0, lod=lod),                M("window", opening=[2.4, 3.0], opening_z=1.0)),
    ("storefront_bay_3.0x4.5",      lambda lod: storefront_bay(3.0, 4.5, 3.2, lights=1, lod=lod), M("storefront", opening=[3.0, 4.5], opening_z=0.0)),
    ("storefront_bay_4.0x5.0",      lambda lod: storefront_bay(4.0, 5.0, 3.5, lights=2, lod=lod), M("storefront", opening=[4.0, 5.0], opening_z=0.0)),
    ("storefront_door_double_2.0x2.8", lambda lod: storefront_door_double(lod=lod),              M("door", opening=[2.0, 2.8], opening_z=0.0, bay=[3.0, 3.2])),
    ("storefront_door_recessed_3.0x4.5", lambda lod: storefront_door_recessed(lod=lod),          M("door", opening=[3.0, 4.5], opening_z=0.0, recess=1.5)),
    ("door_revolving_2.4",          lambda lod: door_revolving(lod=lod),                         M("door", opening=[2.4, 2.6], opening_z=0.0, note="drum centred on the wall plane")),
    ("door_hotel_marquee_6.0",      lambda lod: door_hotel_marquee(lod=lod),                     M("marquee", opening=[6.0, 3.9], opening_z=0.0, canopy_z=4.0)),
    ("storefront_luxury_4.0x5.0",   lambda lod: storefront_luxury(lod=lod),                      M("storefront", opening=[4.0, 5.0], opening_z=0.0, fascia=[4.2, 5.0])),
    ("storefront_arcade_arch_4.0x5.5", lambda lod: storefront_arcade_arch(lod=lod),              M("storefront", opening=[4.0, 5.5], opening_z=0.0, arch_spring_z=3.5)),
    ("cornice_heavy_1m",            lambda lod: cornice_heavy(lod),                              M("trim")),
    ("cornice_medium_1m",           lambda lod: cornice_medium(lod),                             M("trim")),
    ("stringcourse_1m",             lambda lod: stringcourse(lod),                               M("trim")),
    ("parapet_1m",                  lambda lod: parapet(lod),                                    M("trim", note="sits on the wall top, projects 0.1 both ways")),
    ("balustrade_1m",               lambda lod: balustrade(lod),                                 M("trim")),
    ("rustication_1m",              lambda lod: rustication(lod),                                M("trim", note="tile in x and z; 2 courses of 0.5 m")),
    ("column_corinthian_6m",        lambda lod: column_corinthian(lod=lod),                      M("column", diameter=0.6)),
    ("column_doric_4m",             lambda lod: column_doric(lod=lod),                           M("column", diameter=0.5)),
    ("pilaster_flat_0.6x4m",        lambda lod: pilaster_flat(0.6, 4.0, lod=lod),                M("pilaster")),
    ("pilaster_flat_0.8x12m",       lambda lod: pilaster_flat(0.8, 12.0, proj=0.2, lod=lod),     M("pilaster")),
    ("balcony_stone_2.4m",          lambda lod: balcony_stone(lod=lod),                          M("balcony", floor_z=0.22)),
    ("balcony_iron_2.4m",           lambda lod: balcony_iron(lod=lod),                           M("balcony", floor_z=0.05)),
    ("fire_escape_module_2.4x3.6",  lambda lod: fire_escape(lod=lod),                            M("fire_escape", storey=3.6, floor_z=0.06)),
    ("flagpole_facade_4m",          lambda lod: flagpole_facade(lod=lod),                        M("flagpole", note="objects: pole, flag")),
    ("awning_fabric_3m",            lambda lod: awning_fabric(fabric="fabric_red", lod=lod),     M("canopy", note="valance bottom at z=0; mount at ~2.3 m")),
    ("awning_fabric_3m_black",      lambda lod: awning_fabric(fabric="fabric_black", lod=lod),   M("canopy", note="valance bottom at z=0; mount at ~2.3 m")),
    ("awning_fabric_3m_green",      lambda lod: awning_fabric(fabric="fabric_green", lod=lod),   M("canopy", note="valance bottom at z=0; mount at ~2.3 m")),
    ("canopy_metal_4m",             lambda lod: canopy_metal(lod=lod),                           M("canopy", note="frame bottom at z=0; tie rods rise 1.5 m")),
    ("roof_penthouse_6x4x3",        lambda lod: roof_penthouse(lod=lod),                         M("roof", note="centred on x and y")),
    ("roof_watertank",              lambda lod: roof_watertank(lod=lod),                         M("roof", note="centred on x and y")),
    ("mansard_1m",                  lambda lod: mansard(1.0, lod=lod),                           M("roof", note="slope rises back into +Y (building interior)")),
    ("mansard_dormer_1.5m",         lambda lod: mansard(1.5, dormer=True, lod=lod),              M("roof", note="slope rises back into +Y; dormer faces -Y")),
    ("sign_fascia_blank_3x0.8",     lambda lod: sign_fascia(lod=lod),                            M("sign", screen="front")),
    ("sign_blade_1.0x0.6",          lambda lod: sign_blade(lod=lod),                             M("sign", screen="both sides (+X/-X)")),
    ("sign_corner_wrap",            lambda lod: sign_corner_wrap(lod=lod),                       M("sign", screen="arm A faces -Y, arm B faces +X", note="building occupies x<0,y>0 (Blender) = x<0,z<0 (three.js); corner at origin")),
    ("window_ac_unit",              lambda lod: window_ac_unit(lod=lod),                         M("prop")),
]

def budget_for(name, kind):
    if name.startswith("fire_escape"): return BUDGET["fire_escape"]
    if kind == "marquee": return BUDGET["marquee"]
    return BUDGET.get(kind, DEFAULT_BUDGET)

def main():
    t0 = time.time()
    reset_scene()
    rows = []; failures = []
    for name, builder, meta in ASSETS:
        clear_objects()
        objs = builder(0)
        (x0, x1), (y0, y1), (z0, z1) = bbox(objs)
        full_meta = dict(meta)
        full_meta.update({"width": round(x1 - x0, 4), "height": round(z1 - z0, 4), "depth": round(y1 - y0, 4)})
        tris = tri_count(objs)
        export_glb(objs, f"arch/{name}", full_meta)
        lim = budget_for(name, meta["kind"])
        ok = tris <= lim
        # origin sanity: base at z=0 and x centred (except the corner sign, which is corner-anchored)
        origin_ok = abs(z0) < 1e-3 and (name == "sign_corner_wrap" or abs(x0 + x1) < 1e-3)
        lod_tris = ""
        if tris > LOD_THRESHOLD:
            clear_objects()
            objs1 = builder(1)
            lt = tri_count(objs1)
            lm = dict(full_meta); lm["lod"] = 1
            export_glb(objs1, f"arch/{name}_lod1", lm)
            lod_tris = str(lt)
        rows.append((name, meta["kind"], tris, lim, lod_tris, f"{x1-x0:.2f}x{z1-z0:.2f}x{y1-y0:.2f}", "" if ok else "OVER BUDGET", "" if origin_ok else "ORIGIN?"))
        if not ok: failures.append(f"{name}: {tris} > {lim}")
        if not origin_ok: failures.append(f"{name}: origin/bbox off (x {x0:.3f}..{x1:.3f}, z0 {z0:.3f})")
    write_manifest("arch")
    print()
    print(f"{'asset':36} {'kind':11} {'tris':>5} {'lim':>5} {'lod1':>5}  {'W x H x D':16} flags")
    for r in rows:
        print(f"{r[0]:36} {r[1]:11} {r[2]:5d} {r[3]:5d} {r[4]:>5}  {r[5]:16} {r[6]} {r[7]}")
    print(f"\n{len(rows)} assets, {sum(r[2] for r in rows)} tris total, {time.time()-t0:.1f}s")
    if failures:
        print("FAILURES:\n  " + "\n  ".join(failures))
        sys.exit(1)

if __name__ == "__main__":
    main()
