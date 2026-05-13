#!/usr/bin/env python3
"""
Generate a Leaflet map of Budapest metro and tram lines from GTFS data.
Outputs: dist/map_lines.html
"""

import csv
import os
import folium

GTFS = os.path.join(os.path.dirname(__file__), "../data/budapest_gtfs")
OUT  = os.path.join(os.path.dirname(__file__), "../dist/map_lines.html")

# ── 1. Load routes filtered by type ─────────────────────────────────────────
TARGET_TYPES = {
    "1": "Metro",
    "0": "Tram",
}

routes = {}   # route_id → {short_name, color, text_color, type_label}
with open(f"{GTFS}/routes.txt") as f:
    for row in csv.DictReader(f):
        if row["route_type"] in TARGET_TYPES:
            routes[row["route_id"]] = {
                "name":       row["route_short_name"],
                "color":      f"#{row['route_color']}",
                "text_color": f"#{row['route_text_color']}",
                "type":       TARGET_TYPES[row["route_type"]],
                "desc":       row["route_desc"],
            }

print(f"Routes loaded: {len(routes)} (metro + tram)")

# ── 2. Map route_id → shape_ids (one canonical shape per direction) ──────────
# Keep the first shape_id seen per (route_id, direction_id) pair
route_shapes = {}   # route_id → set of shape_ids
with open(f"{GTFS}/trips.txt") as f:
    for row in csv.DictReader(f):
        rid = row["route_id"]
        if rid not in routes:
            continue
        sid = row["shape_id"]
        if not sid:
            continue
        key = (rid, row["direction_id"])
        if key not in route_shapes:
            route_shapes[key] = sid

needed_shapes = set(route_shapes.values())
print(f"Shapes needed: {len(needed_shapes)}")

# ── 3. Load only the needed shape polylines ──────────────────────────────────
shapes = {}   # shape_id → [(lat, lon), ...]
with open(f"{GTFS}/shapes.txt") as f:
    for row in csv.DictReader(f):
        sid = row["shape_id"]
        if sid not in needed_shapes:
            continue
        if sid not in shapes:
            shapes[sid] = []
        shapes[sid].append((
            int(row["shape_pt_sequence"]),
            float(row["shape_pt_lat"]),
            float(row["shape_pt_lon"]),
        ))

# Sort each shape by sequence
for sid in shapes:
    shapes[sid].sort(key=lambda x: x[0])

print(f"Shapes loaded: {len(shapes)}")

# ── 4. Build folium map ───────────────────────────────────────────────────────
m = folium.Map(
    location=[47.4979, 19.0402],   # Budapest city centre
    zoom_start=12,
    tiles="CartoDB dark_matter",
)

# Layer groups by type
layer_metro = folium.FeatureGroup(name="Metro", show=True)
layer_tram  = folium.FeatureGroup(name="Tram",  show=True)

drawn_shapes = set()   # avoid drawing the same polyline twice

for (route_id, direction), shape_id in sorted(route_shapes.items()):
    if shape_id not in shapes:
        continue
    if shape_id in drawn_shapes:
        continue
    drawn_shapes.add(shape_id)

    r      = routes[route_id]
    coords = [(lat, lon) for _, lat, lon in shapes[shape_id]]
    color  = r["color"]
    label  = f"{r['type']} {r['name']}"

    polyline = folium.PolyLine(
        locations=coords,
        color=color,
        weight=5 if r["type"] == "Metro" else 3,
        opacity=0.9,
        tooltip=label,
        popup=folium.Popup(
            f"<b>{r['type']} {r['name']}</b><br><small>{r['desc']}</small>",
            max_width=250,
        ),
    )

    if r["type"] == "Metro":
        polyline.add_to(layer_metro)
    else:
        polyline.add_to(layer_tram)

layer_metro.add_to(m)
layer_tram.add_to(m)
folium.LayerControl().add_to(m)

# ── 5. Save ───────────────────────────────────────────────────────────────────
os.makedirs(os.path.dirname(OUT), exist_ok=True)
m.save(OUT)
print(f"Saved → {OUT}")
