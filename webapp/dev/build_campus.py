# DEV ONLY: turns the OpenStreetMap extract (dev/osm/dut-osm.json, © OpenStreetMap contributors, ODbL)
# into data/campus.json for the 3D campus map.
#   python -I -X utf8 dev/build_campus.py
# Coordinates are metres, rotated like the official illustrated campus map:
#   +x = screen right = south, -z = screen up = east (Nguyễn Lương Bằng / main gate at the bottom).
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
d = json.load(open(os.path.join(HERE, 'osm', 'dut-osm.json'), encoding='utf-8'))
els = d['elements']

LAT0, LON0 = 16.0750, 108.1525
KX = 111320 * math.cos(math.radians(LAT0))
KY = 110574
OX, OZ = -40.0, 0.0  # recentre on the main campus


def pt(p):
    east = (p['lon'] - LON0) * KX
    north = (p['lat'] - LAT0) * KY
    # screen right = south (-north), screen up = east -> three.js z points down the screen
    return [round(-north - OX, 1), round(-east - OZ, 1)]


# Zones as printed on the official campus map, matched to OSM footprints (by OSM way id).
ZONES = {
    'L': [924999032], 'B': [968341211], 'F': [118777644], 'H': [968341208], 'M': [968341223],
    'N': [118777693, 1328750179, 1328750180],
    'K': [118777665], 'P': [1328739093], 'I': [968341227, 1328750185], 'D': [968341235],
    'G': [968341231], 'A': [1043659296, 1043659297, 1043659298], 'E1': [968341226], 'S': [1551964032],
    'E2': [968341885], 'C1': [968341220, 968341225, 968341209], 'C2': [968341210], 'C3': [968341233],
    'X': [1328750183, 1328750184],
}

# Real data from students (overrides OSM / estimates).
OVERRIDES = {
    1551964032: {'levels': 10, 'height': 42, 'floor_area': 7330, 'estimated': False, 'entrance_edge': 5},  # Nhà S: main door under the core
    # canteen next to Khu E1: walk-in interior (tables, drinks fridges, coffee bar, kitchen)
    1328750198: {'name': 'Căn tin', 'kind': 'canteen', 'interior': 'canteen', 'levels': 1, 'height': 4.2, 'estimated': False, 'entrance_edge': 3},
    1043659299: {'name': 'Căn tin KTX'},
    968341212: {'style': {'roof': 'hip', 'roofColor': 0xb9533f, 'wall': 'cream'}},   # small red-roof block next to Khu X
    # Khu E1: open corridor along the front on both floors, staircase at the end next to the canteen
    968341226: {'corridor': {'edge': 3, 'depth': 2.6}, 'entrance_edge': 3},
}
# Khu A: OSM draws the two back blocks far too deep and swallows the courtyards (fish ponds, trees).
# Keep only a ~12 m strip at the back of each block; the rest becomes a courtyard with a pond.
# Real floor counts per zone (from students, 2026-11-11)
ZONE_LEVELS = {'E1': 2, 'E2': 4, 'A': 3, 'C1': 2, 'C2': 2, 'C3': 2, 'B': 3, 'F': 4}
# Khu B: one OSM outline = a 3-floor main bar + three 2-floor wings at the back (vertex index ranges)
SPLIT = {968341211: [
    (list(range(0, 4)) + [8, 9, 14, 15] + list(range(20, 30)), 3),
    (list(range(3, 9)), 2), (list(range(9, 15)), 2), (list(range(15, 21)), 2),
]}
# Parking: 'roof' = covered by a tin roof (nhà xe), 'open' = open-air motorbike lot (from students)
PARKING = {1038801125: 'roof', 1038801147: 'open'}
PARKING_NAMES = {1038801125: 'Nhà xe khu B', 1038998627: 'Nhà xe khu E'}
A_BACK = [1043659297, 1043659298]
A_FRONT = 1043659296
BACK_DEPTH = 12.0

ways = {e['id']: e for e in els if e['type'] == 'way' and e.get('geometry')}
campus = ways[968341228]
cpts = [pt(p) for p in campus['geometry']]
xs = [p[0] for p in cpts]; zs = [p[1] for p in cpts]
BOX = (min(xs) - 70, max(xs) + 70, min(zs) - 70, max(zs) + 70)


def inside_box(pts):
    return any(BOX[0] <= x <= BOX[1] and BOX[2] <= z <= BOX[3] for x, z in pts)


def area(pts):
    return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2


def ring(e):
    pts = [pt(p) for p in e['geometry']]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    return pts


def clip(poly, nx, nz, c, keep_below=True):
    # Sutherland-Hodgman against the half-plane dot(p, n) <= c (or >= c)
    sgn = 1 if keep_below else -1
    f = lambda p: sgn * (p[0] * nx + p[1] * nz - c)
    out = []
    for i in range(len(poly)):
        a, b = poly[i - 1], poly[i]
        fa, fb = f(a), f(b)
        if fb <= 0:
            if fa > 0:
                t = fa / (fa - fb); out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
            out.append(b)
        elif fa <= 0:
            t = fa / (fa - fb); out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    return [[round(x, 1), round(z, 1)] for x, z in out]


def centroid(pts):
    return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]


def split_back(pts, front_c):
    # long axis = direction of the longest edge; normal points towards the front block
    cx, cz = centroid(pts)
    i = max(range(len(pts)), key=lambda k: math.dist(pts[k - 1], pts[k]))
    ang = math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])
    nx, nz = -math.sin(ang), math.cos(ang)
    if (front_c[0] - cx) * nx + (front_c[1] - cz) * nz < 0:
        nx, nz = -nx, -nz
    back = min(p[0] * nx + p[1] * nz for p in pts)
    keep = clip(pts, nx, nz, back + BACK_DEPTH, True)
    yard = clip(pts, nx, nz, back + BACK_DEPTH, False)
    return keep, yard, (math.cos(ang), math.sin(ang), nx, nz)


zone_of = {}
for z, ids in ZONES.items():
    for i in ids:
        zone_of[i] = z

buildings, roads, areas = [], [], []
ROAD_W = {'trunk': 14, 'trunk_link': 8, 'primary': 12, 'secondary': 10, 'tertiary': 8, 'residential': 6,
          'service': 4, 'unclassified': 5, 'footway': 2, 'path': 1.6, 'cycleway': 2, 'pedestrian': 4}
for e in ways.values():
    t = e.get('tags', {})
    pts = ring(e) if e['geometry'][0] == e['geometry'][-1] else [pt(p) for p in e['geometry']]
    if not inside_box(pts):
        continue
    if 'building' in t:
        if t.get('building') == 'construction':
            continue
        lv = t.get('building:levels')
        if e['id'] in A_BACK:
            pts, yard, (ux, uz, nx, nz) = split_back(pts, centroid(ring(ways[A_FRONT])))
            if len(yard) >= 3:
                areas.append({'kind': 'grass', 'pts': yard, 'name': 'Sân trong khu A'})
                c = centroid(yard)
                hw, hd = 7.0, 2.6  # pond 14 m x 5.2 m along the block
                areas.append({'kind': 'water', 'name': 'Hồ cá', 'pts': [
                    [round(c[0] + ux * a * hw + nx * b * hd, 1), round(c[1] + uz * a * hw + nz * b * hd, 1)]
                    for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]})
        a = area(pts)
        zone = zone_of.get(e['id'])
        if lv:
            levels = int(float(lv))
        elif t.get('building') == 'dormitory':
            levels = 5
        elif zone:
            levels = 4 if a > 500 else 3
        else:
            levels = 3 if a > 400 else 2
        b = {
            'id': e['id'], 'zone': zone, 'name': t.get('name'), 'kind': t.get('amenity') or t.get('building'),
            'levels': min(levels, 8), 'estimated': not lv, 'pts': pts,
        }
        if zone in ZONE_LEVELS:
            b['levels'], b['estimated'] = ZONE_LEVELS[zone], False
        b.update(OVERRIDES.get(e['id'], {}))
        if e['id'] in SPLIT:
            for k, (idx, lv) in enumerate(SPLIT[e['id']]):
                part = dict(b, id=e['id'] * 10 + k, levels=lv, estimated=False, pts=[pts[i] for i in idx])
                buildings.append(part)
        else:
            buildings.append(b)
    elif 'highway' in t and t['highway'] in ROAD_W:
        roads.append({'w': ROAD_W[t['highway']], 'foot': t['highway'] in ('footway', 'path', 'cycleway'), 'name': t.get('name'), 'pts': pts, 'id': e['id']})
    else:
        kind = None
        if t.get('natural') == 'water': kind = 'water'
        elif t.get('leisure') in ('pitch',): kind = 'pitch'
        elif t.get('leisure') == 'park' or t.get('landuse') in ('grass', 'meadow') or t.get('leisure') == 'garden': kind = 'grass'
        elif t.get('amenity') == 'parking': kind = 'parking'
        if kind and len(pts) >= 3:
            a = {'kind': kind, 'pts': pts, 'name': t.get('name'), 'id': e['id']}
            if kind == 'parking' and e['id'] in PARKING: a['cover'] = PARKING[e['id']]
            if kind == 'parking' and e['id'] in PARKING_NAMES: a['name'] = PARKING_NAMES[e['id']]
            areas.append(a)

def inset(poly, d):
    # simple miter inset (d > 0 shrinks) for a convex-ish polygon
    n = len(poly)
    area2 = sum(poly[i][0] * poly[i - 1][1] - poly[i - 1][0] * poly[i][1] for i in range(n))
    sg = 1 if area2 > 0 else -1
    lines = []
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz) or 1
        dx, dz = dx / L, dz / L
        nx, nz = -dz * sg, dx * sg            # inward for this orientation
        lines.append((a[0] + nx * d, a[1] + nz * d, dx, dz))
    out = []
    for i in range(n):
        x1, z1, dx1, dz1 = lines[i - 1]
        x2, z2, dx2, dz2 = lines[i]
        den = dx1 * dz2 - dz1 * dx2
        if abs(den) < 1e-6:
            out.append([round(x2, 1), round(z2, 1)]); continue
        t = ((x2 - x1) * dz2 - (z2 - z1) * dx2) / den
        out.append([round(x1 + dx1 * t, 1), round(z1 + dz1 * t, 1)])
    return out


DIRT_FIELDS = [1328750195]
for a in list(areas):
    if a.get('id') in DIRT_FIELDS:
        pts = inset(a['pts'], 7)
        test = inset([[0, 0], [10, 0], [10, 10], [0, 10]], 1)
        if abs(test[0][0] - 1) > 0.01:  # orientation sanity: must shrink
            pts = inset(a['pts'], -7)
        areas.append({'kind': 'dirt', 'pts': pts, 'name': 'Sân đất', 'id': a['id'] * 10})

# running track (multipolygon relation: take its outer ring)
for e in els:
    if e['type'] == 'relation' and e.get('tags', {}).get('leisure') == 'track':
        for m in e.get('members', []):
            if m.get('role') == 'outer' and m.get('geometry'):
                areas.append({'kind': 'track', 'pts': [pt(p) for p in m['geometry']][:-1], 'name': 'Đường chạy'})

nodes = {e['id']: e for e in els if e['type'] == 'node'}
pois = [
    {'id': 'gate-main', 'name': 'Cổng chính', 'sub': 'Đường Nguyễn Lương Bằng', 'kind': 'gate', 'at': pt(nodes[6570393105])},
    {'id': 'gate-side', 'name': 'Cổng phụ', 'sub': 'Đường Ngô Sĩ Liên', 'kind': 'gate', 'at': pt(nodes[8958669214])},
    # Nhà xe khu B: the OSM node sits on the street outside the wall, so the label goes over the roof and you
    # arrive on the path in front of Khu B, facing the bikes. Nhà xe khu E: behind Khu E1, next to the back gate.
    {'id': 'parking-b', 'name': 'Nhà xe khu B', 'sub': 'Nhà xe có mái, trước khu B', 'kind': 'parking', 'at': [-5.6, 135.0], 'spot': [2.0, 122.4], 'look': [-5.6, 135.0]},
    {'id': 'parking-e', 'name': 'Nhà xe khu E', 'sub': 'Sau khu E1, lối ra gầm cầu Ngô Sĩ Liên', 'kind': 'parking', 'at': [22.0, -230.0], 'spot': [55.6, -238.4], 'look': [30.0, -232.0]},
]

# ---- perimeter wall + fences ----
def seg_dist(px, pz, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dz * dz or 1
    t = max(0, min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L))
    return math.hypot(a[0] + dx * t - px, a[1] + dz * t - pz)


def inside_poly(pts, x, z):
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, zi = pts[i]; xj, zj = pts[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def seg_inter(p1, p2, p3, p4):
    d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0])
    if abs(d) < 1e-9: return None
    t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d
    u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d
    if 0 <= t <= 1 and 0 <= u <= 1: return t, u
    return None


vehicle = [r for r in roads if not r['foot']]
ring = out_boundary = (cpts[:-1] if cpts[0] == cpts[-1] else cpts)
NE = len(ring)

# gates: the chain of boundary edges at the gate node that runs across the entrance road
for p in pois:
    if p['kind'] != 'gate': continue
    best = None
    for rd in vehicle:
        for j in range(len(rd['pts']) - 1):
            d = seg_dist(p['at'][0], p['at'][1], rd['pts'][j], rd['pts'][j + 1])
            if best is None or d < best[0]:
                a_, b_ = rd['pts'][j], rd['pts'][j + 1]
                L = math.dist(a_, b_) or 1
                best = (d, ((b_[0] - a_[0]) / L, (b_[1] - a_[1]) / L), rd['w'])
    rdx, rdz = best[1]
    chain = set()
    for i in range(NE):
        e0, e1 = ring[i], ring[(i + 1) % NE]
        L = math.dist(e0, e1) or 1
        ex, ez = (e1[0] - e0[0]) / L, (e1[1] - e0[1]) / L
        if seg_dist(p['at'][0], p['at'][1], e0, e1) < 0.5 and abs(ex * rdx + ez * rdz) < 0.5:
            chain.add(i)
    grown = True
    while grown:  # extend along consecutive edges that also run across the road
        grown = False
        for i in list(chain):
            for j in ((i - 1) % NE, (i + 1) % NE):
                if j in chain: continue
                e0, e1 = ring[j], ring[(j + 1) % NE]
                L = math.dist(e0, e1) or 1
                ex, ez = (e1[0] - e0[0]) / L, (e1[1] - e0[1]) / L
                if abs(ex * rdx + ez * rdz) < 0.5 and L < 12:
                    chain.add(j); grown = True
    idx = sorted(chain)
    # order the chain along the boundary and take its two ends
    start = next(i for i in idx if (i - 1) % NE not in chain)
    end = next(i for i in idx if (i + 1) % NE not in chain)
    A, Bp = ring[start], ring[(end + 1) % NE]
    mx, mz = (A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2
    L = math.dist(A, Bp) or 1
    ux, uz = (Bp[0] - A[0]) / L, (Bp[1] - A[1]) / L
    fx, fz = -uz, ux
    if not inside_poly(ring, mx + fx * 2, mz + fz * 2): fx, fz = -fx, -fz
    p['edges'] = idx
    p['span'] = [[round(A[0], 2), round(A[1], 2)], [round(Bp[0], 2), round(Bp[1], 2)]]
    p['center'] = [round(mx, 2), round(mz, 2)]
    p['dir'] = [round(fx, 4), round(fz, 4)]      # into the campus
    p['width'] = round(L, 2)
gate_edges = {i for p in pois if p['kind'] == 'gate' for i in p['edges']}

# road crossings of the boundary (where the road really goes from inside to outside)
cuts = {i: [] for i in range(NE)}
openings = []
for rd in vehicle:
    for j in range(len(rd['pts']) - 1):
        p1, p2 = rd['pts'][j], rd['pts'][j + 1]
        for i in range(NE):
            if i in gate_edges: continue
            e0, e1 = ring[i], ring[(i + 1) % NE]
            hit = seg_inter(e0, e1, p1, p2)
            if not hit: continue
            t, u = hit
            x = e0[0] + (e1[0] - e0[0]) * t; z = e0[1] + (e1[1] - e0[1]) * t
            L = math.dist(p1, p2) or 1
            dx, dz = (p2[0] - p1[0]) / L, (p2[1] - p1[1]) / L
            if inside_poly(ring, x - dx * 3, z - dz * 3) == inside_poly(ring, x + dx * 3, z + dz * 3):
                continue  # only touches the boundary
            EL = math.dist(e0, e1) or 1
            ex, ez = (e1[0] - e0[0]) / EL, (e1[1] - e0[1]) / EL
            sin = max(0.35, abs(ex * dz - ez * dx))
            half = (rd['w'] / 2 + 1.2) / sin
            cuts[i].append((t - half / EL, t + half / EL))

walls = []
cur = []
for i in range(NE):
    e0, e1 = ring[i], ring[(i + 1) % NE]
    if i in gate_edges:
        if len(cur) > 1: walls.append(cur)
        cur = []
        continue
    EL = math.dist(e0, e1)
    n = max(1, int(EL // 3))
    for k in range(n):
        t0, t1 = k / n, (k + 1) / n
        tm = (t0 + t1) / 2
        p0 = [round(e0[0] + (e1[0] - e0[0]) * t0, 2), round(e0[1] + (e1[1] - e0[1]) * t0, 2)]
        p1 = [round(e0[0] + (e1[0] - e0[0]) * t1, 2), round(e0[1] + (e1[1] - e0[1]) * t1, 2)]
        if any(c0 <= tm <= c1 for c0, c1 in cuts[i]):
            if len(cur) > 1: walls.append(cur)
            cur = []
            continue
        if not cur: cur = [p0]
        cur.append(p1)
if len(cur) > 1: walls.append(cur)
if len(walls) > 1 and walls[0][0] == walls[-1][-1]:
    walls[0] = walls.pop() + walls[0][1:]
# a pillar at every wall end that borders a road opening (gate ends are handled by the gate builder)
gate_ends = [q for p in pois if p['kind'] == 'gate' for q in p['span']]
for w in walls:
    for q in (w[0], w[-1]):
        if all(math.dist(q, g) > 2 for g in gate_ends): openings.append(q)

# fences on both sides of Ngô Sĩ Liên where the street runs through the campus outline
street = [rd for rd in vehicle if rd.get('name') == 'Đường Ngô Sĩ Liên']
others = [rd for rd in vehicle if rd.get('name') != 'Đường Ngô Sĩ Liên']
bpolys = [b['pts'] for b in buildings]
fence_posts = []
for rd in street:
    pts = rd['pts']
    for side in (-1, 1):
        run = []
        for j in range(len(pts) - 1):
            a_, b_ = pts[j], pts[j + 1]
            L = math.dist(a_, b_)
            if L < 0.5: continue
            dx, dz = (b_[0] - a_[0]) / L, (b_[1] - a_[1]) / L
            off = rd['w'] / 2 + 1.4
            nx, nz = -dz * side * off, dx * side * off
            n = max(1, int(L // 3))
            for k in range(n + 1):
                t = k / n
                x = a_[0] + (b_[0] - a_[0]) * t + nx; z = a_[1] + (b_[1] - a_[1]) * t + nz
                ok = inside_poly(ring, x, z) and min(seg_dist(x, z, ring[i], ring[(i + 1) % NE]) for i in range(NE)) > 4
                if ok:
                    ok = not any(seg_dist(x, z, o['pts'][q], o['pts'][q + 1]) < o['w'] / 2 + 1.5 for o in others for q in range(len(o['pts']) - 1))
                if ok:
                    ok = not any(inside_poly(bp, x, z) for bp in bpolys)
                if ok:
                    if run and math.dist(run[-1], (x, z)) < 0.3: continue
                    run.append([round(x, 2), round(z, 2)])
                else:
                    if len(run) > 1:
                        walls.append(run); fence_posts += [run[0], run[-1]]
                    run = []
        if len(run) > 1:
            walls.append(run); fence_posts += [run[0], run[-1]]

# ---- lawn strip with a tree row along the west boundary (Khu X down to Khu M), as on the campus map ----
def offset_polyline(pts, d):
    out = []
    for i, p in enumerate(pts):
        a_ = pts[max(0, i - 1)]; b_ = pts[min(len(pts) - 1, i + 1)]
        dx, dz = b_[0] - a_[0], b_[1] - a_[1]
        L = math.hypot(dx, dz) or 1
        nx, nz = -dz / L, dx / L
        if not inside_poly(ring, p[0] + nx, p[1] + nz): nx, nz = -nx, -nz
        out.append([round(p[0] + nx * d, 2), round(p[1] + nz * d, 2)])
    return out


WEST_CHAIN = [44, 45, 46, 47, 48, 0, 1, 2, 3, 4, 5, 6, 7]
west = [ring[i] for i in WEST_CHAIN]
areas.append({'kind': 'grass', 'name': 'Dải cỏ ven tường', 'id': 2,
              'pts': [[round(x, 2), round(z, 2)] for x, z in west] + offset_polyline(west, 11)[::-1],
              'row': offset_polyline(west, 5.5)})

# ---- Ngô Sĩ Liên railway overpass (cầu vượt đường sắt Ngô Sĩ Liên) and everything around it ----------------
# The real bridge (Km 784+425 of the North–South railway, opened 27-10-2013): 7 spans of 20 m prestressed slab
# girders (145.35 m), 11 m wide = 7 m carriageway + 2 x 1.5 m footways + 2 x 0.5 m railings, clearance 4.75 m,
# with a service lane (đường gom) on each side. OSM tags ways 372422252 + 968341217 (about 300 m) as the bridge
# and draws the two lanes almost on top of it, so the lanes are re-laid beside the ramps here.
# Frame used below: s = metres along the bridge from the southern junction, t = metres to the right (stadium side).
road_by_id = {r['id']: r for r in roads}
_p0 = road_by_id[372422252]['pts'][0]
_p1 = road_by_id[968341217]['pts'][-1]
_L = math.dist(_p0, _p1)
_n = (-(_p1[1] - _p0[1]) / _L, (_p1[0] - _p0[0]) / _L)
BA = [_p0[0] + _n[0] * 1.0, _p0[1] + _n[1] * 1.0]   # axis 1 m to the right: room for the lane between Khu E2 and the ramp
BL = math.dist(BA, _p1)
bu = ((_p1[0] - BA[0]) / BL, (_p1[1] - BA[1]) / BL)
bn = (-bu[1], bu[0])


def BW(s_, t_):
    return [round(BA[0] + bu[0] * s_ + bn[0] * t_, 2), round(BA[1] + bu[1] * s_ + bn[1] * t_, 2)]


def BF(p):
    return ((p[0] - BA[0]) * bu[0] + (p[1] - BA[1]) * bu[1], (p[0] - BA[0]) * bn[0] + (p[1] - BA[1]) * bn[1])


# deck profile: 5.5 % up from the junction, crest curve over the railway (about 7 m), 6.5 % down, sag curves at both feet
G1, G2, SAG, CREST, S_UP, S_CREST = 0.055, 0.065, 20.0, 80.0, 4.0, 122.5
_h0 = G1 * SAG / 2
_h1 = _h0 + G1 * (S_CREST - S_UP - SAG)
_h2 = _h1 + G1 * CREST - (G1 + G2) / 2 * CREST
_s2 = S_CREST + CREST
_s3 = _s2 + (_h2 - G2 * SAG / 2) / G2
S_DOWN = _s3 + SAG


def deck_h(s_):
    if s_ <= S_UP or s_ >= S_DOWN: return 0.0
    if s_ <= S_UP + SAG: return G1 * (s_ - S_UP) ** 2 / (2 * SAG)
    if s_ <= S_CREST: return _h0 + G1 * (s_ - S_UP - SAG)
    if s_ <= _s2:
        d_ = s_ - S_CREST
        return _h1 + G1 * d_ - (G1 + G2) / (2 * CREST) * d_ * d_
    if s_ <= _s3: return _h2 - G2 * (s_ - _s2)
    return G2 * (S_DOWN - s_) ** 2 / (2 * SAG)


SPANS = [72.5 + 20 * k for k in range(8)]          # abutment, 6 piers, abutment (the railway runs under span 5)
LANE_L, LANE_R, LINK_S, WALL_T = -7.9, 8.4, 157.5, 11.9
_brk = sorted(set([S_UP + 4 * k for k in range(6)] + [S_CREST + 4 * k for k in range(21)] + [round(_s3 + 4 * k, 2) for k in range(6)]))
bridge = {
    'name': 'Cầu vượt Ngô Sĩ Liên',
    'a': [round(BA[0], 2), round(BA[1], 2)], 'b': _p1,
    'profile': [[round(v, 2), round(deck_h(v), 3)] for v in _brk],
    'spans': SPANS, 'lanes': [LANE_L, LANE_R], 'link': LINK_S,
}

# roads: the deck replaces the two bridge ways; the lanes run beside the ramps and meet under span 5
road_by_id[372422252].update(pts=[_p0, BW(S_UP, 0)], name='Đường Ngô Sĩ Liên')
road_by_id[968341217].update(pts=[BW(S_UP, 0), BW(round(S_DOWN, 2), 0)], w=11, name='Cầu vượt Ngô Sĩ Liên', bridge=True)
roads.append({'w': 8, 'foot': False, 'name': 'Đường Ngô Sĩ Liên', 'pts': [BW(round(S_DOWN, 2), 0), _p1]})
road_by_id[968341207].update(pts=[_p0, BW(2.5, LANE_L), BW(LINK_S, LANE_L)], w=4)                    # left lane: one way, out only
_right = road_by_id[694558703]
roads.append({'w': 5, 'foot': False, 'name': None, 'pts': _right['pts'][:2] + [BW(LINK_S, LANE_R)]})      # along the railway, east
_right.update(pts=[BW(0.2, LANE_R), BW(LINK_S, LANE_R)], w=5)                                          # right lane: the way in
roads.append({'w': 5, 'foot': False, 'name': None, 'pts': [BW(LINK_S, LANE_L), BW(LINK_S, LANE_R)]})    # U-turn under the bridge
road_by_id[896418615]['pts'][-1] = BW(LINK_S, LANE_L)                                                  # along the railway, west
_far = road_by_id[699674199]                                                                           # lane beside the far ramp
_far['pts'] = [_far['pts'][0], BW(173.5, 9.4), BW(180, LANE_R), BW(296, LANE_R)] + _far['pts'][6:]
road_by_id[1551931321]['pts'][-1] = BW(180, LANE_R)                                                    # passage under span 6

# railway (not a road: drawn as ballast, sleepers and rails); roads that hug it are pushed 5.2 m off the track
rail_all = [pt(p) for p in ways[52582901]['geometry']]
rail = [p for i, p in enumerate(rail_all) if -1000 <= p[0] <= 900 or (0 < i < len(rail_all) - 1 and (-1000 <= rail_all[i - 1][0] <= 900 or -1000 <= rail_all[i + 1][0] <= 900))]


def rail_near(p):
    best = (1e9, None)
    for i in range(len(rail_all) - 1):
        a_, b_ = rail_all[i], rail_all[i + 1]
        dx, dz = b_[0] - a_[0], b_[1] - a_[1]
        L = dx * dx + dz * dz or 1
        t = max(0, min(1, ((p[0] - a_[0]) * dx + (p[1] - a_[1]) * dz) / L))
        q = (a_[0] + dx * t, a_[1] + dz * t)
        d_ = math.dist(p, q)
        if d_ < best[0]: best = (d_, q)
    return best


RAIL_GAP = 5.2
for r in roads:
    if r['foot'] or r.get('bridge'): continue
    for p in r['pts']:
        d_, q = rail_near(p)
        if 0.6 < d_ < RAIL_GAP:
            p[0] = round(q[0] + (p[0] - q[0]) * RAIL_GAP / d_, 1)
            p[1] = round(q[1] + (p[1] - q[1]) * RAIL_GAP / d_, 1)


def run(a_, b_, step=3.0):
    n = max(1, int(math.dist(a_, b_) // step))
    return [[round(a_[0] + (b_[0] - a_[0]) * k / n, 2), round(a_[1] + (b_[1] - a_[1]) * k / n, 2)] for k in range(n + 1)]


def in_zone(p):
    s_, t_ = BF(p)
    return 5 < s_ < 160 and -13.5 < t_ < 0


# fences: the generated ones between the lane and the old flat road go; Khu E keeps one fence from Khu E2 to its
# back gate (the gap to the boundary wall = lối ra gầm cầu); the stadium side gets a wall along the right lane.
gate_e = [59.75, -240.72]
walls = [w for w in walls if not all(in_zone(p) for p in w)]
posts_all = [q for q in (openings + fence_posts) if not in_zone(q) or math.dist(q, [58.3, -245.3]) < 0.5]
e2 = next(b for b in buildings if b['zone'] == 'E2')
e2_corner = max((p for p in e2['pts'] if BF(p)[0] > 60), key=lambda p: BF(p)[0])   # north-east corner, lane side
walls.append(run(e2_corner, gate_e))
posts_all.append(gate_e)
# dormitory boundary wall: it now starts where the right lane's wall meets it
_end = BW(147.75, 8.98)
corner = None
for w in walls:
    for rev in (False, True):
        ww = w[::-1] if rev else w
        if corner is None and math.dist(ww[0], _end) < 3:
            k = next(i for i in range(len(ww) - 1) if BF(ww[i + 1])[1] >= WALL_T)
            (s0, t0), (s1, t1) = BF(ww[k]), BF(ww[k + 1])
            f = (WALL_T - t0) / (t1 - t0)
            corner = [round(ww[k][0] + (ww[k + 1][0] - ww[k][0]) * f, 2), round(ww[k][1] + (ww[k + 1][1] - ww[k][1]) * f, 2)]
            posts_all = [q for q in posts_all if math.dist(q, ww[0]) > 0.5]
            w[:] = ([corner] + ww[k + 1:]) if not rev else (ww[k + 1:][::-1] + [corner])
assert corner, 'dormitory wall end not found'
gate_d = [BW(-2.8, WALL_T), BW(3.2, WALL_T)]            # dormitory gate on the service road, now east of the right lane
walls.append(run(gate_d[1], corner))
wall_h = {len(walls) - 1: 2.8}                            # the stadium wall is taller: the pitch is hidden from the lane
_old = [130.29, -104.45]                                  # end of the street fence south of the junction
_done = False
for w in walls:
    if math.dist(w[-1], _old) < 1: w.extend(run(w[-1], gate_d[0])[1:]); _done = True
    elif math.dist(w[0], _old) < 1: w[:0] = run(gate_d[0], w[0])[:-1]; _done = True
assert _done, 'street fence end not found'
posts_all = [q for q in posts_all if math.dist(q, _old) > 1] + gate_d

# no-entry signs at the mouth of the left lane (you go in on the right lane and come out here)
signs = [{'kind': 'no-entry', 'at': BW(7.0, t_), 'dir': [round(-bu[0], 4), round(-bu[1], 4)]} for t_ in (-5.72, -10.18)]
pois.append({'id': 'bridge', 'name': 'Cầu vượt Ngô Sĩ Liên', 'sub': 'Cầu vượt đường sắt · gầm cầu là chỗ tập văn nghệ', 'kind': 'bridge',
             'at': BW(132, 0), 'h': 11, 'spot': BW(121, -1.5), 'look': BW(140, 1.5)})

missing = [i for ids in ZONES.values() for i in ids if i not in ways]
assert not missing, missing

out = {
    'source': '© OpenStreetMap contributors (ODbL)',
    'boundary': cpts[:-1] if cpts[0] == cpts[-1] else cpts,
    'buildings': buildings, 'roads': [{k: v for k, v in r.items() if k != 'id'} for r in roads], 'areas': areas, 'pois': pois, 'walls': walls,
    'posts': [[round(x, 2), round(z, 2)] for x, z in posts_all],
    'wallH': [wall_h.get(i) for i in range(len(walls))], 'bridge': bridge, 'rail': rail, 'signs': signs,
}
os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
with open(os.path.join(ROOT, 'data', 'campus.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print(len(buildings), 'buildings,', len(roads), 'roads,', len(areas), 'areas,', len(walls), 'wall runs', sum(len(w) for w in walls), 'pts; box', [round(v) for v in BOX])
print('zones:', sorted({b['zone'] for b in buildings if b['zone']}))
