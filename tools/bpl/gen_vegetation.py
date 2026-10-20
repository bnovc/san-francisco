"""
gen_vegetation.py — low-cost vegetation for the SF Union Square scene: Canary Island date palms
(the plaza edges), London plane / small street trees for the surrounding streets, indoor ficus for the
Apple store, olives, hedges / planters / flowerbeds, the Apple-plaza green wall and the holiday tree.
Run:  tools/bpl/.venv/bin/python tools/bpl/gen_vegetation.py
Conventions: metres, Blender Z-up, origin at the bottom-centre of the trunk / block (trunk on x=y=0),
only MATERIAL_LIBRARY names.  Foliage = a modest number of quads (cards / bent strips) whose materials are
flagged double-sided (glTF doubleSided) and carry 0..1 UVs so the runtime can drop alpha-tested leaf textures
on them.  Trunks are lathes with taper, root flare and noise on the ring radii.
Budgets: tree < 8000 tris, *_lod1 < 1500, shrubs / hedges / small props < 1500.
"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(__file__))
from bpl_lib import *

BUDGET_TREE, BUDGET_LOD1, BUDGET_SHRUB = 8000, 1500, 1500
TAU = 2 * math.pi
FOLIAGE_MATERIALS = ("leaf_green", "leaf_dark", "palm_frond", "grass")


# ----------------------------------------------------------------------------- generic helpers
def unit_random(rng):
    z = rng.uniform(-1, 1); a = rng.uniform(0, TAU); r = math.sqrt(max(0.0, 1 - z * z))
    return Vector((r * math.cos(a), r * math.sin(a), z))


def basis(normal, roll=0.0):
    """Orthonormal (u, v) spanning the plane perpendicular to `normal` ((u, v, n) right-handed)."""
    n = Vector(normal).normalized()
    helper = Vector((0, 0, 1)) if abs(n.z) < 0.9 else Vector((1, 0, 0))
    u = n.cross(helper).normalized()
    v = n.cross(u).normalized()
    if roll:
        c, s = math.cos(roll), math.sin(roll)
        u, v = u * c + v * s, v * c - u * s
    return u, v


class MB:
    """Accumulates faces of ONE material into a bmesh with a UV layer; build(name) -> linked object."""

    def __init__(self, material, smooth=False):
        self.material, self.smooth = material, smooth
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def _face(self, verts, uvs, smooth):
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        for l, uv in zip(f.loops, uvs):
            l[self.uv].uv = uv
        f.smooth = smooth
        return f

    def quad(self, p0, p1, p2, p3, uvs=((0, 0), (1, 0), (1, 1), (0, 1)), smooth=False):
        return self._face([self.bm.verts.new(Vector(p)) for p in (p0, p1, p2, p3)], uvs, smooth)

    def card(self, center, normal, w, h, roll=0.0):
        """One quad centred at `center` facing `normal` (UV 0..1); the material is double-sided."""
        u, v = basis(normal, roll)
        c = Vector(center); a, b = u * (w / 2), v * (h / 2)
        return self.quad(c - a - b, c + a - b, c + a + b, c - a + b)

    def cross_card(self, center, normal, w, h, roll=0.0):
        u, _ = basis(normal, roll)
        self.card(center, normal, w, h, roll)
        self.card(center, u, w, h, 0.0)

    def loft(self, rings, closed=True, cap_bottom=False, cap_top=False, smooth=None, uv_scale=1.0):
        """Connect consecutive rings (lists of points, lowest first) with quads. A ring with a single point
        is an apex (triangle fan). Closed: u wraps around, v runs along the rings. Open strips: u runs
        along the strip, v across it."""
        smooth = self.smooth if smooth is None else smooth
        verts = [[self.bm.verts.new(Vector(p)) for p in ring] for ring in rings]
        m = len(rings)
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
                        self._face([ring[j], ring[k], apex], [(sa, ta), (sb, ta), (sa, tb)], smooth)
                    else:
                        self._face([apex, ring[k], ring[j]], [(sa, ta), (sb, tb), (sa, tb)], smooth)
                continue
            n = len(a)
            for j in range(n if closed else n - 1):
                k = (j + 1) % n
                if closed:
                    sa, sb = j / n, (j + 1) / n
                    uvs = [(sa, ta), (sb, ta), (sb, tb), (sa, tb)]
                else:
                    sa, sb = j / (n - 1), (j + 1) / (n - 1)
                    uvs = [(ta, sa), (ta, sb), (tb, sb), (tb, sa)]
                self._face([a[j], a[k], b[k], b[j]], uvs, smooth)
        if cap_bottom and len(verts[0]) > 2:
            vs = list(reversed(verts[0]))
            self._face(vs, [(v.co.x * uv_scale + .5, v.co.y * uv_scale + .5) for v in vs], False)
        if cap_top and len(verts[-1]) > 2:
            vs = list(verts[-1])
            self._face(vs, [(v.co.x * uv_scale + .5, v.co.y * uv_scale + .5) for v in vs], False)
        return verts

    def tube(self, p0, p1, r0, r1, segments=8, cap_top=True, smooth=True):
        p0, p1 = Vector(p0), Vector(p1)
        u, v = basis(p1 - p0)
        rings = []
        for p, r in ((p0, r0), (p1, r1)):
            rings.append([p + (u * math.cos(TAU * j / segments) + v * math.sin(TAU * j / segments)) * r
                          for j in range(segments)])
        return self.loft(rings, cap_top=cap_top, smooth=smooth)

    def box_uvs(self, faces, scale=1.0):
        for f in faces:
            n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                uv = (c.y, c.z) if ax == 0 else ((c.x, c.z) if ax == 1 else (c.x, c.y))
                l[self.uv].uv = (uv[0] * scale, uv[1] * scale)

    def noisy_box(self, rng, size, base, cuts=3, noise=0.03, smooth=True):
        """Subdivided box with its bottom-centre at `base`, vertices jittered along their normals."""
        before = set(self.bm.verts)
        res = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = res["verts"]
        bmesh.ops.scale(self.bm, vec=Vector(size), verts=verts)
        bmesh.ops.translate(self.bm, vec=Vector((base[0], base[1], base[2] + size[2] / 2)), verts=verts)
        edges = list({e for v in verts for e in v.link_edges})
        bmesh.ops.subdivide_edges(self.bm, edges=edges, cuts=cuts, use_grid_fill=True)
        new = [v for v in self.bm.verts if v not in before]
        self.bm.normal_update()
        zmin = base[2]
        for v in new:
            v.co += v.normal * rng.uniform(-noise, noise)
            v.co.z = max(v.co.z, zmin)
        faces = {f for v in new for f in v.link_faces}
        self.bm.normal_update()
        self.box_uvs(faces, 1.0)
        for f in faces:
            f.smooth = smooth
        return faces

    def blob(self, rng, center, radii, n_rings=6, segments=12, noise=0.08):
        """Noisy ellipsoid (a shrub ball); pointed apexes top & bottom."""
        center = Vector(center); rings = []
        for i in range(n_rings + 1):
            phi = -math.pi / 2 + math.pi * i / n_rings
            if i == 0 or i == n_rings:
                rings.append([center + Vector((0, 0, math.sin(phi) * radii[2]))]); continue
            ring = []
            for j in range(segments):
                a = TAU * j / segments; k = 1 + rng.uniform(-noise, noise)
                ring.append(center + Vector((math.cos(phi) * math.cos(a) * radii[0] * k,
                                             math.cos(phi) * math.sin(a) * radii[1] * k,
                                             math.sin(phi) * radii[2] * k)))
            rings.append(ring)
        return self.loft(rings, smooth=True)

    def icosphere(self, center, radius, subdivisions=0):
        bmesh.ops.create_icosphere(self.bm, subdivisions=subdivisions, radius=radius,
                                   matrix=Matrix.Translation(Vector(center)))

    def build(self, name):
        return mesh_from_bmesh(self.bm, name, self.material)


def trunk_rings(rng, r_base, r_top, height, n_rings, segments, noise=0.04, flare=0.25, scar_k=0,
                scar_amp=0.0, lean=(0.0, 0.0), wobble=0.0):
    """Rings for a tapering trunk with root flare, per-ring/per-vertex radius noise, optional lean and
    an optional staggered bump pattern (palm leaf-scar diamonds). Returns (rings, top_centre)."""
    rings = []
    for i in range(n_rings + 1):
        t = i / n_rings
        z = height * t
        r = (r_base + (r_top - r_base) * t) * (1 + flare * max(0.0, 1 - t * 8) ** 2)
        r *= 1 + rng.uniform(-noise, noise)
        cx = lean[0] * t + wobble * math.sin(t * 7.0 + 1.0) * t
        cy = lean[1] * t + wobble * math.cos(t * 5.0) * t
        ring = []
        for j in range(segments):
            a = TAU * j / segments
            rr = r * (1 + rng.uniform(-noise, noise) * 0.5)
            if scar_k:
                rr *= 1 + scar_amp * max(0.0, math.cos(a * scar_k + (i % 2) * math.pi))
            ring.append(Vector((cx + rr * math.cos(a), cy + rr * math.sin(a), z)))
        rings.append(ring)
    return rings, Vector((lean[0], lean[1], height))


def frond(mb, base, azimuth, elev, length, width, droop, n=7, vee=0.55, flat=False):
    """A palm frond: a bent strip of n quads (x2 columns when V-shaped) drooping away from `base`."""
    rad = Vector((math.cos(azimuth), math.sin(azimuth), 0.0))
    side = Vector((-math.sin(azimuth), math.cos(azimuth), 0.0))
    rows, p = [], Vector(base)
    for i in range(n + 1):
        t = i / n
        ang = elev - droop * t ** 1.6
        d = rad * math.cos(ang) + Vector((0, 0, math.sin(ang)))
        up = rad * -math.sin(ang) + Vector((0, 0, math.cos(ang)))
        w = width * min(1.0, 0.2 + 2.4 * t) * max(0.03, 1 - t) ** 0.6
        off_s = side * (w / 2) * math.cos(vee); off_u = up * (w / 2) * math.sin(vee)
        rows.append([p - off_s + off_u, p + off_s + off_u] if flat else [p - off_s + off_u, p.copy(), p + off_s + off_u])
        p = p + d * (length / n)
    mb.loft(rows, closed=False, smooth=False)


def crown_cards(mb, rng, center, radii, count, size, cross=True, shell=0.45):
    """Randomised leaf cards inside an ellipsoid, biased towards the outer shell."""
    center = Vector(center)
    for _ in range(count):
        d = unit_random(rng)
        rr = shell + (1 - shell) * rng.random() ** (1 / 3)
        p = center + Vector((d.x * radii[0] * rr, d.y * radii[1] * rr, d.z * radii[2] * rr))
        s = rng.uniform(size * 0.8, size * 1.2)
        n = unit_random(rng)
        if cross:
            mb.cross_card(p, n, s, s * rng.uniform(0.85, 1.15), rng.uniform(0, math.pi))
        else:
            mb.card(p, n, s, s * rng.uniform(0.85, 1.15), rng.uniform(0, math.pi))


def surface_cards(mb, rng, center, radii, count, size, push=1.04):
    """Leaf cards lying on the surface of an ellipsoid (shrub / hedge fluff)."""
    center = Vector(center)
    for _ in range(count):
        d = unit_random(rng)
        if d.z < -0.3: d.z = -d.z
        p = center + Vector((d.x * radii[0] * push, d.y * radii[1] * push, d.z * radii[2] * push))
        mb.card(p, d, size, size * rng.uniform(0.8, 1.2), rng.uniform(0, math.pi))


def finalize(objs, name):
    """Join parts, apply transforms, drop to z=0 (keeping x/y so the trunk stays on the origin)."""
    objs = [o for o in objs if o is not None and len(o.data.polygons) > 0]
    obj = join(objs, name) if len(objs) > 1 else objs[0]
    obj.name = name
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    zmin = min(v.co.z for v in obj.data.vertices)
    if abs(zmin) > 1e-6:
        for v in obj.data.vertices:
            v.co.z -= zmin
    return obj


RESULTS = []


def export(obj, rel, kind, budget):
    tris = tri_count([obj])
    h = max(v.co.z for v in obj.data.vertices)
    cr = max(math.hypot(v.co.x, v.co.y) for v in obj.data.vertices)
    export_glb(obj, rel, meta={"kind": kind, "height": round(h, 2), "crownRadius": round(cr, 2)})
    RESULTS.append((rel, tris, budget, h, cr))
    clear_objects()


# ----------------------------------------------------------------------------- trees
def palm(name, seed, trunk_h, n_fronds, lod=False):
    rng = random.Random(seed)
    seg = 10 if lod else 32
    n_rings = 5 if lod else max(8, int(trunk_h / 0.28))
    bark = MB("bark_palm", smooth=True)
    rings, top = trunk_rings(rng, 0.50, 0.37, trunk_h, n_rings, seg, noise=0.03, flare=0.3,
                             scar_k=0 if lod else 8, scar_amp=0.0 if lod else 0.07,
                             lean=(rng.uniform(-.25, .25), rng.uniform(-.25, .25)))
    # crown base bulb (where the fronds attach)
    def ring_at(dz, r):
        return [top + Vector((r * math.cos(TAU * j / seg), r * math.sin(TAU * j / seg), dz)) for j in range(seg)]
    rings += [ring_at(0.45, 0.55), ring_at(0.95, 0.38), [top + Vector((0, 0, 1.2))]]
    bark.loft(rings)
    crown = top + Vector((0, 0, 0.7))
    fr = MB("palm_frond")
    tiers = [(math.radians(50), math.radians(72), 3.4, 1.1, 0.95),    # young upright fronds
             (math.radians(8), math.radians(35), 4.6, 1.5, 1.05),     # main spreading tier
             (math.radians(-35), math.radians(-8), 4.3, 1.4, 0.9)]    # lower drooping tier
    for i in range(n_fronds):
        az = TAU * i / n_fronds + rng.uniform(-0.12, 0.12)
        e0, e1, L, w, droop = tiers[i % 3] if not lod else tiers[1]
        elev = rng.uniform(e0, e1)
        base = crown + Vector((math.cos(az) * 0.35, math.sin(az) * 0.35, rng.uniform(-0.15, 0.15)))
        frond(fr, base, az, elev, L * rng.uniform(0.9, 1.1), w, droop, n=5 if lod else 7,
              vee=0.0 if lod else 0.55, flat=lod)
    if not lod:  # skirt of dead fronds hanging under the crown
        for i in range(10):
            az = TAU * i / 10 + rng.uniform(-0.2, 0.2)
            base = crown + Vector((math.cos(az) * 0.4, math.sin(az) * 0.4, -0.4))
            frond(bark, base, az, math.radians(rng.uniform(-80, -62)), 2.6, 0.5, 0.25, n=5, vee=0.0, flat=True)
    return finalize([bark.build(name + "_bark"), fr.build(name + "_fronds")], name)


def broadleaf(name, seed, trunk_r, trunk_top, crown_c, crown_radii, n_cards, card_size, leaf_mat,
              n_branches=4, lod=False, stems=1, wobble=0.0):
    rng = random.Random(seed)
    seg = 8 if lod else 14
    bark = MB("bark", smooth=True)
    tops = []
    for s in range(stems):
        if stems == 1:
            lean = (0.0, 0.0)
        else:
            az = TAU * s / stems + rng.uniform(-0.3, 0.3)
            lean = (math.cos(az) * 0.9, math.sin(az) * 0.9)
        rings, top = trunk_rings(rng, trunk_r, trunk_r * 0.6, trunk_top, 3 if lod else 8, seg, noise=0.05,
                                 flare=0.35, lean=lean, wobble=wobble)
        bark.loft(rings, cap_top=True)
        tops.append(top)
    if not lod:
        cc = Vector(crown_c)
        for top in tops:
            for b in range(n_branches):
                az = TAU * b / n_branches + rng.uniform(-0.4, 0.4)
                target = cc + Vector((math.cos(az) * crown_radii[0] * rng.uniform(0.4, 0.75),
                                      math.sin(az) * crown_radii[1] * rng.uniform(0.4, 0.75),
                                      crown_radii[2] * rng.uniform(-0.1, 0.6)))
                start = top - Vector((0, 0, 0.35))
                mid = (start + target) / 2 + Vector((rng.uniform(-.3, .3), rng.uniform(-.3, .3), 0))
                r = trunk_r * 0.55
                bark.tube(start, mid, r, r * 0.55, segments=7)
                bark.tube(mid, target, r * 0.55, r * 0.15, segments=7)
                twig = mid + (target - mid).cross(Vector((0, 0, 1))).normalized() * rng.uniform(0.8, 1.6) \
                       + Vector((0, 0, rng.uniform(0.4, 1.2)))
                bark.tube(mid, twig, r * 0.35, r * 0.1, segments=6)
    leaves = MB(leaf_mat)
    crown_cards(leaves, rng, crown_c, crown_radii, n_cards, card_size, cross=True)
    return finalize([bark.build(name + "_bark"), leaves.build(name + "_leaves")], name)


# ----------------------------------------------------------------------------- small stuff
def shrub_ball(seed=7):
    rng = random.Random(seed)
    mb = MB("leaf_green")
    mb.blob(rng, (0, 0, 0.31), (0.31, 0.31, 0.30), n_rings=6, segments=12, noise=0.07)
    surface_cards(mb, rng, (0, 0, 0.31), (0.31, 0.31, 0.30), 14, 0.22)
    return finalize([mb.build("shrub")], "shrub_box")


def hedge(name, seed, length, height, depth=0.5):
    rng = random.Random(seed)
    mb = MB("leaf_green")
    mb.noisy_box(rng, (length, depth, height), (0, 0, 0), cuts=3, noise=0.035)
    for _ in range(int(20 * length)):  # leafy fluff on the exposed faces
        x = rng.uniform(-length / 2, length / 2)
        face = rng.random()
        if face < 0.4:
            p, n = (x, rng.uniform(-depth / 2, depth / 2), height), Vector((0, 0, 1))
        elif face < 0.7:
            p, n = (x, -depth / 2, rng.uniform(0.1, height)), Vector((0, -1, 0))
        else:
            p, n = (x, depth / 2, rng.uniform(0.1, height)), Vector((0, 1, 0))
        n = (n + unit_random(rng) * 0.6).normalized()
        mb.card(Vector(p) + n * 0.03, n, 0.2, 0.2, rng.uniform(0, math.pi))
    return finalize([mb.build(name)], name)


def flowerbed(seed=11):
    rng = random.Random(seed)
    soil = MB("soil"); soil.noisy_box(rng, (1.0, 1.0, 0.15), (0, 0, 0), cuts=2, noise=0.012, smooth=False)
    stems = MB("leaf_green")
    colours = {c: MB(c) for c in ("paint_red", "paint_yellow", "paint_white", "plastic_white")}
    for i in range(25):
        x, y = rng.uniform(-0.42, 0.42), rng.uniform(-0.42, 0.42)
        h = 0.15 + rng.uniform(0.12, 0.24)
        stems.tube((x, y, 0.14), (x, y, h), 0.008, 0.005, segments=3, cap_top=False)
        colours[list(colours)[i % 4]].icosphere((x, y, h + 0.02), rng.uniform(0.035, 0.05))
    for _ in range(22):
        p = (rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45), 0.15 + rng.uniform(0.03, 0.14))
        n = (Vector((0, 0, 1)) + unit_random(rng) * 0.9).normalized()
        stems.card(p, n, 0.16, 0.14, rng.uniform(0, math.pi))
    objs = [soil.build("soil"), stems.build("stems")] + [mb.build(c) for c, mb in colours.items()]
    return finalize(objs, "flowerbed_1m")


def grass_patch(seed=13):
    rng = random.Random(seed)
    g = MB("grass"); g.quad((-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0))
    blades = MB("leaf_green")
    for _ in range(18):
        x, y = rng.uniform(-0.45, 0.45), rng.uniform(-0.45, 0.45)
        az = rng.uniform(0, TAU); side = Vector((-math.sin(az), math.cos(az), 0)); lean = Vector((math.cos(az), math.sin(az), 0))
        h, w = rng.uniform(0.15, 0.32), rng.uniform(0.05, 0.09)
        rows = []
        for t, wf, lf in ((0, 1.0, 0.0), (0.55, 0.7, 0.12), (1.0, 0.08, 0.4)):
            c = Vector((x, y, h * t)) + lean * (h * lf)
            rows.append([c - side * w * wf / 2, c + side * w * wf / 2])
        blades.loft(rows, closed=False, smooth=False)
    return finalize([g.build("grass"), blades.build("blades")], "grass_patch")


def planter_shrubs(seed=17):
    rng = random.Random(seed)
    def rect(w, z):
        return [Vector((-w / 2, -w / 2, z)), Vector((w / 2, -w / 2, z)), Vector((w / 2, w / 2, z)), Vector((-w / 2, w / 2, z))]
    con = MB("concrete")
    con.loft([rect(1.2, 0), rect(1.2, 0.6), rect(1.08, 0.6), rect(1.08, 0.45)], smooth=False, uv_scale=1.0)
    soil = MB("soil"); soil.quad((-.54, -.54, .451), (.54, -.54, .451), (.54, .54, .451), (-.54, .54, .451))
    green, dark = MB("leaf_green"), MB("leaf_dark")
    for (x, y, r, mb) in ((-0.26, -0.2, 0.30, green), (0.25, -0.12, 0.26, dark), (0.0, 0.27, 0.28, green), (-0.1, 0.02, 0.22, green)):
        c = (x, y, 0.45 + r * 0.85)
        mb.blob(rng, c, (r, r, r * 0.95), n_rings=5, segments=10, noise=0.08)
        surface_cards(mb, rng, c, (r, r, r * 0.95), 8, 0.18)
    return finalize([con.build("planter"), soil.build("soil"), green.build("g"), dark.build("d")], "planter_shrubs")


def vine_wall(seed=19):
    rng = random.Random(seed)
    back = MB("leaf_dark"); back.quad((-1, 0, 0), (-1, 0, 3), (1, 0, 3), (1, 0, 0))
    leaves = MB("leaf_green")
    for _ in range(80):
        p = (rng.uniform(-0.95, 0.95), rng.uniform(0.03, 0.18), rng.uniform(0.08, 2.92))
        n = Vector((rng.uniform(-0.5, 0.5), 1.0, rng.uniform(-0.5, 0.5))).normalized()
        s = rng.uniform(0.3, 0.5)
        leaves.card(p, n, s, s * rng.uniform(0.8, 1.2), rng.uniform(0, math.pi))
    dark = MB("leaf_dark")
    for _ in range(20):
        p = (rng.uniform(-0.95, 0.95), rng.uniform(0.02, 0.10), rng.uniform(0.08, 2.92))
        n = Vector((rng.uniform(-0.6, 0.6), 1.0, rng.uniform(-0.6, 0.6))).normalized()
        dark.card(p, n, 0.4, 0.4, rng.uniform(0, math.pi))
    return finalize([back.build("back"), leaves.build("leaves"), dark.build("dark")], "vine_wall_2m")


def christmas_tree(seed=23):
    rng = random.Random(seed)
    H, R0 = 25.0, 5.6
    bark = MB("bark", smooth=True)
    rings, _ = trunk_rings(rng, 0.45, 0.15, H - 1.0, 6, 10, noise=0.02, flare=0.2)
    bark.loft(rings, cap_top=True)
    leaves, lights, baubles = MB("leaf_dark"), MB("emissive_warm"), MB("paint_red")
    tiers = 16
    for i in range(tiers):
        t = i / (tiers - 1)
        z = 1.2 + (H - 2.4) * t
        R = R0 * (1 - z / H) + 0.3
        n = max(6, int(R * 2.6))
        w = TAU * R / n * 1.4
        for j in range(n):
            az = TAU * (j + 0.5 * (i % 2)) / n + rng.uniform(-0.1, 0.1)
            rad = Vector((math.cos(az), math.sin(az), 0)); side = Vector((-math.sin(az), math.cos(az), 0))
            rows = []
            for f, dz, wf in ((0.0, 0.0, 0.5), (0.55, -0.12, 1.0), (1.0, -0.38, 0.45)):
                c = Vector((0, 0, z)) + rad * (R * f) + Vector((0, 0, dz * R * 0.5))
                rows.append([c - side * w * wf / 2, c + side * w * wf / 2])
            leaves.loft(rows, closed=False, smooth=False)                       # drooping radial branch
            leaves.card(Vector((0, 0, z - R * 0.12)) + rad * (R * 0.78), rad,  # tangential silhouette card
                        w * 1.1, R * 0.45 + 0.6, rng.uniform(-0.2, 0.2))
    n_lights = 170
    for i in range(n_lights):
        t = i / n_lights
        z = 1.0 + (H - 2.6) * t
        R = (R0 * (1 - z / H) + 0.3) * 0.92
        az = t * 19 * TAU
        lights.icosphere((math.cos(az) * R, math.sin(az) * R, z), 0.17)
    for _ in range(40):
        z = rng.uniform(1.5, H - 3.0); R = (R0 * (1 - z / H) + 0.3) * 0.85; az = rng.uniform(0, TAU)
        baubles.icosphere((math.cos(az) * R, math.sin(az) * R, z), 0.28)
    lights.icosphere((0, 0, H - 0.6), 0.65, subdivisions=1)                   # top star
    return finalize([bark.build("trunk"), leaves.build("leaves"), lights.build("lights"), baubles.build("baubles")],
                    "christmas_tree_big")


# ----------------------------------------------------------------------------- main
def main():
    reset_scene()
    for m in FOLIAGE_MATERIALS:
        mat(m).use_backface_culling = False   # -> glTF doubleSided for the leaf cards
    T, L, S = BUDGET_TREE, BUDGET_LOD1, BUDGET_SHRUB

    export(palm("palm_canary", 1, 8.0, 26), "veg/palm_canary", "tree", T)
    export(palm("palm_canary_lod1", 1, 8.0, 8, lod=True), "veg/palm_canary_lod1", "tree_lod1", L)
    export(palm("palm_canary_short", 2, 5.0, 24), "veg/palm_canary_short", "tree", T)

    export(broadleaf("tree_plane", 3, 0.20, 3.4, (0, 0, 6.2), (3.9, 3.9, 3.4), 48, 2.6, "leaf_green", n_branches=5),
           "veg/tree_plane", "tree", T)
    export(broadleaf("tree_plane_lod1", 3, 0.20, 3.4, (0, 0, 6.2), (3.9, 3.9, 3.4), 12, 3.4, "leaf_green", lod=True),
           "veg/tree_plane_lod1", "tree_lod1", L)

    export(broadleaf("tree_ficus_indoor", 4, 0.09, 2.3, (0, 0, 2.95), (1.85, 1.85, 1.7), 46, 1.25, "leaf_dark", n_branches=4),
           "veg/tree_ficus_indoor", "tree", T)
    export(broadleaf("tree_ficus_lod1", 4, 0.09, 2.3, (0, 0, 2.95), (1.85, 1.85, 1.7), 12, 1.7, "leaf_dark", lod=True),
           "veg/tree_ficus_lod1", "tree_lod1", L)

    export(broadleaf("tree_street_small", 5, 0.10, 2.3, (0, 0, 3.15), (1.6, 1.6, 1.5), 36, 1.2, "leaf_green", n_branches=4),
           "veg/tree_street_small", "tree", T)
    export(broadleaf("tree_street_small_lod1", 5, 0.10, 2.3, (0, 0, 3.15), (1.6, 1.6, 1.5), 10, 1.6, "leaf_green", lod=True),
           "veg/tree_street_small_lod1", "tree_lod1", L)

    export(broadleaf("tree_olive", 6, 0.13, 2.0, (0, 0, 3.3), (2.3, 2.3, 1.5), 44, 1.3, "leaf_dark", n_branches=3,
                     stems=3, wobble=0.18), "veg/tree_olive", "tree", T)

    export(shrub_ball(), "veg/shrub_box", "shrub", S)
    export(hedge("hedge_1m", 8, 1.0, 0.9), "veg/hedge_1m", "hedge", S)
    export(hedge("hedge_1m_low", 9, 1.0, 0.5, depth=0.45), "veg/hedge_1m_low", "hedge", S)
    export(flowerbed(), "veg/flowerbed_1m", "flowerbed", S)
    export(grass_patch(), "veg/grass_patch", "grass", S)
    export(planter_shrubs(), "veg/planter_shrubs", "planter", S)
    export(vine_wall(), "veg/vine_wall_2m", "greenwall", S)
    export(christmas_tree(), "veg/christmas_tree_big", "holiday_tree", T)

    print("\n%-26s %6s %6s %7s %7s  %s" % ("asset", "tris", "budget", "height", "crownR", "status"))
    over = 0
    for rel, tris, budget, h, cr in RESULTS:
        ok = tris <= budget; over += (not ok)
        print("%-26s %6d %6d %7.2f %7.2f  %s" % (rel, tris, budget, h, cr, "ok" if ok else "OVER BUDGET"))
    write_manifest("veg")
    if over:
        print(f"ERROR: {over} asset(s) over budget"); sys.exit(1)


if __name__ == "__main__":
    main()
