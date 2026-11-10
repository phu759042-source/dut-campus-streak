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
        buildings.append({
            'id': e['id'], 'zone': zone, 'name': t.get('name'), 'kind': t.get('amenity') or t.get('building'),
            'levels': min(levels, 8), 'estimated': not lv, 'pts': pts,
        })
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
