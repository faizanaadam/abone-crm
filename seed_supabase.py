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
    s = str(v).strip()
    if s in ('', 'nan', 'None', 'NaN'): return None
    return s

def clean_float(v):
    if v is None: return None
    try:
        f = float(v)
        if math.isnan(f): return None
        return f
    except (TypeError, ValueError):
        return None

def classify_spec(raw):
    """Classify the raw Specialization string into our 4 filter categories."""
    if not raw: return 'General'
    s = raw.lower().strip()
    if 'exclude' in s: return 'Exclude'
    if 'spine' in s and 'trauma' in s: return 'Both'
    if 'spine' in s: return 'Spine'
    if 'trauma' in s: return 'Trauma'
    return 'General'

# =============================================
# STEP 0: DELETE ALL existing doctors
# =============================================
print("Deleting all existing doctors...")
# Delete in batches — fetch IDs and delete
page = 0
total_deleted = 0
while True:
    r = requests.get(
        f"{URL}/doctors?select=id&limit=1000",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    )
    ids = [row['id'] for row in r.json()]
    if not ids:
        break
    # Delete these IDs
    id_list = ",".join(str(i) for i in ids)
    rd = requests.delete(
        f"{URL}/doctors?id=in.({id_list})",
        headers={**HEADERS}
    )
    total_deleted += len(ids)
    print(f"  Deleted batch of {len(ids)} (total: {total_deleted})")

print(f"Total deleted: {total_deleted}")

# Load data
with open('processed_doctors.json', 'r', encoding='utf-8') as f:
    doctors_data = json.load(f)

# =============================================
# STEP 1: Seed Doctors (1,244 records)
# =============================================
print(f"\nBuilding payload from {len(doctors_data)} raw records...")
doc_payload = []
excluded_count = 0

for row in doctors_data:
    name = clean_val(row.get('Doctor Name'))
    if not name or name in ('Doctor Name', 'Unknown'):
        continue

    specialization = clean_val(row.get('Specialization')) or ''
    spec_category = classify_spec(specialization)

    # EXCLUSION: Skip "Exclude"
    if spec_category == 'Exclude':
        excluded_count += 1
        continue

    z_id = clean_val(row.get('zone_id'))
    lat = clean_float(row.get('latitude'))
    lon = clean_float(row.get('longitude'))
    location = f"SRID=4326;POINT({lon} {lat})" if lat is not None and lon is not None else None

    area_name = clean_val(row.get('Area'))
    if not area_name:
        area_name = clean_val(row.get('Zone'))

    doc = {
        "koa_no": clean_val(row.get('KOA No')),
        "name": name,
        "specialization": specialization,
        "spec_category": spec_category,
        "role": clean_val(row.get('Role')),
        "phone": clean_val(row.get('Mobile Number(s)')),
        "email": clean_val(row.get('Email')),
        "hospitals_practice": clean_val(row.get('Hospital(s) / Practice')),
        "hospital_address": clean_val(row.get('Hospital Address')),
        "hospital_rating": clean_float(row.get('Hospital Rating')),
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
        "area_name": area_name,
        "original_notes": clean_val(row.get('Notes')),
        "source": clean_val(row.get('Source')),
        "lat": lat,
        "lon": lon,
        "location": location,
        "zone_id": str(z_id) if z_id else None,
        "is_approximate": bool(row.get("is_approximate", False))
    }

    doc_payload.append(doc)

print(f"Seeding {len(doc_payload)} doctors (excluded {excluded_count} 'Exclude')...")
print(f"  Spec breakdown:")
from collections import Counter
cats = Counter(d['spec_category'] for d in doc_payload)
for cat, cnt in cats.most_common():
    print(f"    {cat}: {cnt}")

# Batch insert
batch_size = 100
seeded = 0
errors = 0
for i in range(0, len(doc_payload), batch_size):
    batch = doc_payload[i:i+batch_size]
    r = requests.post(f"{URL}/doctors", headers=HEADERS, json=batch)
    if r.status_code not in (200, 201):
        print(f"  ERROR batch {i}: {r.text[:300]}")
        errors += 1
    else:
        seeded += len(batch)
        print(f"  Seeded {seeded}/{len(doc_payload)}")

print(f"\n=== DONE! Seeded {seeded}. Errors: {errors}. Excluded: {excluded_count}. ===")
