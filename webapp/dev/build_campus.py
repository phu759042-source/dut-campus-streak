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
    'N': [118777693, 1328750179, 1328750180, 1328750181, 968341236],
    'K': [118777665], 'P': [1328739093], 'I': [968341227, 1328750185], 'D': [968341235],
    'G': [968341231], 'A': [1043659296, 1043659297, 1043659298], 'E1': [968341226], 'S': [1551964032],
    'E2': [968341885], 'C1': [968341220, 968341225, 968341209], 'C2': [968341210], 'C3': [968341233],
    'X': [1328750183, 1328750184],
}

# Real data from students (overrides OSM / estimates).
OVERRIDES = {
    1551964032: {'levels': 10, 'height': 42, 'floor_area': 7330, 'estimated': False},  # Nhà S
}
# Khu A: OSM draws the two back blocks far too deep and swallows the courtyards (fish ponds, trees).
# Keep only a ~12 m strip at the back of each block; the rest becomes a courtyard with a pond.
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
        b.update(OVERRIDES.get(e['id'], {}))
        buildings.append(b)
    elif 'highway' in t and t['highway'] in ROAD_W:
        roads.append({'w': ROAD_W[t['highway']], 'foot': t['highway'] in ('footway', 'path', 'cycleway'), 'name': t.get('name'), 'pts': pts})
    else:
        kind = None
        if t.get('natural') == 'water': kind = 'water'
        elif t.get('leisure') in ('pitch',): kind = 'pitch'
        elif t.get('leisure') == 'park' or t.get('landuse') in ('grass', 'meadow') or t.get('leisure') == 'garden': kind = 'grass'
        elif t.get('amenity') == 'parking': kind = 'parking'
        if kind and len(pts) >= 3:
            areas.append({'kind': kind, 'pts': pts, 'name': t.get('name')})

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
    {'id': 'parking-b', 'name': 'Nhà xe khu B', 'kind': 'parking', 'at': pt(nodes[1964068718])},
]

missing = [i for ids in ZONES.values() for i in ids if i not in ways]
assert not missing, missing

out = {
    'source': '© OpenStreetMap contributors (ODbL)',
    'boundary': cpts[:-1] if cpts[0] == cpts[-1] else cpts,
    'buildings': buildings, 'roads': roads, 'areas': areas, 'pois': pois,
}
os.makedirs(os.path.join(ROOT, 'data'), exist_ok=True)
with open(os.path.join(ROOT, 'data', 'campus.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
print(len(buildings), 'buildings,', len(roads), 'roads,', len(areas), 'areas; box', [round(v) for v in BOX])
print('zones:', sorted({b['zone'] for b in buildings if b['zone']}))
