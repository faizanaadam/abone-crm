import pandas as pd
import json
import time
import os
import sys
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError
from geopy.distance import geodesic
import math

sys.stdout.reconfigure(encoding='utf-8')

CACHE_FILE = 'geocache.json'
if os.path.exists(CACHE_FILE):
    with open(CACHE_FILE, 'r', encoding='utf-8') as f:
        geocache = json.load(f)
else:
    geocache = {}

def save_cache():
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(geocache, f, ensure_ascii=False, indent=2)

geolocator = Nominatim(user_agent="abone_crm_app_v2")

def get_coordinates(search_query):
    if not isinstance(search_query, str) or not search_query.strip():
        return None, None
        
    search_query = search_query.strip()
    
    if search_query in geocache:
        return geocache[search_query].get('lat'), geocache[search_query].get('lon')

    try:
        time.sleep(1) # Strict 1-second delay
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

ZONES = {
    "1": {"name": "Hebbal / Yelahanka", "lat": 13.044796, "lon": 77.5910972},
    "2": {"name": "Yeshwanthpur / Peenya", "lat": 13.0243, "lon": 77.5401},
    "3": {"name": "Malleshwaram / Rajajinagar", "lat": 13.00764, "lon": 77.5640167},
    "4": {"name": "Central / MG Road", "lat": 12.9755264, "lon": 77.6067902},
    "5": {"name": "Indiranagar / Domlur", "lat": 12.9794595, "lon": 77.6406313},
    "6": {"name": "Whitefield / Marathahalli", "lat": 12.9863497, "lon": 77.7325809},
    "7": {"name": "HSR / Sarjapur", "lat": 12.9137415, "lon": 77.6374623},
    "8": {"name": "Jayanagar / JP Nagar", "lat": 12.9265737, "lon": 77.5835041},
    "9": {"name": "Bannerghatta / Electronic City", "lat": 12.8443019, "lon": 77.6632919},
    "10": {"name": "RR Nagar / Kengeri", "lat": 12.9274, "lon": 77.5156}
}

print("\nReading Excel...")
xl = pd.ExcelFile('C:/Users/mfaiz/Downloads/Abone_Bangalore_MASTER_CLEAN.xlsx')
df = xl.parse('Complete Master')
df_loc = xl.parse('All Locations')

# Create a mapping from Doctor ID or Doctor Name to Locality
# Some rows might share doctor names, but let's map by 'Doctor Name' since Doctor ID might vary
locality_map = {}
for _, row in df_loc.iterrows():
    if pd.notna(row['Doctor Name']) and pd.notna(row['Locality']):
        locality_map[row['Doctor Name'].strip()] = row['Locality'].strip()

lats, lons, is_approx, zone_ids = [], [], [], []

print(f"Total rows to process: {len(df)}")

for index, row in df.iterrows():
    if index % 50 == 0:
        print(f"Processed {index} / {len(df)}")
        
    name = str(row['Doctor Name']).strip() if pd.notna(row['Doctor Name']) else ""
    address = None
    if pd.notna(row.get('Hospital Address')):
        address = str(row['Hospital Address']).split('|')[0].strip()
    elif pd.notna(row.get('Clinic Location')):
        address = str(row['Clinic Location']).split('|')[0].strip()
        
    clinic_name = str(row.get('Clinic Name')).strip() if pd.notna(row.get('Clinic Name')) else ""
    area = locality_map.get(name, "")
    
    lat, lon = None, None
    approx = False
    
    # Primary: Exact Full Address
    if address:
        lat, lon = get_coordinates(address + ", Bangalore")
        
    # Fallback 1: Clinic + Area
    if (lat is None or lon is None) and clinic_name and area:
        lat, lon = get_coordinates(f"{clinic_name}, {area}, Bangalore")
        if lat is not None:
            approx = True
            
    # Fallback 2: Area Center
    if (lat is None or lon is None) and area:
        lat, lon = get_coordinates(f"{area}, Bangalore")
        if lat is not None:
            approx = True
            
    lats.append(lat)
    lons.append(lon)
    is_approx.append(approx)
    
    # Calculate nearest zone
    if lat is not None and lon is not None:
        min_dist = float('inf')
        closest_zone = None
        for z_id, z_info in ZONES.items():
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
df['is_approximate'] = is_approx

# Export Data
export_data = df.to_dict(orient='records')
with open('processed_doctors.json', 'w', encoding='utf-8') as f:
    json.dump(export_data, f, ensure_ascii=False, indent=2)

print("Done! Data saved to processed_doctors.json")
