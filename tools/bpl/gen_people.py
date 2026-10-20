"""
gen_people.py — low-poly pedestrian body parts + hand props for the procedural (no-skinning) crowd system.
Run:  tools/bpl/.venv/bin/python tools/bpl/gen_people.py

The runtime animates pedestrians by placing each body part as a separate instance, so every part is built
with its ORIGIN AT THE JOINT IT ROTATES ABOUT (no set_origin_bottom_center here — the geometry is built
directly in place):
  * limbs (upper/lower arm & leg) hang DOWN from their joint:            z in [-length, 0]
  * pelvis hangs from the torso base (origin at its top centre):          z in [-0.18, 0]
  * torso stands UP from the pelvis origin, head sits UP on the neck:     z in [0, length]
  * props: backpack hangs from its attachment point on the back (+Y side), handbag from the handle top,
    umbrella / phone / camera / cup stand on their bottom (grip) point.
Front faces -Y (Blender).  Units: metres (adult).  Materials: MATERIAL_LIBRARY names only (the runtime
recolours by name).  Budget: < 250 tris per part.  Meta: {"kind","length","bbox"} (bbox in Blender coords).
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
from bpl_lib import *

TAU = 2 * math.pi
BUDGET = 250
HEAD_BUDGET = 340
RESULTS = []


# ----------------------------------------------------------------------------- part builder
class PB:
    """One bmesh with a UV layer and several material slots (face.material_index) -> build(name)."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.mats = []

    def slot(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def _face(self, verts, uvs, mi, smooth):
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        for l, uv in zip(f.loops, uvs):
            l[self.uv].uv = uv
        f.material_index = mi
        f.smooth = smooth
        return f

    def loft(self, rings, material, closed=True, cap_bottom=False, cap_top=False, smooth=True, outward=None):
        """Connect consecutive rings (lists of points) with quads; a 1-point ring is an apex (fan).
        Closed manifold pieces get consistent outward normals via recalc; open strips are oriented so
        their normals point away from `outward` (a reference point)."""
        mi = self.slot(material)
        verts = [[self.bm.verts.new(Vector(p)) for p in ring] for ring in rings]
        faces, m = [], len(rings)
        for i in range(m - 1):
            a, b = verts[i], verts[i + 1]
            ta, tb = i / (m - 1), (i + 1) / (m - 1)
            if len(a) == 1 or len(b) == 1:
                apex, ring, apex_above = (a[0], b, False) if len(a) == 1 else (b[0], a, True)
                n = len(ring)
                for j in range(n if closed else n - 1):
                    k = (j + 1) % n
                    sa, sb = j / n, (j + 1) / n
                    if apex_above:
                        faces.append(self._face([ring[j], ring[k], apex], [(sa, ta), (sb, ta), (sa, tb)], mi, smooth))
                    else:
                        faces.append(self._face([apex, ring[k], ring[j]], [(sa, ta), (sb, tb), (sa, tb)], mi, smooth))
                continue
            n = len(a)
            for j in range(n if closed else n - 1):
                k = (j + 1) % n
                sa, sb = (j / n, (j + 1) / n) if closed else (j / (n - 1), (j + 1) / (n - 1))
                faces.append(self._face([a[j], a[k], b[k], b[j]], [(sa, ta), (sb, ta), (sb, tb), (sa, tb)], mi, smooth))
        if cap_bottom and len(verts[0]) > 2:
            vs = list(reversed(verts[0]))
            faces.append(self._face(vs, [(v.co.x + .5, v.co.y + .5) for v in vs], mi, False))
        if cap_top and len(verts[-1]) > 2:
            vs = list(verts[-1])
            faces.append(self._face(vs, [(v.co.x + .5, v.co.y + .5) for v in vs], mi, False))
        faces = [f for f in faces if f is not None]
        if outward is None:
            bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        else:
            self.bm.normal_update()
            ref = Vector(outward)
            for f in faces:
                if f.normal.dot(f.calc_center_median() - ref) < 0:
                    f.normal_flip()
        return faces

    def lathe(self, profile, material, seg=10, center=(0, 0, 0), sx=1.0, sy=1.0, caps=(True, True), smooth=True):
        """Revolve (r, z) points around Z at `center`; r == 0 -> apex. Ellipse scale sx/sy for heads/hands."""
        c = Vector(center)
        rings = []
        for (r, z) in profile:
            if r < 1e-6:
                rings.append([c + Vector((0, 0, z))])
            else:
                rings.append([c + Vector((r * sx * math.cos(TAU * j / seg), r * sy * math.sin(TAU * j / seg), z))
                              for j in range(seg)])
        return self.loft(rings, material, cap_bottom=caps[0] and profile[0][0] > 1e-6,
                         cap_top=caps[1] and profile[-1][0] > 1e-6, smooth=smooth)

    def box(self, size, center, material, front=None):
        """Axis-aligned box (flat shaded); `front` = material for the -Y face (e.g. a phone screen)."""
        mi, mf = self.slot(material), (self.slot(front) if front else None)
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        cx, cy, cz = center
        P = lambda sx, sy, sz: self.bm.verts.new((cx + sx * hx, cy + sy * hy, cz + sz * hz))
        v = {(sx, sy, sz): P(sx, sy, sz) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)}
        quads = [((-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1)),   # bottom
                 ((-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)),       # top
                 ((-1, -1, -1), (1, -1, -1), (1, -1, 1), (-1, -1, 1)),   # front (-Y)
                 ((-1, 1, -1), (-1, 1, 1), (1, 1, 1), (1, 1, -1)),       # back
                 ((-1, -1, -1), (-1, -1, 1), (-1, 1, 1), (-1, 1, -1)),   # left
                 ((1, -1, -1), (1, 1, -1), (1, 1, 1), (1, -1, 1))]       # right
        uv = ((0, 0), (1, 0), (1, 1), (0, 1))
        faces = [self._face([v[k] for k in q], uv, mf if (i == 2 and mf is not None) else mi, False)
                 for i, q in enumerate(quads)]
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        return faces

    def tube(self, points, r, material, seg=4, smooth=False):
        """Square/round tube along a polyline (handles, hooks); capped ends."""
        pts = [Vector(p) for p in points]
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            helper = Vector((0, 1, 0)) if abs(t.y) < 0.9 else Vector((1, 0, 0))
            u = t.cross(helper).normalized(); w = t.cross(u).normalized()
            rings.append([p + (u * math.cos(TAU * (j + .5) / seg) + w * math.sin(TAU * (j + .5) / seg)) * r
                          for j in range(seg)])
        return self.loft(rings, material, cap_bottom=True, cap_top=True, smooth=smooth)

    def build(self, name):
        self.bm.normal_update()
        obj = mesh_from_bmesh(self.bm, name, self.mats[0])
        for m in self.mats[1:]:
            obj.data.materials.append(mat(m))
        return obj


def rr(hx, hy, z, n=12, p=2.6, cy=0.0):
    """Rounded-rectangle (superellipse) ring of n points at height z, centred on (0, cy)."""
    out = []
    for i in range(n):
        a = TAU * (i + 0.5) / n
        c, s = math.cos(a), math.sin(a)
        out.append(Vector((hx * math.copysign(abs(c) ** (2 / p), c), cy + hy * math.copysign(abs(s) ** (2 / p), s), z)))
    return out


def circ(cy, r, n, z_or_y, axis='z'):
    """Circle ring: axis 'z' -> horizontal ring at height z; axis 'y' -> vertical ring (for a camera lens)."""
    if axis == 'z':
        return [Vector((r * math.cos(TAU * j / n), cy + r * math.sin(TAU * j / n), z_or_y)) for j in range(n)]
    return [Vector((r * math.cos(TAU * j / n), z_or_y, cy + r * math.sin(TAU * j / n))) for j in range(n)]


# ----------------------------------------------------------------------------- body parts
def head(name, hair="cap", hat=False):
    pb = PB()
    SY = 1.12  # heads are deeper (Y) than wide (X)
    pb.lathe([(0.03, 0), (0.062, 0.025), (0.078, 0.09), (0.075, 0.17), (0.048, 0.222), (0, 0.236)], "skin", seg=10, sy=SY)
    if hair == "cap":
        pb.lathe([(0.082, 0.125), (0.083, 0.16), (0.068, 0.207), (0.036, 0.235), (0, 0.242)], "wood_dark",
                 seg=10, center=(0, 0.012, 0), sy=SY)
    elif hair == "long":
        pb.lathe([(0.082, 0.125), (0.083, 0.16), (0.068, 0.207), (0.036, 0.235), (0, 0.242)], "wood_dark",
                 seg=10, center=(0, 0.012, 0), sy=SY)
        # hanging hair sheet over the back and sides (angles with y>0 = back of the head), 2-sided
        angs = [-0.35 + (math.pi + 0.7) * j / 8 for j in range(9)]
        def strip(rz, cy):
            return [[Vector((r * math.cos(a), cy + r * SY * math.sin(a), z)) for a in angs] for (r, z) in rz]
        pb.loft(strip([(0.086, 0.135), (0.089, 0.0), (0.083, -0.15)], 0.012), "wood_dark", closed=False,
                outward=(0, 0.012, 0.0))
        pb.loft(strip([(0.074, 0.135), (0.072, -0.15)], 0.012), "wood_dark", closed=False, outward=(0, 0.012, 0.0))
        for f in pb.bm.faces[-16:]:
            f.normal_flip()  # inner sheet faces inward
    elif hair == "band":  # hair fringe visible under a cap
        pb.lathe([(0.082, 0.118), (0.085, 0.145)], "wood_dark", seg=10, center=(0, 0.012, 0), sy=SY, caps=(False, False))
    if hat:  # baseball cap: dome + brim forward (-Y)
        pb.lathe([(0.088, 0.14), (0.081, 0.185), (0.052, 0.225), (0, 0.248)], "paint_blue", seg=10,
                 center=(0, 0.006, 0), sy=1.1)
        pb.box((0.13, 0.085, 0.008), (0, -0.125, 0.145), "paint_blue")
    # Small silhouette and facial cues survive at conversational distance without a texture or another rig.
    for side in (-1, 1):
        pb.box((0.025, 0.018, 0.047), (side * 0.087, 0.005, 0.116), "skin")  # ears
        pb.box((0.014, 0.006, 0.009), (side * 0.031, -0.088, 0.145), "plastic_black")  # eyes
        pb.box((0.028, 0.006, 0.005), (side * 0.031, -0.085, 0.165), "plastic_black")  # brows
    pb.box((0.023, 0.034, 0.038), (0, -0.094, 0.106), "skin")  # nose
    pb.box((0.032, 0.006, 0.004), (0, -0.083, 0.066), "plastic_black")  # mouth
    return pb.build(name)


def torso(name, cloth, skirt=None, pad=0.0):
    """Torso standing up from the pelvis origin; shoulders 0.42 wide, 0.24 deep, 0.32 waist, + 0.05 neck stub."""
    pb = PB()
    prof = [(0.16, 0.11, 0.0), (0.165, 0.115, 0.10), (0.19, 0.12, 0.28), (0.21, 0.12, 0.42), (0.19, 0.105, 0.50)]
    pb.loft([rr(hx + pad, hy + pad, z) for hx, hy, z in prof], cloth, cap_bottom=True, cap_top=True)
    pb.lathe([(0.045, 0.49), (0.045, 0.55)], "skin", seg=8)   # neck stub (head origin sits at z = 0.55)
    if skirt:
        pb.loft([rr(hx, hy, z) for hx, hy, z in skirt], cloth, cap_bottom=True)
    return pb.build(name)


def pelvis(name):
    pb = PB()
    pb.loft([rr(0.16, 0.11, 0.0), rr(0.17, 0.12, -0.06), rr(0.165, 0.118, -0.13), rr(0.14, 0.10, -0.18)],
            "fabric_black", cap_bottom=True, cap_top=True)
    return pb.build(name)


def upper_arm(name):
    pb = PB()
    pb.lathe([(0, 0), (0.036, -0.013), (0.05, -0.045), (0.047, -0.16), (0.04, -0.28), (0.032, -0.30)], "fabric_cream")
    return pb.build(name)


def lower_arm(name):
    pb = PB()
    pb.lathe([(0, 0), (0.03, -0.012), (0.042, -0.045), (0.036, -0.14), (0.03, -0.205)], "fabric_cream")
    pb.lathe([(0, -0.198), (0.026, -0.212), (0.038, -0.24), (0.03, -0.265), (0, -0.28)], "skin", sx=0.6)  # hand
    return pb.build(name)


def upper_leg(name):
    pb = PB()
    pb.lathe([(0, 0), (0.056, -0.016), (0.08, -0.05), (0.076, -0.22), (0.063, -0.40), (0.055, -0.45)], "fabric_black")
    return pb.build(name)


def lower_leg(name):
    pb = PB()
    pb.lathe([(0, 0), (0.045, -0.015), (0.062, -0.07), (0.055, -0.20), (0.042, -0.33), (0.038, -0.38)], "fabric_black")
    # shoe: rounded block 0.26 long, toe forward (-Y): y in [-0.19, 0.07]
    pb.loft([rr(0.05, 0.13, -0.45, n=8, p=3, cy=-0.06), rr(0.042, 0.115, -0.375, n=8, p=3, cy=-0.05)],
            "plastic_black", cap_bottom=True, cap_top=True, smooth=False)
    return pb.build(name)


# ----------------------------------------------------------------------------- props
def backpack(name):
    pb = PB()
    pb.loft([rr(0.11, 0.06, 0.0, cy=0.20), rr(0.15, 0.08, -0.06, cy=0.20), rr(0.15, 0.08, -0.32, cy=0.20),
             rr(0.12, 0.07, -0.40, cy=0.20)], "fabric_black", cap_bottom=True, cap_top=True)
    pb.loft([rr(0.10, 0.015, -0.34, n=8, p=3, cy=0.285), rr(0.10, 0.015, -0.14, n=8, p=3, cy=0.285)],
            "fabric_black", cap_bottom=True, cap_top=True)  # front pocket
    return pb.build(name)


def handbag(name):
    pb = PB()
    pb.loft([rr(0.12, 0.045, -0.30), rr(0.135, 0.055, -0.22), rr(0.13, 0.05, -0.11)], "fabric_black",
            cap_bottom=True, cap_top=True)
    arc = [(0.07 * math.cos(t), 0, -0.119 + 0.115 * math.sin(t)) for t in [math.pi * i / 6 for i in range(7)]]
    pb.tube(arc, 0.006, "fabric_black")
    return pb.build(name)


def phone(name):
    pb = PB()
    pb.box((0.075, 0.01, 0.15), (0, 0, 0.075), "plastic_black", front="screen")
    return pb.build(name)


def camera(name):
    pb = PB()
    pb.box((0.12, 0.045, 0.07), (0, 0, 0.035), "plastic_black")
    pb.loft([circ(0.038, 0.028, 8, -0.02, 'y'), circ(0.038, 0.028, 8, -0.05, 'y'), circ(0.038, 0.022, 8, -0.056, 'y')],
            "plastic_black", cap_bottom=True, cap_top=True)   # lens forward (-Y)
    pb.box((0.03, 0.02, 0.015), (0.02, 0.005, 0.0775), "plastic_black")  # viewfinder bump
    return pb.build(name)


def umbrella(name):
    pb = PB()
    pb.lathe([(0.015, 0), (0.015, 0.14)], "wood_dark", seg=8)        # grip
    pb.lathe([(0.008, 0.13), (0.008, 0.90)], "metal_black", seg=6)   # shaft
    def canopy(dz):
        rim = [Vector(((0.5 if j % 2 == 0 else 0.475) * math.cos(TAU * j / 16),
                       (0.5 if j % 2 == 0 else 0.475) * math.sin(TAU * j / 16),
                       (0.715 if j % 2 == 0 else 0.73) + dz)) for j in range(16)]
        return [[Vector((0, 0, 0.895 + dz))], circ(0, 0.10, 16, 0.88 + dz), circ(0, 0.30, 16, 0.82 + dz), rim]
    pb.loft(canopy(0.0), "fabric_red", outward=(0, 0, 0.3))            # top surface
    pb.loft(canopy(-0.006), "fabric_red", outward=(0, 0, 0.3))         # underside (flipped)
    for f in pb.bm.faces[-80:]:
        f.normal_flip()
    return pb.build(name)


def coffee_cup(name):
    pb = PB()
    pb.lathe([(0.028, 0), (0.03, 0.006), (0.041, 0.10), (0.041, 0.104)], "plastic_white", seg=12)
    pb.lathe([(0.041, 0.104), (0.044, 0.107), (0.044, 0.114), (0.032, 0.12), (0, 0.12)], "plastic_black", seg=12)
    return pb.build(name)


# ----------------------------------------------------------------------------- export
def export_part(obj, rel, length, zrange):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    vs = [v.co for v in obj.data.vertices]
    mn = [round(min(v[i] for v in vs), 4) for i in range(3)]
    mx = [round(max(v[i] for v in vs), 4) for i in range(3)]
    tris = tri_count([obj])
    budget = HEAD_BUDGET if rel.startswith("people/head") else BUDGET
    ok = tris <= budget and abs(mn[2] - zrange[0]) < 0.012 and abs(mx[2] - zrange[1]) < 0.012
    export_glb(obj, rel, meta={"kind": "bodypart", "length": length, "bbox": [mn, mx]})
    RESULTS.append((rel, tris, mn, mx, ok))
    clear_objects()


def main():
    reset_scene()
    export_part(head("head"), "people/head", 0.24, (0, 0.24))
    export_part(head("head_hat", hair="band", hat=True), "people/head_hat", 0.24, (0, 0.248))
    export_part(head("head_longhair", hair="long"), "people/head_longhair", 0.24, (-0.15, 0.24))
    export_part(torso("torso", "fabric_cream"), "people/torso", 0.55, (0, 0.55))
    export_part(torso("torso_coat", "fabric_black", pad=0.008,
                      skirt=[(0.178, 0.128, 0.08), (0.185, 0.135, -0.15), (0.20, 0.15, -0.45)]),
                "people/torso_coat", 0.55, (-0.45, 0.55))
    export_part(torso("torso_dress", "fabric_cream",
                      skirt=[(0.17, 0.12, 0.06), (0.215, 0.165, -0.20), (0.27, 0.21, -0.45)]),
                "people/torso_dress", 0.55, (-0.45, 0.55))
    export_part(pelvis("pelvis"), "people/pelvis", 0.18, (-0.18, 0))
    export_part(upper_arm("upper_arm"), "people/upper_arm", 0.30, (-0.30, 0))
    export_part(lower_arm("lower_arm"), "people/lower_arm", 0.28, (-0.28, 0))
    export_part(upper_leg("upper_leg"), "people/upper_leg", 0.45, (-0.45, 0))
    export_part(lower_leg("lower_leg"), "people/lower_leg", 0.45, (-0.45, 0))
    export_part(backpack("backpack"), "people/backpack", 0.40, (-0.40, 0))
    export_part(handbag("handbag"), "people/handbag", 0.30, (-0.30, 0))
    export_part(phone("phone"), "people/phone", 0.15, (0, 0.15))
    export_part(camera("camera"), "people/camera", 0.12, (0, 0.085))
    export_part(umbrella("umbrella"), "people/umbrella", 0.90, (0, 0.90))
    export_part(coffee_cup("coffee_cup"), "people/coffee_cup", 0.12, (0, 0.12))

    print("\n%-22s %5s  %-28s %-28s %s" % ("asset", "tris", "bbox min (x,y,z)", "bbox max (x,y,z)", "status"))
    bad = 0
    for rel, tris, mn, mx, ok in RESULTS:
        bad += (not ok)
        print("%-22s %5d  %-28s %-28s %s" % (rel, tris, str(mn), str(mx), "ok" if ok else "CHECK"))
    write_manifest("people")
    if bad:
        print(f"ERROR: {bad} part(s) over budget or off their expected z-range"); sys.exit(1)


if __name__ == "__main__":
    main()
