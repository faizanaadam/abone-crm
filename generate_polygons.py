import json
import requests
import numpy as np
from scipy.spatial import ConvexHull

URL = "https://jrvghcxtrpdmyhgjypms.supabase.co/rest/v1"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpydmdoY3h0cnBkbXloZ2p5cG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDA4ODIsImV4cCI6MjA5MjY3Njg4Mn0.UVlzfHUnkpWQPt-RAmK9m2cpoX20GQNsEPs9m1w8bto"

HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

with open('processed_doctors.json', 'r', encoding='utf-8') as f:
    doctors = json.load(f)

# Group by zone
zone_coords = {}
for doc in doctors:
    z = doc.get("zone_id")
    lat = doc.get("latitude")
    lon = doc.get("longitude")
    if z and lat is not None and lon is not None:
        try:
            lat_f = float(lat)
            lon_f = float(lon)
            if not np.isnan(lat_f) and not np.isnan(lon_f):
                if z not in zone_coords:
                    zone_coords[z] = []
                zone_coords[z].append([lat_f, lon_f])
        except (ValueError, TypeError):
            pass

for z_id, coords in zone_coords.items():
    if len(coords) >= 3:
        pts = np.array(coords)
        hull = ConvexHull(pts)
        
        # Extract the vertices in counter-clockwise order
        hull_pts = pts[hull.vertices]
        
        # Add buffer slightly (expand outward by 0.005 degrees ~ 500m)
        center = np.mean(hull_pts, axis=0)
        expanded = []
        for p in hull_pts:
            dir_vec = p - center
            # Simple outward scaling
            expanded_pt = center + dir_vec * 1.15
            expanded.append([float(expanded_pt[0]), float(expanded_pt[1])])
            
        # Add first point to end to close polygon
        expanded.append(expanded[0])
        
        # Update Supabase
        r = requests.patch(f"{URL}/zones?id=eq.{z_id}", headers=HEADERS, json={"polygon_coords": expanded})
        if r.status_code in (200, 204):
            print(f"Updated Zone {z_id} polygon.")
        else:
            print(f"Failed to update Zone {z_id}: {r.text}")
    else:
        print(f"Zone {z_id} does not have enough points for a polygon.")

print("Polygon generation complete.")
