import json
import requests
import math

URL = "https://jrvghcxtrpdmyhgjypms.supabase.co/rest/v1"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpydmdoY3h0cnBkbXloZ2p5cG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDA4ODIsImV4cCI6MjA5MjY3Njg4Mn0.UVlzfHUnkpWQPt-RAmK9m2cpoX20GQNsEPs9m1w8bto"

HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

def clean_val(v):
    if v is None: return None
    if isinstance(v, float) and math.isnan(v): return None
    return str(v) if not isinstance(v, (int, float, bool)) else v

# Load data
with open('processed_doctors.json', 'r', encoding='utf-8') as f:
    doctors_data = json.load(f)

# 1. Seed Zones
print("Seeding Zones...")
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

zone_payload = [{"id": z_id, "name": z_info["name"], "lat": z_info["lat"], "lon": z_info["lon"]} for z_id, z_info in ZONES.items()]
r = requests.post(f"{URL}/zones", headers=HEADERS, json=zone_payload)
if r.status_code not in (200, 201):
    print(f"Error seeding zones: {r.text}")

# 2. Seed Areas
print("Seeding Areas...")
area_payload = []
for z_id in ZONES.keys():
    for a_id in range(1, 11):
        area_id = f"{z_id}_{a_id}"
        area_payload.append({"id": area_id, "zone_id": z_id, "name": f"Area {a_id}"})
r = requests.post(f"{URL}/areas", headers=HEADERS, json=area_payload)

# 3. Seed Doctors
print("Seeding Doctors...")
doc_payload = []
for row in doctors_data:
    # Handle area_id to match the zones
    z_id = clean_val(row.get('zone_id'))
    a_id_num = clean_val(row.get('area_id'))
    a_id = f"{z_id}_{int(float(a_id_num))}" if z_id and a_id_num else None

    # Handle PostGIS point format: 'SRID=4326;POINT(lon lat)'
    lat = clean_val(row.get('latitude'))
    lon = clean_val(row.get('longitude'))
    location = None
    if lat is not None and lon is not None:
        location = f"SRID=4326;POINT({lon} {lat})"

    doc = {
        "koa_no": clean_val(row.get('KOA No')),
        "name": clean_val(row.get('Doctor Name')) or "Unknown",
        "specialization": clean_val(row.get('Specialization')),
        "role": clean_val(row.get('Role')),
        "phone": clean_val(row.get('Mobile Number(s)')),
        "email": clean_val(row.get('Email')),
        "hospitals_practice": clean_val(row.get('Hospital(s) / Practice')),
        "hospital_address": clean_val(row.get('Hospital Address')),
        "hospital_rating": clean_val(row.get('Hospital Rating')),
        "hospital_reviews": clean_val(row.get('Hospital Reviews')),
        "hospital_category": clean_val(row.get('Hospital Category')),
        "hospital_website": clean_val(row.get('Hospital Website')),
        "hospital_maps_link": clean_val(row.get('Google Maps Link')),
        "clinic_name": clean_val(row.get('Clinic Name')),
        "clinic_location": clean_val(row.get('Clinic Location')),
        "consultation_days": clean_val(row.get('Consultation Days')),
        "consultation_timing": clean_val(row.get('Consultation Timing')),
        "approx_surgeries": clean_val(row.get('Approx. Surgeries / Month')),
        "pct_using_abone": clean_val(row.get('% Using Abone')),
        "full_address": None,
        "ai_confidence": clean_val(row.get('AI Confidence')),
        "original_notes": clean_val(row.get('Notes')),
        "source": clean_val(row.get('Source')),
        "lat": lat,
        "lon": lon,
        "location": location,
        "zone_id": str(z_id) if z_id else None,
        "area_id": a_id,
        "is_approximate": bool(row.get("is_approximate", False))
    }
    
    # Filter out empty records or the header record (where name is "Doctor Name")
    if doc["name"] == "Doctor Name" or doc["name"] == "Unknown":
        continue
        
    doc_payload.append(doc)

# Batch insert due to possible limits
batch_size = 100
for i in range(0, len(doc_payload), batch_size):
    batch = doc_payload[i:i+batch_size]
    r = requests.post(f"{URL}/doctors", headers=HEADERS, json=batch)
    if r.status_code not in (200, 201):
        print(f"Error seeding doctors batch {i}: {r.text}")
    else:
        print(f"Seeded batch {i} to {i+len(batch)}")

print("Done Seeding!")
