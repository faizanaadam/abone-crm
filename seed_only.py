import json
import requests
import math
from collections import Counter

URL = "https://jrvghcxtrpdmyhgjypms.supabase.co/rest/v1"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpydmdoY3h0cnBkbXloZ2p5cG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDA4ODIsImV4cCI6MjA5MjY3Njg4Mn0.UVlzfHUnkpWQPt-RAmK9m2cpoX20GQNsEPs9m1w8bto"
HEADERS = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "Prefer": "return=minimal"}

def cv(v):
    if v is None: return None
    if isinstance(v, float) and math.isnan(v): return None
    s = str(v).strip()
    return None if s in ('', 'nan', 'None', 'NaN') else s

def cf(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except: return None

def classify(raw):
    if not raw: return 'General'
    s = raw.lower()
    if 'exclude' in s: return 'Exclude'
    if 'spine' in s and 'trauma' in s: return 'Both'
    if 'spine' in s: return 'Spine'
    if 'trauma' in s: return 'Trauma'
    return 'General'

with open('processed_doctors.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

payload = []
excluded = 0
for row in data:
    name = cv(row.get('Doctor Name'))
    if not name or name in ('Doctor Name', 'Unknown'): continue
    spec = cv(row.get('Specialization')) or ''
    cat = classify(spec)
    if cat == 'Exclude':
        excluded += 1
        continue
    lat, lon = cf(row.get('latitude')), cf(row.get('longitude'))
    loc = f"SRID=4326;POINT({lon} {lat})" if lat and lon else None
    area = cv(row.get('Area')) or cv(row.get('Zone'))
    zid = cv(row.get('zone_id'))
    payload.append({
        "koa_no": cv(row.get('KOA No')), "name": name, "specialization": spec,
        "spec_category": cat, "role": cv(row.get('Role')),
        "phone": cv(row.get('Mobile Number(s)')), "email": cv(row.get('Email')),
        "hospitals_practice": cv(row.get('Hospital(s) / Practice')),
        "hospital_address": cv(row.get('Hospital Address')),
        "hospital_rating": cf(row.get('Hospital Rating')),
        "hospital_reviews": cv(row.get('Hospital Reviews')),
        "hospital_category": cv(row.get('Hospital Category')),
        "hospital_website": cv(row.get('Hospital Website')),
        "hospital_maps_link": cv(row.get('Google Maps Link')),
        "clinic_name": cv(row.get('Clinic Name')),
        "clinic_location": cv(row.get('Clinic Location')),
        "consultation_days": cv(row.get('Consultation Days')),
        "consultation_timing": cv(row.get('Consultation Timing')),
        "area_name": area, "lat": lat, "lon": lon, "location": loc,
        "zone_id": str(zid) if zid else None,
        "is_approximate": bool(row.get("is_approximate", False))
    })

cats = Counter(d['spec_category'] for d in payload)
print(f"Seeding {len(payload)} doctors (excluded {excluded})")
for c, n in cats.most_common(): print(f"  {c}: {n}")

seeded = errors = 0
for i in range(0, len(payload), 100):
    batch = payload[i:i+100]
    r = requests.post(f"{URL}/doctors", headers=HEADERS, json=batch)
    if r.status_code not in (200, 201):
        print(f"  ERR {i}: {r.text[:200]}")
        errors += 1
    else:
        seeded += len(batch)
        print(f"  {seeded}/{len(payload)}")

print(f"\nDONE: {seeded} seeded, {errors} errors, {excluded} excluded")
