import pandas as pd
import json
import time
import os
import sys
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
from geopy.distance import geodesic
from sklearn.cluster import KMeans
import matplotlib.pyplot as plt
import numpy as np
import threading

sys.stdout.reconfigure(encoding='utf-8')

# 1. Setup cache
CACHE_FILE = 'geocache.json'
if os.path.exists(CACHE_FILE):
    with open(CACHE_FILE, 'r', encoding='utf-8') as f:
        geocache = json.load(f)
else:
    geocache = {}

def save_cache():
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(geocache, f, ensure_ascii=False, indent=2)

geolocator = Nominatim(user_agent="abone_crm_app_v1")

def get_coordinates(address):
    if not isinstance(address, str) or not address.strip():
        return None, None
        
    # Simplify address for better geocoding
    search_query = address.strip()
    
    if search_query in geocache:
        return geocache[search_query].get('lat'), geocache[search_query].get('lon')

    try:
        time.sleep(1) # Strict 1-second delay for Nominatim
        location = geolocator.geocode(search_query + ", Bangalore", timeout=10)
        if not location:
            # Try without "Bangalore" if it already has it, or just basic search
            time.sleep(1)
            location = geolocator.geocode(search_query, timeout=10)
            
        if location:
            geocache[search_query] = {'lat': location.latitude, 'lon': location.longitude}
            save_cache()
            return location.latitude, location.longitude
        else:
            geocache[search_query] = {'lat': None, 'lon': None}
            save_cache()
            return None, None
    except (GeocoderTimedOut, GeocoderServiceError) as e:
        print(f"Error geocoding {search_query}: {e}")
        return None, None

# 2. Define Zones
ZONES = {
    "1": {"name": "Hebbal / Yelahanka", "query": "Hebbal flyover, Bangalore"},
    "2": {"name": "Yeshwanthpur / Peenya", "query": "Yeshwanthpur circle, Bangalore"},
    "3": {"name": "Malleshwaram / Rajajinagar", "query": "Mantri Mall Malleshwaram, Bangalore"},
    "4": {"name": "Central / MG Road", "query": "MG Road metro, Bangalore"},
    "5": {"name": "Indiranagar / Domlur", "query": "100 Feet Road Indiranagar, Bangalore"},
    "6": {"name": "Whitefield / Marathahalli", "query": "Whitefield ITPL, Bangalore"},
    "7": {"name": "HSR / Sarjapur", "query": "HSR Layout BDA complex, Bangalore"},
    "8": {"name": "Jayanagar / JP Nagar", "query": "Jayanagar 4th Block, Bangalore"},
    "9": {"name": "Bannerghatta / Electronic City", "query": "Electronic City Phase 1, Bangalore"},
    "10": {"name": "RR Nagar / Kengeri", "query": "RR Nagar circle, Bangalore"}
}

print("Geocoding Zone Hubs...")
for z_id, z_info in ZONES.items():
    if z_id == "10":
        lat, lon = 12.9274, 77.5156
    elif z_id == "2":
        lat, lon = 13.0243, 77.5401
    else:
        lat, lon = get_coordinates(z_info["query"])
    z_info["lat"] = lat
    z_info["lon"] = lon
    print(f"Zone {z_id} ({z_info['name']}): {lat}, {lon}")

# 3. Read Data
print("\nReading Excel...")
df = pd.read_excel('Abone_Bangalore_MASTER.xlsx', sheet_name='Bangalore Ortho Doctors', header=2)
# The first row actually is data because the column names are row 2.
# We will drop columns that are purely NaN and rows that are purely NaN.
df = df.dropna(how='all')

# Rename columns properly (some names are messy)
cols = list(df.columns)
df.rename(columns={cols[0]: 'ID'}, inplace=True)

print(f"Total rows to process: {len(df)}")

# 4. Geocoding
lats = []
lons = []
zone_ids = []

print("Geocoding doctors... this will take some time.")
for index, row in df.iterrows():
    # Progress
    if index % 50 == 0:
        print(f"Processed {index} / {len(df)}")
        
    address = None
    if pd.notna(row.get('Unnamed: 10')):
        address = str(row['Unnamed: 10']).split('|')[0].strip()
    elif pd.notna(row.get('Unnamed: 22')):
        address = str(row['Unnamed: 22']).split('|')[0].strip()
    elif pd.notna(row.get('Unnamed: 17')):
        address = str(row['Unnamed: 17']).split('|')[0].strip()
        
    lat, lon = None, None
    if address:
        lat, lon = get_coordinates(address)
        
    lats.append(lat)
    lons.append(lon)
    
    # Calculate nearest zone
    if lat is not None and lon is not None:
        min_dist = float('inf')
        closest_zone = None
        for z_id, z_info in ZONES.items():
            if z_info["lat"] and z_info["lon"]:
                dist = geodesic((lat, lon), (z_info["lat"], z_info["lon"])).km
                if dist < min_dist:
                    min_dist = dist
                    closest_zone = z_id
        zone_ids.append(closest_zone)
    else:
        zone_ids.append(None)

df['latitude'] = lats
df['longitude'] = lons
df['zone_id'] = zone_ids
df['area_id'] = None

# 5. K-Means for Area Clustering
print("\nPerforming Micro-clustering (Areas)...")
colors = plt.cm.get_cmap('tab10', 10)
plt.figure(figsize=(12, 10))

for z_id, z_info in ZONES.items():
    zone_mask = df['zone_id'] == z_id
    zone_df = df[zone_mask]
    
    if len(zone_df) > 0:
        # Extract valid coordinates
        coords = zone_df[['latitude', 'longitude']].dropna().values
        
        if len(coords) > 0:
            n_clusters = min(10, len(coords))
            if n_clusters > 1:
                kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
                labels = kmeans.fit_predict(coords)
                
                # Assign back to dataframe
                coord_idx = 0
                for idx in zone_df.index:
                    if pd.notna(df.at[idx, 'latitude']):
                        # Areas 1-10
                        df.at[idx, 'area_id'] = int(labels[coord_idx]) + 1
                        coord_idx += 1
                        
            elif n_clusters == 1:
                for idx in zone_df.index:
                    if pd.notna(df.at[idx, 'latitude']):
                        df.at[idx, 'area_id'] = 1
            
            # Plot
            valid_zone_df = df[zone_mask].dropna(subset=['latitude', 'longitude'])
            plt.scatter(valid_zone_df['longitude'], valid_zone_df['latitude'], 
                        label=f"Zone {z_id}: {z_info['name']}",
                        alpha=0.6, s=20)

# Plot Zone Centers
for z_id, z_info in ZONES.items():
    if z_info["lat"] and z_info["lon"]:
        plt.scatter(z_info["lon"], z_info["lat"], color='black', marker='X', s=150, edgecolors='white')
        plt.text(z_info["lon"], z_info["lat"], z_id, fontsize=12, weight='bold')

plt.title('Bangalore Doctors - Zone Clustering (10 Hubs)')
plt.xlabel('Longitude')
plt.ylabel('Latitude')
plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
plt.tight_layout()
plt.savefig('clustering_plot.png')
print("Saved clustering_plot.png")

# 6. Export Final Data
print("Exporting data...")
# Clean up before export
export_df = df.copy()
# Convert to dict format
export_data = export_df.to_dict(orient='records')

with open('processed_doctors.json', 'w', encoding='utf-8') as f:
    json.dump(export_data, f, ensure_ascii=False, indent=2)

print("Done! Data saved to processed_doctors.json")
