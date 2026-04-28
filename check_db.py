import requests
from collections import Counter

KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpydmdoY3h0cnBkbXloZ2p5cG1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMDA4ODIsImV4cCI6MjA5MjY3Njg4Mn0.UVlzfHUnkpWQPt-RAmK9m2cpoX20GQNsEPs9m1w8bto'
H = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
URL = 'https://jrvghcxtrpdmyhgjypms.supabase.co/rest/v1'

# Total count
r = requests.get(f'{URL}/doctors?select=id', headers={**H, 'Prefer': 'count=exact', 'Range': '0-0'})
print(f"Total rows: {r.headers.get('content-range')}")

# Get ALL spec_category values
all_specs = []
offset = 0
while True:
    r = requests.get(f'{URL}/doctors?select=spec_category&offset={offset}&limit=1000', headers=H)
    data = r.json()
    if not data: break
    all_specs.extend(d.get('spec_category') for d in data)
    offset += 1000

cats = Counter(all_specs)
print(f"Spec categories: {dict(cats)}")
print(f"Total counted: {len(all_specs)}")
